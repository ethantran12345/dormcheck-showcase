import { Resend } from 'resend';
import { getAuthedUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { enforceRateLimit } from './_lib/rateLimit.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Cap feedback submissions to a handful per hour per user.
    if (!(await enforceRateLimit({ res, action: 'feedback', userId: user.id, max: 5, windowSeconds: 3600 }))) {
      return;
    }

    const { message } = req.body as { message?: string };

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: 'Message too long (max 5000 characters)' });
    }

    // Safety check from 'test' branch
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: 'Email service not configured' });
    }

    // Sender identity comes from the verified JWT, not the request body.
    const text = user.email
      ? `Feedback from ${user.email}:\n\n${message.trim()}`
      : `Feedback (no email on account):\n\n${message.trim()}`;

    const { data, error } = await resend.emails.send({
      from: 'DormCheck Feedback <support@dormcheck.com>',
      to: 'support@dormcheck.com',
      subject: 'DormCheck Feedback & Support',
      text,
    });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send feedback';
    return res.status(500).json({ error: msg });
  }
}