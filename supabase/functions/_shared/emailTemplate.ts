// Shared DormCheck email chrome (v6 auth-email chrome: logo + wordmark,
// #0B702B pill CTA, pipe footer, Nunito stack; multi-university - no school
// badge). SINGLE SOURCE OF TRUTH for every email DormCheck sends:
//   - Vercel /api transactional emails import it via api/_lib/notifications.ts
//   - The send-auth-email Edge Function (Supabase send_email auth hook) imports
//     it for all Supabase Auth emails (confirmation, OTP, recovery, ...)
// Keep this file dependency-free (no Node or Deno APIs) so both runtimes can
// import it unchanged. Do NOT copy this HTML anywhere else - drift between
// copies is exactly what this file exists to prevent.

/**
 * Escape a value for safe interpolation into HTML. Applied to every dynamic
 * value in the email template so attacker-controlled data (e.g. a profile
 * full_name or a listing title) cannot inject markup/links into emails sent
 * from the verified dormcheck.com domain.
 */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only allow https links from our own domain (plus explicitly allowlisted
 * hosts, e.g. the Supabase auth verify endpoint) in the email CTA button.
 * Anything else (javascript:, off-domain, malformed) falls back to the site
 * root, so a tainted URL can never become a phishing link inside a DormCheck
 * email.
 */
export function safeButtonUrl(rawUrl: string, extraAllowedHosts: string[] = []): string {
  try {
    const u = new URL(rawUrl);
    if (
      u.protocol === 'https:' &&
      (u.hostname === 'dormcheck.com' ||
        u.hostname.endsWith('.dormcheck.com') ||
        extraAllowedHosts.includes(u.hostname))
    ) {
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return 'https://dormcheck.com';
}

/**
 * Only allow https image sources in the preview card. Listing photos live on
 * Supabase Storage (<ref>.supabase.co), so - unlike the CTA button - images
 * may come from any host, but must be https (never http:, data:, javascript:).
 * A non-https or malformed URL yields '' and the card simply omits the image.
 */
export function safeImageUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'https:') return u.toString();
  } catch {
    /* fall through */
  }
  return '';
}

/**
 * Optional "preview card" data - an email-safe context card rendered between
 * the body and the CTA so a student can tell what an email is about before
 * clicking (a listing photo + price, a message snippet, the stars they got).
 * Every value is escaped and the image is https-guarded at render time.
 */
export interface EmailPreview {
  /** https-only image (e.g. listing photo); shown ~84px, rounded, left. */
  imageUrl?: string;
  /** 1-3 short detail lines (e.g. ["Mini fridge", "$45"]). */
  lines?: string[];
  /** A message/review snippet, rendered in a left-bordered quote block. */
  quote?: string;
  /** 1-5, rendered as a filled/empty ★ row in #0B702B. */
  stars?: number;
}

export interface EmailChromeOptions {
  /** 6-digit OTP code rendered in a code box between the body and the button. */
  code?: string;
  /** Extra hostnames the CTA button may link to (e.g. <ref>.supabase.co). */
  extraButtonHosts?: string[];
  /** Context card rendered between the body and the CTA button. */
  preview?: EmailPreview;
}

/** Build the email-safe preview card, or '' when there's nothing to show. */
function renderPreviewCard(preview: EmailPreview | undefined, fontStack: string): string {
  if (!preview) return '';
  const img = preview.imageUrl ? safeImageUrl(preview.imageUrl) : '';
  const lines = (preview.lines ?? [])
    .filter((l) => typeof l === 'string' && l.trim())
    .slice(0, 3);
  const quote = typeof preview.quote === 'string' ? preview.quote.trim() : '';
  const starCount =
    typeof preview.stars === 'number' && preview.stars > 0
      ? Math.min(5, Math.max(0, Math.round(preview.stars)))
      : 0;
  if (!img && lines.length === 0 && !quote && starCount === 0) return '';

  const linesHtml = lines
    .map(
      (l) =>
        `<p style="margin:0 0 5px;font-family:${fontStack};font-size:14.5px;font-weight:700;color:#18181B;line-height:1.45;">${escapeHtml(l)}</p>`,
    )
    .join('');

  let starsHtml = '';
  if (starCount > 0) {
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += `<span style="color:${i <= starCount ? '#0B702B' : '#D4D4D8'};font-size:19px;">&#9733;</span>`;
    }
    starsHtml = `<p style="margin:2px 0 0;line-height:1;letter-spacing:3px;">${stars}</p>`;
  }

  // Trim overlong snippets so the card stays a preview, not the whole thread.
  const quoteText = quote.length > 240 ? `${quote.slice(0, 237)}...` : quote;
  const quoteHtml = quoteText
    ? `<p style="margin:${linesHtml || starsHtml ? '8px' : '0'} 0 0;padding-left:11px;border-left:3px solid #0B702B;font-family:${fontStack};font-size:14.5px;font-style:italic;color:#3F3F46;line-height:1.5;">&ldquo;${escapeHtml(quoteText)}&rdquo;</p>`
    : '';

  const contentCell = `${linesHtml}${starsHtml}${quoteHtml}`;
  const imageCell = img
    ? `<td width="84" valign="top" style="padding-right:15px;"><img src="${escapeHtml(img)}" width="84" height="84" alt="" style="display:block;width:84px;height:84px;border-radius:10px;border:0;object-fit:cover;"></td>`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 20px;border:1px solid #E4E4E7;border-radius:12px;"><tr>
<td bgcolor="#F4F4F5" style="border-radius:12px;padding:16px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
${imageCell}<td valign="top">${contentCell}</td>
</tr></table>
</td></tr></table>`;
}

// Every interpolated argument is escaped (and buttonUrl is allowlisted) so
// callers can pass user-derived strings safely without escaping at each site.
// Pass an empty buttonText to omit the CTA button (code-only emails, e.g.
// reauthentication).
export const getEmailHtml = (
  headlineRaw: string,
  bodyTextRaw: string,
  buttonTextRaw: string,
  buttonUrlRaw: string,
  unsubUrl?: string,
  opts?: EmailChromeOptions,
) => {
  const headline = escapeHtml(headlineRaw);
  const bodyText = escapeHtml(bodyTextRaw);
  const buttonText = escapeHtml(buttonTextRaw);
  const buttonUrl = escapeHtml(safeButtonUrl(buttonUrlRaw, opts?.extraButtonHosts ?? []));
  const F = "'Nunito','Segoe UI',Helvetica,Arial,sans-serif";
  const codeBlock = opts?.code
    ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr>
<td align="center" bgcolor="#F4F4F5" style="border-radius:12px;">
<p style="margin:0;padding:14px 26px;font-family:${F};font-size:26px;font-weight:800;letter-spacing:8px;color:#18181B;">${escapeHtml(opts.code)}</p>
</td></tr></table>`
    : '';
  const previewBlock = renderPreviewCard(opts?.preview, F);
  const buttonBlock = buttonTextRaw
    ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr>
<td align="center" bgcolor="#0B702B" style="border-radius:9999px;">
<a href="${buttonUrl}" style="display:inline-block;padding:13px 30px;font-family:${F};font-size:15px;font-weight:800;color:#ffffff;border-radius:9999px;">${buttonText}</a>
</td></tr></table>`
    : '';
  return `
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:${F};} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<img src="https://dormcheck.com/dormcheck-wordmark-sora.png" alt="DormCheck" height="20" style="vertical-align:middle;display:inline-block;border:0;padding-left:9px;">
</td></tr>
<tr><td align="left">
<p style="margin:0 0 15px;font-family:${F};color:#18181B;font-size:18px;font-weight:800;line-height:1.5;">${headline}</p>
<p style="margin:0 0 15px;font-family:${F};color:#18181B;font-size:16px;line-height:1.6;">${bodyText}</p>${codeBlock}${previewBlock}${buttonBlock}
</td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 8px;font-family:${F};font-size:13.5px;">
<a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://x.com/dormcheck" style="color:#0B702B;">X</a></p>
<p style="margin:0;font-family:${F};color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>
<a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn't affiliated with any university.${
    unsubUrl
      ? `<br><a href="${escapeHtml(unsubUrl)}" style="color:#71717A;text-decoration:underline;">Unsubscribe from these emails</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/settings?section=notifications" style="color:#71717A;text-decoration:underline;">Notification settings</a>`
      : ''
  }
</p>
</td></tr>
</table></td></tr></table></body></html>`;
};
