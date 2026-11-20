// api/_lib/notifications.ts 
// testing 123
import { Resend } from 'resend';
// Shared email chrome - single source of truth for ALL DormCheck emails (app
// transactional here + Supabase Auth emails via supabase/functions/send-auth-email).
import { getEmailHtml } from '../../supabase/functions/_shared/emailTemplate.js';
import { unsubscribeUrl } from './unsubscribe.js';
import type { NotificationCategory } from './notificationPrefs.js';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * One-click unsubscribe wiring (P0.4). Student notification emails pass the
 * recipient's user id + category; the send gains RFC 8058 List-Unsubscribe
 * headers (mail clients' native Unsubscribe button) and a footer link. Admin
 * and waitlist emails stay exempt (transactional/security - see below).
 */
export interface UnsubscribeInfo {
  userId: string;
  category: NotificationCategory;
}

function unsubHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// Sender routing (mailboxes exist in Google Workspace; dormcheck.com is
// Resend-verified). Student notifications come from no-reply but a human
// reply still lands in the support inbox via Reply-To. TEAM mail sets NO
// Reply-To at all: team@ is itself monitored, and a Reply-To identical to
// the From address only makes mail clients render a redundant "Reply To"
// row in the header. Never add one back that duplicates the sender.
const NOREPLY = 'DormCheck <noreply@dormcheck.com>';
const TEAM = 'DormCheck <team@dormcheck.com>';
const REPLY_TO_SUPPORT = 'support@dormcheck.com';

/**
 * Format a numeric marketplace price for a preview line. Whole dollars render
 * as "$45"; fractional as "$45.50". null/undefined -> undefined (line omitted).
 */
function formatPrice(price: number | null | undefined): string | undefined {
  if (typeof price !== 'number' || !Number.isFinite(price)) return undefined;
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

function requireApiKey(): void {
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error('[notifications] RESEND_API_KEY is not set. Add it in Vercel Project Settings → Environment Variables.');
    throw new Error('RESEND_API_KEY is not configured');
  }
}

async function sendEmail(opts: Parameters<Resend['emails']['send']>[0]) {
  requireApiKey();
  const { data, error } = await resend.emails.send(opts);
  if (error) {
    console.error('Resend send error:', error);
    throw new Error(error.message || 'Failed to send email');
  }
  return data;
}

export async function sendNewMessageEmail(
  to: string,
  senderName: string,
  conversationId: string,
  unsub?: UnsubscribeInfo,
  messageSnippet?: string | null,
) {
  const buttonUrl = conversationId?.trim()
    ? `https://dormcheck.com/messages?conversation=${encodeURIComponent(conversationId.trim())}`
    : 'https://dormcheck.com/messages';
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  const quote = typeof messageSnippet === 'string' && messageSnippet.trim() ? messageSnippet.trim() : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: '💬 New Message on DormCheck',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      `New Message from ${senderName}`,
      `You have received a new message regarding your housing search.`,
      'Reply Now',
      buttonUrl,
      unsubUrl,
      quote ? { preview: { quote } } : undefined,
    ),
  });
}

export async function sendNewMessageRequestEmail(
  to: string,
  senderName: string,
  conversationId: string,
  unsub?: UnsubscribeInfo,
  messageSnippet?: string | null,
) {
  const buttonUrl = conversationId?.trim()
    ? `https://dormcheck.com/messages?conversation=${encodeURIComponent(conversationId.trim())}`
    : 'https://dormcheck.com/messages';
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  const quote = typeof messageSnippet === 'string' && messageSnippet.trim() ? messageSnippet.trim() : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: '💬 New Message Request on DormCheck',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'New message request',
      `${senderName} sent you a message request on DormCheck. Log in to accept or decline.`,
      'View Request',
      buttonUrl,
      unsubUrl,
      quote ? { preview: { quote } } : undefined,
    ),
  });
}

export async function sendRankingInviteEmail(to: string, senderName: string, inviteCode: string, unsub?: UnsubscribeInfo) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: '🤝 Ranking Invite',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      `${senderName} invited you to collaborate`,
      `Work together on your Dorm Ranking list to find the perfect housing match.`,
      'Join Collaboration',
      `https://dormcheck.com/rankings/invite/${inviteCode}`,
      unsubUrl
    ),
  });
}

export async function sendHousingGroupInviteEmail(to: string, senderName: string | null | undefined, unsub?: UnsubscribeInfo) {
  const safeSender = typeof senderName === 'string' && senderName.trim() ? senderName.trim() : 'Someone';
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: '🤝 You’ve been invited to join a housing group on DormCheck!',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      `You’ve been invited to join a housing group`,
      `${safeSender} invited you to join their housing group on DormCheck. Tap below to open DormCheck and join your group.`,
      'Open DormCheck',
      `https://dormcheck.com/campus`,
      unsubUrl
    ),
  });
}

export async function sendMarketplaceInquiryEmail(
  to: string,
  itemName: string,
  unsub?: UnsubscribeInfo,
  extra?: { imageUrl?: string | null; price?: number | null; messageSnippet?: string | null },
) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  const lines = [itemName, formatPrice(extra?.price)].filter((l): l is string => !!l);
  const quote =
    typeof extra?.messageSnippet === 'string' && extra.messageSnippet.trim()
      ? extra.messageSnippet.trim()
      : undefined;
  const preview = {
    imageUrl: extra?.imageUrl ?? undefined,
    lines,
    quote,
  };
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: '🏠 Marketplace Inquiry',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      `New Inquiry: ${itemName}`,
      `Someone is interested in your listing. Check your inbox to respond.`,
      'View Inquiry',
      'https://dormcheck.com/marketplace/inbox',
      unsubUrl,
      { preview },
    ),
  });
}

export async function sendMessageRequestAcceptedEmail(to: string, accepterName: string, conversationId: string, unsub?: UnsubscribeInfo) {
  const buttonUrl = conversationId?.trim()
    ? `https://dormcheck.com/messages?conversation=${encodeURIComponent(conversationId.trim())}`
    : 'https://dormcheck.com/messages';
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: '✅ Your message request was accepted on DormCheck',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'Your message request was accepted',
      `${accepterName} accepted your message request. You can now chat freely.`,
      'Open Conversation',
      buttonUrl,
      unsubUrl
    ),
  });
}

/**
 * Admin invitations are security-critical account notices, not marketing, so
 * callers must NOT gate these on profiles.email_notifications.
 */
export async function sendAdminInviteEmail(to: string, inviterName: string, universityName: string, token: string) {
  await sendEmail({
    from: TEAM,
    to,
    subject: 'You are invited to be a DormCheck admin',
    html: getEmailHtml(
      `${inviterName} invited you to help manage DormCheck`,
      `You have been invited to join the ${universityName} admin team on DormCheck. Sign in with this email address and your admin access will be applied automatically. This invitation expires in 14 days.`,
      'Accept Invitation',
      `https://dormcheck.com/auth?invite=${encodeURIComponent(token)}`
    ),
  });
}

export async function sendAdminGrantedEmail(to: string, universityName: string) {
  await sendEmail({
    from: TEAM,
    to,
    subject: 'You now have DormCheck admin access',
    html: getEmailHtml(
      'You are now a DormCheck admin',
      `You have been granted admin access for ${universityName} on DormCheck. Sign in to review reports, manage your team, and see campus activity.`,
      'Open Admin Console',
      'https://dormcheck.com/admin/dashboard'
    ),
  });
}

export async function sendGroupInviteAcceptedEmail(to: string, accepterName: string, groupName: string, unsub?: UnsubscribeInfo) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: "✅ Someone joined your group on DormCheck",
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'Someone joined your group',
      `${accepterName} accepted your invite and joined "${groupName}".`,
      'Open Group Chat',
      'https://dormcheck.com/messages',
      unsubUrl
    ),
  });
}

/**
 * Weekly admin digest (P1.8b): Monday-morning scorecard strip for a
 * university_admin. Operational admin mail from TEAM; gated on
 * profiles.email_notifications by the cron, deduped via admin_email_log.
 */
export async function sendAdminWeeklyDigestEmail(
  to: string,
  universityName: string,
  metrics: { newSignups: number; newListings: number; openReports: number },
) {
  const body =
    `Your ${universityName} week on DormCheck: ` +
    `${metrics.newSignups} new student${metrics.newSignups === 1 ? '' : 's'} signed up, ` +
    `${metrics.newListings} new marketplace listing${metrics.newListings === 1 ? '' : 's'}, ` +
    `and ${metrics.openReports} open report${metrics.openReports === 1 ? '' : 's'} in your queue.`;
  await sendEmail({
    from: TEAM,
    to,
    subject: `Your weekly ${universityName} scorecard`,
    html: getEmailHtml('Your week at a glance', body, 'View full scorecard', 'https://dormcheck.com/admin/dashboard'),
  });
}

/** 48h unactioned-report nudge (P1.8b). Max one admin email per day (cron-enforced). */
export async function sendAdminReportNudgeEmail(to: string, count: number, oldestHours: number) {
  const body =
    count === 1
      ? `A report has been waiting for review for about ${oldestHours} hours.`
      : `${count} reports are waiting for review; the oldest has been open for about ${oldestHours} hours.`;
  await sendEmail({
    from: TEAM,
    to,
    subject: 'Reports are waiting for review',
    html: getEmailHtml('Your reports queue needs attention', body, 'Open Reports Queue', 'https://dormcheck.com/admin/reports'),
  });
}

/**
 * Immediate alert to the monitored moderation inbox the moment a content report
 * is filed (App Store 1.2: /terms and /moderation publish a 24-hour commitment
 * to remove the content and eject the user, and an unmet published SLA is worse
 * than a vaguer one). The 48h `report-nudge` cron is the backstop for a report
 * that was seen and then sat; this is what makes the first look happen at all.
 *
 * Deliberately NOT gated on profiles.email_notifications: the destination is an
 * operational inbox, not a user's preference-bearing account.
 */
export async function sendContentReportAlertEmail(args: {
  reportId: string;
  contentType: string;
  category: string;
  reason: string;
}) {
  // getEmailHtml escapes the body, so markup here would render literally -
  // the detail lines belong in the preview card, which renders them as real
  // paragraphs (max 3, so contentType + category share a line).
  const pretty = (v: string) => v.replace(/_/g, ' ').trim();
  const lines = [
    [args.contentType, args.category].filter(Boolean).map(pretty).join(' · '),
    args.reason ? `Reason: ${pretty(args.reason)}` : '',
    `Report ID: ${args.reportId}`,
  ].filter(Boolean);
  await sendEmail({
    from: TEAM,
    to: 'support@dormcheck.com',
    subject: `New content report (${pretty(args.contentType)})`,
    html: getEmailHtml(
      'New content report',
      'A new report was filed and the 24-hour clock is running.',
      'Open Reports Queue',
      'https://dormcheck.com/admin/reports',
      undefined,
      { preview: { lines } },
    ),
  });
}

/**
 * Transactional confirmation to someone who just joined the university
 * waitlist (not a user; profiles.email_notifications does not apply). Only
 * ever called by api/join-waitlist.ts against the address it actually
 * inserted, so branded mail can't be aimed at arbitrary addresses.
 */
/**
 * "Your school just launched" - batch email to university_waitlist rows when a
 * waitlisted campus goes live (api/notify-school-launch.ts). Waitlist mail is
 * transactional to non-users; profiles.email_notifications does not apply.
 */
export async function sendSchoolLaunchEmail(to: string, schoolName: string) {
  const school = schoolName.trim() || 'your school';
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: `DormCheck is live at ${school}`,
    html: getEmailHtml(
      `It's live`,
      `DormCheck is now open at ${school}. See real dorm photos, build your move-in checklist, and shop the student marketplace.`,
      'Open DormCheck',
      // UTM params instead of Resend tracking: Resend has no per-send
      // open/click flags, and domain-wide click tracking would rewrite
      // Supabase auth links. Campaign clicks are measured in our analytics.
      'https://dormcheck.com/auth?utm_source=email&utm_medium=broadcast&utm_campaign=school-launch',
    ),
  });
}

/** Shared preview for the moderation-status emails: listing photo + title/price. */
function listingPreview(
  listingTitle: string,
  extra?: { imageUrl?: string | null; price?: number | null },
  extraLines: string[] = [],
) {
  const lines = [listingTitle, formatPrice(extra?.price), ...extraLines].filter((l): l is string => !!l);
  return { imageUrl: extra?.imageUrl ?? undefined, lines };
}

/** Listing restored/approved after moderation review (notify-listing-status). */
export async function sendListingApprovedEmail(
  to: string,
  listingTitle: string,
  unsub?: UnsubscribeInfo,
  extra?: { imageUrl?: string | null; price?: number | null },
) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: 'Your listing is live',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'Your listing is live',
      `Your listing "${listingTitle}" is approved and live on DormCheck. Students on your campus can see it now.`,
      'View listing',
      'https://dormcheck.com/marketplace/my-items',
      unsubUrl,
      { preview: listingPreview(listingTitle, extra) },
    ),
  });
}

/**
 * Listing removed/rejected by moderation (notify-listing-status). Helpful, not
 * punitive: names the reason and points at the published guidelines.
 */
export async function sendListingRejectedEmail(
  to: string,
  listingTitle: string,
  reason: string,
  unsub?: UnsubscribeInfo,
  extra?: { imageUrl?: string | null; price?: number | null },
) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  const reasonLine = typeof reason === 'string' && reason.trim() ? `Reason: ${reason.trim()}` : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: 'About your listing',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'About your listing',
      `We couldn't publish "${listingTitle}". Reason: ${reason} You can edit and repost anytime. Our listing guidelines explain what we look for. Questions, just reply to this email.`,
      'Read our guidelines',
      'https://dormcheck.com/moderation',
      unsubUrl,
      { preview: listingPreview(listingTitle, extra, reasonLine ? [reasonLine] : []) },
    ),
  });
}

/** Listing auto-hidden pending review (listing-freshness cron sweep / notify-listing-status). */
export async function sendListingUnderReviewEmail(
  to: string,
  listingTitle: string,
  unsub?: UnsubscribeInfo,
  extra?: { imageUrl?: string | null; price?: number | null },
) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: `We're reviewing your listing`,
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      `We're reviewing your listing`,
      `Thanks for posting "${listingTitle}". We give listings a quick look before they go back live, usually within a day. We'll email you when it's up.`,
      'My Marketplace',
      'https://dormcheck.com/marketplace/my-items',
      unsubUrl,
      { preview: listingPreview(listingTitle, extra) },
    ),
  });
}

/** A buyer left the seller a rating/review (notify-seller-rating). */
export async function sendSellerRatingEmail(
  to: string,
  raterName: string,
  stars: number,
  unsub?: UnsubscribeInfo,
  reviewComment?: string | null,
) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  const safeStars = Math.min(5, Math.max(1, Math.round(stars)));
  const quote = typeof reviewComment === 'string' && reviewComment.trim() ? reviewComment.trim() : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: 'You got a new review on DormCheck',
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'You got a new review',
      `${raterName} left you a ${safeStars}-star review on DormCheck.`,
      'See your reviews',
      'https://dormcheck.com/marketplace/my-items',
      unsubUrl,
      { preview: { stars: safeStars, quote } },
    ),
  });
}

/** A roommate assigned the recipient a group move-in checklist item (notify-checklist-assigned). */
export async function sendChecklistAssignedEmail(to: string, assignerName: string, itemName: string, unsub?: UnsubscribeInfo) {
  const unsubUrl = unsub ? unsubscribeUrl(unsub.userId, unsub.category) : undefined;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: `${assignerName} assigned you a move-in task`,
    headers: unsubUrl ? unsubHeaders(unsubUrl) : undefined,
    html: getEmailHtml(
      'You have a new move-in task',
      `${assignerName} assigned you "${itemName}" on your group's move-in checklist.`,
      'Open checklist',
      'https://dormcheck.com/checklist',
      unsubUrl,
      { preview: { lines: [itemName] } },
    ),
  });
}

export async function sendWaitlistConfirmationEmail(
  to: string,
  schoolName: string | null,
  rankLine: string | null, // e.g. "Your school is #3 of 47 on the waitlist." or null
) {
  const school = typeof schoolName === 'string' && schoolName.trim() ? schoolName.trim() : 'your school';
  const body = `You're on the DormCheck waitlist for ${school}. ${rankLine ? rankLine + ' ' : ''}` +
    `The more students from ${school} who join, the sooner we bring DormCheck to your campus - share your waitlist link to move up.`;
  await sendEmail({
    from: NOREPLY,
    to,
    replyTo: REPLY_TO_SUPPORT,
    subject: `You're on the DormCheck waitlist`,
    html: getEmailHtml(
      `You're on the list`,
      body,
      'See your school’s rank',
      'https://dormcheck.com/waitlist',
    ),
  });
}
