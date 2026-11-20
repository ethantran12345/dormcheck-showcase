import { Resend } from 'resend';
import { Webhook } from 'svix';
import { supabase } from './_lib/supabase.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const resend = new Resend(process.env.RESEND_API_KEY);
const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

// Disable body parser so we can read raw body for Svix verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of readable as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!webhookSecret) {
    console.error('[events] RESEND_WEBHOOK_SECRET is not set in Vercel env');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  try {
    // 1. Read the raw body as a string for Svix verification
    const rawBody = (await buffer(req)).toString('utf8');
    const headers = req.headers as Record<string, string>;
    const wh = new Webhook(webhookSecret);

    // 2. Verify the signature using the raw string
    try {
      wh.verify(rawBody, headers);
    } catch {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // 3. Parse the body manually now that it's verified
    const event = JSON.parse(rawBody);

    if (event.type === 'email.received') {
      const { data, error } = await resend.emails.receiving.forward({
        emailId: event.data.email_id,
        to: 'support@dormcheck.com',
        from: 'support@dormcheck.com',
      });

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data);
    }

    // Hard bounce / spam complaint → suppression list. Broadcast sends
    // (notify-school-launch and future) filter against email_suppressions;
    // transactional auth mail is deliberately not filtered.
    if (event.type === 'email.bounced' || event.type === 'email.complained') {
      const bounceType: string | undefined = event.data?.bounce?.type;
      if (event.type === 'email.bounced' && bounceType === 'Transient') {
        return res.status(200).json({ status: 'ignored-transient-bounce' });
      }
      if (!supabase) {
        console.error('[events] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel env');
        return res.status(500).json({ error: 'Suppression store not configured' });
      }
      const to = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to];
      const reason =
        event.type === 'email.complained' ? 'complaint' : `bounce-${(bounceType ?? 'unknown').toLowerCase()}`;
      const rows = to
        .filter((e: unknown): e is string => typeof e === 'string' && e.includes('@'))
        .map((e: string) => ({ email: e.trim().toLowerCase(), reason }));
      if (rows.length) {
        const { error } = await supabase
          .from('email_suppressions')
          .upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
        if (error) {
          console.error('[events] suppression upsert failed:', error);
          return res.status(500).json({ error: 'Failed to record suppression' });
        }
      }
      return res.status(200).json({ status: 'suppressed', count: rows.length });
    }

    return res.status(200).json({ status: 'ignored' });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
