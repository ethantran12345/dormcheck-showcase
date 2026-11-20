# Supabase Auth email templates — v6 (2026-07-09), version-controlled backup

**This file is the only version-controlled copy of these six templates.**

Supabase Auth email templates are **dashboard-only configuration**. They are not part of
`supabase/config.toml`, they are not in a migration, and `supabase db pull` does not bring
them back. Nothing in this repo generates them and nothing deploys them. Until this file
existed (2026-08-06) the sole surviving copy of the v6 HTML was a Cowork memory note —
one prune away from gone, with no way to reconstruct it from the product.

**Re-paste target:** Supabase → **Authentication → Emails**. For each template below,
paste the Subject into the subject field and the HTML body into the message body. Six
templates, in the dashboard's own order: Confirm sign up, Invite user, Magic link or OTP,
Change email address, Reset password, Reauthentication.

**Fidelity over tidiness.** The HTML below is reproduced byte-for-byte from the v6 source.
It is table-based, inline-styled, single-line-per-row email HTML — deliberately, because
that is what mail clients render. Do not reformat, prettify, re-indent, or "clean up" the
markup in this file: it is a restore image, and a diff here is a defect. If a template
needs to change, change it in the dashboard, verify a real send, then update this file to
match what is live.

## Known-defect note (checked 2026-08-06)

A brand violation was reported against the **Invite user** template: teal `#5ba595`, where
the brand green is `#03C03C` and the email green is `#0B702B`. **That colour is not present
in the v6 HTML archived here.** Every green in all six templates below is `#0B702B` (43
occurrences); the full colour set is `#0B702B`, `#C7CCD2`, `#ffffff`, `#18181B`, `#71717A`,
`#F4F4F5`, `#E4E4E7`, `#3F3F46`, `#171717`, `#E7E7EA`. So either the teal predates v6, or
the live dashboard still holds a pre-v6 Invite template that was never updated.

**This file does not fix it, on purpose** — the dashboard is the live surface and a
separate lane owns that change. What is actionable: open Authentication → Emails → Invite
user, and if the button reads `#5ba595`, paste the v6 Invite body from this file over it.

## Provenance

Source: Cowork memory note `email-templates-v6-html.md` (v6, dated 2026-07-09). Design
notes carried over from that note: logo top-left with no bar, grey code box (`#F4F4F5`)
with black digits (`#171717`), lighter footer (`#71717A`) with pipe separators, contact
link to dormcheck.com/contact, no image uploads needed (the logo is hosted at
`https://dormcheck.com/dormcheck-logo-new.png`). Design rationale and which templates
actually fire live in the vault note `email-template-redesign` — not in this repo.

---


## Confirm sign up

**Subject:** `{{ .Token }} is your DormCheck verification code`

**Body:**

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:20px;font-weight:800;letter-spacing:-.3px;vertical-align:middle;padding-left:9px;">DormCheck</span>
</td></tr>
<tr><td align="left"><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Hi,</p><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Enter this code to finish setting up your DormCheck account:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>
<td align="center" style="background:#F4F4F5;border:1px solid #E7E7EA;border-radius:10px;padding:24px 12px;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#171717;font-size:36px;font-weight:800;letter-spacing:14px;padding-left:14px;">{{ .Token }}</span>
</td></tr></table><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#3F3F46;font-size:14px;line-height:1.6;">This code expires in 24 hours and can only be used once.</p></td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 18px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13.5px;line-height:1.6;">If you didn&#39;t create a DormCheck account, you can safely ignore this email. If you have questions or complaints, please <a href="https://dormcheck.com/contact" style="color:#0B702B;text-decoration:underline;">contact us</a>.</p>
<p style="margin:0 0 8px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:13.5px;"><a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;text-decoration:none;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;text-decoration:none;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;text-decoration:none;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://x.com/dormcheck" style="color:#0B702B;text-decoration:none;">X</a></p>
<p style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn&#39;t affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>
```

---

## Invite user

**Subject:** `You're invited to DormCheck`

**Body:**

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:20px;font-weight:800;letter-spacing:-.3px;vertical-align:middle;padding-left:9px;">DormCheck</span>
</td></tr>
<tr><td align="left"><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Hi,</p><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">You&#39;ve been invited to join DormCheck. Tap below to accept and set up your account.</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr>
<td align="center" bgcolor="#0B702B" style="border-radius:9999px;">
<a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:13px 30px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#ffffff;border-radius:9999px;">Accept invitation</a>
</td></tr></table><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#3F3F46;font-size:14px;line-height:1.6;">This invitation expires in 60 minutes.</p></td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 18px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13.5px;line-height:1.6;">If you weren&#39;t expecting this invitation, you can safely ignore this email. If you have questions or complaints, please <a href="https://dormcheck.com/contact" style="color:#0B702B;text-decoration:underline;">contact us</a>.</p>
<p style="margin:0 0 8px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:13.5px;"><a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;text-decoration:none;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;text-decoration:none;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;text-decoration:none;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://x.com/dormcheck" style="color:#0B702B;text-decoration:none;">X</a></p>
<p style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn&#39;t affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>
```

---

## Magic link or OTP

**Subject:** `{{ .Token }} is your DormCheck sign-in code`

**Body:**

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:20px;font-weight:800;letter-spacing:-.3px;vertical-align:middle;padding-left:9px;">DormCheck</span>
</td></tr>
<tr><td align="left"><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Hi,</p><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Enter this code to sign in to DormCheck without a password:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>
<td align="center" style="background:#F4F4F5;border:1px solid #E7E7EA;border-radius:10px;padding:24px 12px;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#171717;font-size:36px;font-weight:800;letter-spacing:14px;padding-left:14px;">{{ .Token }}</span>
</td></tr></table><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#3F3F46;font-size:14px;line-height:1.6;">This code is valid for 60 minutes and can only be used once.</p></td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 18px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13.5px;line-height:1.6;">If you didn&#39;t try to sign in, you can safely ignore this email. If you have questions or complaints, please <a href="https://dormcheck.com/contact" style="color:#0B702B;text-decoration:underline;">contact us</a>.</p>
<p style="margin:0 0 8px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:13.5px;"><a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;text-decoration:none;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;text-decoration:none;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;text-decoration:none;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://x.com/dormcheck" style="color:#0B702B;text-decoration:none;">X</a></p>
<p style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn&#39;t affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>
```

---

## Change email address

**Subject:** `{{ .Token }} is your DormCheck email confirmation code`

**Body:**

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:20px;font-weight:800;letter-spacing:-.3px;vertical-align:middle;padding-left:9px;">DormCheck</span>
</td></tr>
<tr><td align="left"><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Hi,</p><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Enter this code to confirm your new email address (<strong style="color:#18181B;">{{ .NewEmail }}</strong>) for your DormCheck account:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>
<td align="center" style="background:#F4F4F5;border:1px solid #E7E7EA;border-radius:10px;padding:24px 12px;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#171717;font-size:36px;font-weight:800;letter-spacing:14px;padding-left:14px;">{{ .Token }}</span>
</td></tr></table><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#3F3F46;font-size:14px;line-height:1.6;">This code expires in 60 minutes.</p></td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 18px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13.5px;line-height:1.6;">If you didn&#39;t request this, ignore this email and your address won&#39;t change. If you have questions or complaints, please <a href="https://dormcheck.com/contact" style="color:#0B702B;text-decoration:underline;">contact us</a>.</p>
<p style="margin:0 0 8px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:13.5px;"><a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;text-decoration:none;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;text-decoration:none;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;text-decoration:none;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://x.com/dormcheck" style="color:#0B702B;text-decoration:none;">X</a></p>
<p style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn&#39;t affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>
```

---

## Reset password

**Subject:** `{{ .Token }} is your DormCheck password reset code`

**Body:**

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:20px;font-weight:800;letter-spacing:-.3px;vertical-align:middle;padding-left:9px;">DormCheck</span>
</td></tr>
<tr><td align="left"><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Hi,</p><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Enter this code to reset your DormCheck password:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>
<td align="center" style="background:#F4F4F5;border:1px solid #E7E7EA;border-radius:10px;padding:24px 12px;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#171717;font-size:36px;font-weight:800;letter-spacing:14px;padding-left:14px;">{{ .Token }}</span>
</td></tr></table><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#3F3F46;font-size:14px;line-height:1.6;">This code expires in 60 minutes and can only be used once.</p></td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 18px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13.5px;line-height:1.6;">If you didn&#39;t request a password reset, ignore this email &mdash; your password won&#39;t change until you enter the code. If you have questions or complaints, please <a href="https://dormcheck.com/contact" style="color:#0B702B;text-decoration:underline;">contact us</a>.</p>
<p style="margin:0 0 8px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:13.5px;"><a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;text-decoration:none;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;text-decoration:none;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;text-decoration:none;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://x.com/dormcheck" style="color:#0B702B;text-decoration:none;">X</a></p>
<p style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn&#39;t affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>
```

---

## Reauthentication

**Subject:** `{{ .Token }} is your DormCheck security code`

**Body:**

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#ffffff;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;} a{text-decoration:none;}</style></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:44px 20px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
<tr><td align="left" style="padding-bottom:28px;">
<img src="https://dormcheck.com/dormcheck-logo-new.png" width="30" height="27" alt="" style="vertical-align:middle;display:inline-block;border:0;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:20px;font-weight:800;letter-spacing:-.3px;vertical-align:middle;padding-left:9px;">DormCheck</span>
</td></tr>
<tr><td align="left"><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Hi,</p><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#18181B;font-size:16px;line-height:1.6;">Enter this code to confirm it&#39;s you and continue:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr>
<td align="center" style="background:#F4F4F5;border:1px solid #E7E7EA;border-radius:10px;padding:24px 12px;">
<span style="font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#171717;font-size:36px;font-weight:800;letter-spacing:14px;padding-left:14px;">{{ .Token }}</span>
</td></tr></table><p style="margin:0px 0 15px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#3F3F46;font-size:14px;line-height:1.6;">This code expires in a few minutes.</p></td></tr>
<tr><td style="padding-top:26px;"><div style="height:1px;background:#E4E4E7;font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="left" style="padding-top:20px;">
<p style="margin:0 0 18px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13.5px;line-height:1.6;">If you didn&#39;t request this, someone may be trying to access your account. Ignore this email and consider changing your password. If you have questions or complaints, please <a href="https://dormcheck.com/contact" style="color:#0B702B;text-decoration:underline;">contact us</a>.</p>
<p style="margin:0 0 8px;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;font-size:13.5px;"><a href="https://www.instagram.com/dormcheck_app" style="color:#0B702B;text-decoration:none;">Instagram</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.tiktok.com/@dormcheck" style="color:#0B702B;text-decoration:none;">TikTok</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://www.linkedin.com/company/dormcheck" style="color:#0B702B;text-decoration:none;">LinkedIn</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://x.com/dormcheck" style="color:#0B702B;text-decoration:none;">X</a></p>
<p style="margin:0;font-family:'Nunito','Segoe UI',Helvetica,Arial,sans-serif;color:#71717A;font-size:13px;line-height:1.75;">
&copy; 2026 DormCheck<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span>Pittsburgh, PA<span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/privacy" style="color:#0B702B;text-decoration:underline;">Privacy</a><span style="color:#C7CCD2;">&nbsp;|&nbsp;</span><a href="https://dormcheck.com/terms" style="color:#0B702B;text-decoration:underline;">Terms</a><br>
DormCheck is an independent platform and isn&#39;t affiliated with any university.
</p>
</td></tr>
</table></td></tr></table></body></html>
```
