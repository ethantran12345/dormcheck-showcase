import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit, requestIp } from './_lib/rateLimit.js';
import { supabase } from './_lib/supabase.js';

type AdminLeadBody = {
  adminName?: string;
  adminRole?: string;
  adminEmail?: string;
  schoolDomain?: string;
  referredByEmail?: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;


/**
 * Public partnership-lead capture. The service role owns the DB write so the
 * browser never needs an INSERT grant on university_admin_leads.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabase) return res.status(503).json({ error: 'Service not configured' });

  try {
    if (!(await enforceRateLimit({
      res,
      action: 'submit-admin-lead',
      userId: requestIp(req),
      max: 5,
      windowSeconds: 3600,
    }))) return;

    const body = (req.body ?? {}) as AdminLeadBody;
    const adminName = body.adminName?.trim() ?? '';
    const adminRole = body.adminRole?.trim() || null;
    const adminEmail = body.adminEmail?.trim().toLowerCase() ?? '';
    const schoolDomain = body.schoolDomain?.trim().toLowerCase() ?? '';
    const referredByEmail = body.referredByEmail?.trim().toLowerCase() || null;

    if (!adminName || adminName.length > 200 || !EMAIL_PATTERN.test(adminEmail) || adminEmail.length > 254) {
      return res.status(400).json({ error: 'A valid admin name and email are required' });
    }
    if (adminRole && adminRole.length > 200) {
      return res.status(400).json({ error: 'Input too long' });
    }
    if (!DOMAIN_PATTERN.test(schoolDomain)) {
      return res.status(400).json({ error: 'A valid school domain is required' });
    }
    if (referredByEmail && (!EMAIL_PATTERN.test(referredByEmail) || referredByEmail.length > 254)) {
      return res.status(400).json({ error: 'A valid referrer email is required' });
    }

    const { error } = await supabase.from('university_admin_leads').insert({
      admin_name: adminName,
      admin_role: adminRole,
      admin_email: adminEmail,
      school_domain: schoolDomain,
      referred_by_email: referredByEmail,
    });
    if (error) {
      console.error('submit-admin-lead insert error:', error);
      return res.status(500).json({ error: 'Failed to save the contact' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save the contact';
    return res.status(500).json({ error: message });
  }
}
