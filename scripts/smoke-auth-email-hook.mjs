#!/usr/bin/env node
/**
 * smoke-auth-email-hook.mjs — prove a DEPLOYED send-auth-email accepts a GoTrue-shaped,
 * correctly signed send-email hook and hands the message to Resend, without touching a
 * human inbox.
 *
 *   SEND_EMAIL_HOOK_SECRET='v1,whsec_…' node scripts/smoke-auth-email-hook.mjs [functions base URL]
 *
 * Default base URL: https://abcdefghijklmnopqrst.supabase.co/functions/v1 (prod). The secret
 * is accepted as `v1,whsec_<b64>`, `whsec_<b64>` or bare base64 — the same forms the function
 * itself accepts — and is never printed.
 *
 * Recipient is Resend's `delivered@resend.dev`: a real accepted send and delivery event, no
 * inbox. The payload is a `signup` hook with a throwaway token, so even a copied link is inert.
 *
 * WHY THE SECRET COMES FROM THE ENVIRONMENT, NOT THE MANAGEMENT API: `GET /config/auth`
 * returns `hook_send_email_secrets` as a 64-hex digest of the secret, not the secret. Signing
 * with that value produced the 2026-09-07 false rollback of send-auth-email
 * (docs/audits/prod-apply-2026-09-07.md §9). The plaintext lives with the other secrets on
 * the operator's machine, never in the repo.
 *
 * Exit 0 on HTTP 200 (`{}`), 1 otherwise. Two attempts, 5 s apart, to absorb a cold start.
 */
import { createHmac, randomUUID } from 'node:crypto';

const base = (process.argv[2] || 'https://abcdefghijklmnopqrst.supabase.co/functions/v1').replace(/\/$/, '');
const rawSecret = String(process.env.SEND_EMAIL_HOOK_SECRET || '').trim();
if (!rawSecret) {
  console.error('smoke-auth-email-hook: SEND_EMAIL_HOOK_SECRET is not set (plaintext, from the secrets store — not the Management API digest).');
  process.exit(1);
}
const b64 = rawSecret.replace(/^v1,/, '').replace(/^whsec_/, '');
const key = Buffer.from(b64, 'base64');
if (key.length < 16) {
  console.error(`smoke-auth-email-hook: decoded key is ${key.length} bytes — that is not a webhook secret (a 64-hex Management API digest decodes to 48 bytes of nonsense; a real key is base64).`);
  process.exit(1);
}

const body = JSON.stringify({
  user: { email: 'delivered@resend.dev' },
  email_data: {
    token: '000000',
    token_hash: `smoke-${Date.now()}`,
    redirect_to: 'https://dormcheck.com/',
    email_action_type: 'signup',
    site_url: 'https://dormcheck.com',
  },
});
const id = `msg_smoke_${randomUUID()}`;
const ts = String(Math.floor(Date.now() / 1000));
const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
const url = `${base}/send-auth-email`;

let status = 0;
for (let attempt = 1; attempt <= 2; attempt++) {
  let text = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
      body,
    });
    status = res.status;
    text = (await res.text()).slice(0, 200);
  } catch (e) {
    status = 0;
    text = String(e?.message || e);
  }
  console.log(JSON.stringify({ attempt, url, status, body: text, at: new Date().toISOString() }));
  if (status === 200) break;
  if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
}
console.log(status === 200 ? '✓ send-auth-email accepted a correctly signed signup hook and handed it to Resend.' : '✗ send-auth-email did not return 200 — do not leave this build in prod without knowing why.');
process.exit(status === 200 ? 0 : 1);
