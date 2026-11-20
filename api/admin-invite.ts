import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendAdminInviteEmail, sendAdminGrantedEmail } from './_lib/notifications.js';
import { supabase } from './_lib/supabase.js';
import { getAuthedUser, getCallerName } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

type AppRole = 'user' | 'university_admin' | 'superadmin';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Delegated admin invitations. Rails (enforced here on top of RLS + the
 * protect_profile_role trigger, defense in depth):
 * - university_admin may only mint role=university_admin, only for their own
 *   university, and may never touch a superadmin.
 * - Invited email must match the target university's email_domains.
 * - Every grant/invite writes an admin_audit_log row.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    console.error('[admin-invite] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!(await enforceRateLimit({ res, action: 'admin-invite', userId: user.id, max: 20, windowSeconds: 3600 }))) {
      return;
    }

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, university_id')
      .eq('id', user.id)
      .maybeSingle();
    const callerRole = (callerProfile as { role?: AppRole } | null)?.role ?? 'user';
    const callerUniversityId = (callerProfile as { university_id?: string | null } | null)?.university_id ?? null;
    if (callerRole === 'user') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const body = req.body as { email?: string; role?: string; universityId?: string };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    // Resolve role + university with the delegation rails.
    let targetRole: AppRole;
    let targetUniversityId: string | null;
    if (callerRole === 'university_admin') {
      if (body.role && body.role !== 'university_admin') {
        return res.status(403).json({ error: 'University admins can only invite university admins' });
      }
      if (body.universityId && body.universityId !== callerUniversityId) {
        return res.status(403).json({ error: 'You can only invite admins for your own school' });
      }
      targetRole = 'university_admin';
      targetUniversityId = callerUniversityId;
    } else {
      targetRole = body.role === 'superadmin' ? 'superadmin' : 'university_admin';
      targetUniversityId = body.universityId ?? callerUniversityId;
    }
    if (!targetUniversityId) {
      return res.status(400).json({ error: 'universityId is required' });
    }

    const { data: university } = await supabase
      .from('universities')
      .select('id, name, email_domains, is_active')
      .eq('id', targetUniversityId)
      .maybeSingle();
    const uni = university as { id: string; name: string; email_domains: string[] | null; is_active: boolean } | null;
    if (!uni || !uni.is_active) {
      return res.status(400).json({ error: 'Unknown or inactive university' });
    }
    const domains = uni.email_domains ?? [];
    if (!domains.some((d) => email.endsWith('@' + d.toLowerCase()))) {
      return res.status(400).json({
        error: `Admins for ${uni.name} must use a school email (${domains.map((d) => '@' + d).join(', ')})`,
      });
    }

    const audit = async (action: string, targetType: string, targetId: string | null) => {
      const { error } = await supabase!.from('admin_audit_log').insert({
        actor_id: user.id,
        action,
        target_type: targetType,
        target_id: targetId,
        university_id: targetUniversityId,
      });
      if (error) console.error('[admin-invite] audit log failed:', action, error);
    };

    // Existing account: grant immediately (service role bypasses the role guard).
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, role')
      .ilike('email', email)
      .maybeSingle();
    const existing = existingProfile as { id: string; role?: AppRole } | null;

    if (existing) {
      if (existing.role === 'superadmin' && callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'This user already has a higher admin role' });
      }
      const { error: grantErr } = await supabase
        .from('profiles')
        .update({ role: targetRole, university_id: targetUniversityId })
        .eq('id', existing.id);
      if (grantErr) {
        console.error('[admin-invite] grant failed:', grantErr);
        return res.status(500).json({ error: 'Failed to grant admin access' });
      }
      await supabase.from('admin_invitations').insert({
        email,
        role: targetRole,
        university_id: targetUniversityId,
        invited_by: user.id,
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by: existing.id,
      });
      await audit('admin.grant', 'profile', existing.id);
      await sendAdminGrantedEmail(email, uni.name);
      return res.status(200).json({ ok: true, status: 'granted' });
    }

    // No account yet: pending invite, claimed automatically on first login.
    const inviterName = await getCallerName(user.id, user.email);

    const { data: pending } = await supabase
      .from('admin_invitations')
      .select('id, token')
      .eq('email', email)
      .eq('university_id', targetUniversityId)
      .eq('status', 'pending')
      .maybeSingle();
    const existingInvite = pending as { id: string; token: string } | null;

    if (existingInvite) {
      // Resend: refresh the window on the same invite instead of stacking rows.
      await supabase
        .from('admin_invitations')
        .update({ expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString() })
        .eq('id', existingInvite.id);
      await audit('admin.invite_resent', 'admin_invitation', existingInvite.id);
      await sendAdminInviteEmail(email, inviterName, uni.name, existingInvite.token);
      return res.status(200).json({ ok: true, status: 'resent' });
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('admin_invitations')
      .insert({ email, role: targetRole, university_id: targetUniversityId, invited_by: user.id })
      .select('id, token')
      .single();
    if (insertErr || !inserted) {
      console.error('[admin-invite] insert failed:', insertErr);
      return res.status(500).json({ error: 'Failed to create invitation' });
    }
    const invite = inserted as { id: string; token: string };
    await audit('admin.invite', 'admin_invitation', invite.id);
    await sendAdminInviteEmail(email, inviterName, uni.name, invite.token);
    return res.status(200).json({ ok: true, status: 'invited' });
  } catch (err) {
    console.error('[admin-invite]', err);
    return res.status(500).json({ error: 'Failed to send invitation' });
  }
}
