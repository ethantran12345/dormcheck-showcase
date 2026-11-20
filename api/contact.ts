import { Resend } from 'resend';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit, requestIp } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const resend = new Resend(process.env.RESEND_API_KEY);

const escapeText = (s: string) => s.replace(/[\r\n]+/g, ' ').slice(0, 300);

/**
 * Public inbound-message endpoint for the marketing site. Serves two forms,
 * selected by `kind`: the Partners inquiry (default -> partnerships@dormcheck.com)
 * and the help/feedback form (kind:'support' -> support@dormcheck.com). Both are
 * unauthenticated (prospects/visitors have no account), so it is rate-limited per
 * client IP. reply_to is always the submitter. The client shows a prefilled
 * mailto link if this endpoint fails, so delivery never hard-blocks the page.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const ip = requestIp(req);
    if (!(await enforceRateLimit({ res, action: 'contact', userId: ip, max: 5, windowSeconds: 3600 }))) {
      return;
    }

    const { name, email, org, type, message, kind, category } = (req.body ?? {}) as {
      name?: string;
      email?: string;
      org?: string;
      type?: string;
      message?: string;
      kind?: string;
      category?: string;
    };

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (
      message.length > 5000 ||
      name.length > 200 ||
      (org ?? '').length > 200 ||
      (type ?? '').length > 100 ||
      (category ?? '').length > 100
    ) {
      return res.status(400).json({ error: 'Input too long' });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: 'Email service not configured' });
    }

    // Two inbound flows share this endpoint (rate-limit/validation/CORS): the
    // Partners inquiry (default) and the marketing help/feedback form (support).
    const isSupport = kind === 'support';

    const text = isSupport
      ? `Name: ${escapeText(name.trim())}\n` +
        `Email: ${escapeText(email.trim())}\n` +
        `Category: ${escapeText(category?.trim() || '(unspecified)')}\n\n` +
        `Message:\n${message.trim().slice(0, 5000)}\n`
      : `Name: ${escapeText(name.trim())}\n` +
        `Email: ${escapeText(email.trim())}\n` +
        `Organization: ${escapeText(org?.trim() || '(none)')}\n` +
        `Reaching out as: ${escapeText(type?.trim() || '(unspecified)')}\n\n` +
        `Message:\n${message.trim().slice(0, 5000)}\n`;

    const { data, error } = await resend.emails.send(
      isSupport
        ? {
            from: 'DormCheck Support <support@dormcheck.com>',
            to: 'support@dormcheck.com',
            replyTo: email.trim(),
            subject: `DormCheck help & feedback: ${escapeText(category?.trim() || name.trim())}`,
            text,
          }
        : {
            from: 'DormCheck Partnerships <partnerships@dormcheck.com>',
            to: 'partnerships@dormcheck.com',
            replyTo: email.trim(),
            subject: `DormCheck partnership inquiry: ${escapeText(org?.trim() || name.trim())}`,
            text,
          },
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, id: data?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send message';
    return res.status(500).json({ error: msg });
  }
}
