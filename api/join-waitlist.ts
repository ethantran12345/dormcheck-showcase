import { applyCors } from './_lib/cors.js';
import { enforceRateLimit, requestIp } from './_lib/rateLimit.js';
import { supabase } from './_lib/supabase.js';
import { sendWaitlistConfirmationEmail } from './_lib/notifications.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type WaitlistRank = {
  school_name?: string | null;
  rank?: number | null;
  total_schools?: number | null;
  error?: string;
};

/**
 * Public waitlist-join endpoint. Unauthenticated by design (prospects have no
 * account), so it is rate-limited per client IP like api/contact.ts. The join
 * moved server-side so the confirmation email is only ever sent to the address
 * that was actually inserted - the anon INSERT grant on university_waitlist
 * cannot be used to aim branded mail at arbitrary addresses.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabase) {
    return res.status(503).json({ error: 'Service not configured' });
  }

  try {
    const ip = requestIp(req);
    if (!(await enforceRateLimit({ res, action: 'join-waitlist', userId: ip, max: 5, windowSeconds: 3600 }))) {
      return;
    }

    const { email: rawEmail, schoolName: rawSchool } = (req.body ?? {}) as {
      email?: string;
      schoolName?: string;
    };

    const email = rawEmail?.trim().toLowerCase() ?? '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    const schoolName = rawSchool?.trim() || null;
    if (schoolName && schoolName.length > 120) {
      return res.status(400).json({ error: 'Input too long' });
    }

    // Resolve the directory school from the email domain server-side (never a
    // client-passed id) so the row lands tagged for the per-school demand map.
    // Best-effort: a miss or RPC error leaves school_id NULL.
    let schoolId: string | null = null;
    try {
      const { data: resolved } = await supabase.rpc('resolve_school_by_domain', {
        p_domain: email.split('@')[1],
      });
      schoolId = (resolved as { school_id?: string } | null)?.school_id ?? null;
    } catch {
      /* naming only - never block the join */
    }

    // The BEFORE INSERT trigger lowercases the email and derives email_domain;
    // dedupe is the unique index on lower(email) (an expression index, so no
    // PostgREST onConflict target - a 23505 is the "already joined" signal).
    const { error: insertError } = await supabase
      .from('university_waitlist')
      .insert({ email, school_name: schoolName, school_id: schoolId });

    if (insertError) {
      if (insertError.code === '23505') {
        // Repeat submit: the join already stands; never resend the confirmation.
        return res.status(200).json({ ok: true, alreadyJoined: true });
      }
      console.error('join-waitlist insert error:', insertError);
      return res.status(500).json({ error: 'Failed to join the waitlist' });
    }

    // Best-effort personalization + send: the join is the transaction, the
    // email must never fail the request.
    try {
      const emailDomain = email.split('@')[1];
      let rankLine: string | null = null;
      let rpcSchoolName: string | null = null;
      const { data: rankData } = await supabase.rpc('get_waitlist_rank', { p_domain: emailDomain });
      const rank = (rankData ?? null) as WaitlistRank | null;
      if (rank && !rank.error) {
        rpcSchoolName = rank.school_name?.trim() || null;
        if (typeof rank.rank === 'number' && typeof rank.total_schools === 'number') {
          rankLine = `Your school is #${rank.rank} of ${rank.total_schools} on the waitlist.`;
        }
      }
      await sendWaitlistConfirmationEmail(email, schoolName ?? rpcSchoolName, rankLine);
    } catch (sendErr) {
      console.error('join-waitlist confirmation email failed:', sendErr);
    }

    return res.status(200).json({ ok: true, alreadyJoined: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to join the waitlist';
    return res.status(500).json({ error: msg });
  }
}
