/**
 * Payment-risk detection for DM threads (P0.7 scam interstitial). When a
 * conversation mentions deposits or off-platform / hard-to-reverse payment
 * rails, the thread shows a one-time safety warning. Detection is purely
 * client-side and display-only - nothing is blocked or reported.
 */
const PAYMENT_RISK_PATTERN =
  /\b(deposit|venmo|zelle|cash\s?app|paypal|apple\s?pay|wire\s?(transfer)?|western\s?union|money\s?(gram|order)|gift\s?card|crypto|bitcoin)\b/i;

export function hasPaymentRiskSignal(text: string | null | undefined): boolean {
  return !!text && PAYMENT_RISK_PATTERN.test(text);
}

export const PAYMENT_SAFETY_WARNING =
  'Money talk? Never send a deposit before an in-person or video tour, keep payments on traceable methods, and be wary of anyone rushing you. DormCheck never asks you to pay another student.';

/** sessionStorage key: the warning stays dismissed per conversation per session. */
export function paymentWarningDismissKey(conversationId: string): string {
  return `dc_payment_warning_dismissed_${conversationId}`;
}

/**
 * Outbound contact/payment sharing detection (P1.11): a phone number, email
 * address, or payment handle in a message YOU are sending. Send is never
 * blocked - the first attempt per conversation asks for confirmation so
 * moving off-platform is a deliberate choice, not a reflex.
 */
const PHONE_PATTERN = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b\d{10}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

export function hasContactShareSignal(text: string | null | undefined): boolean {
  if (!text) return false;
  return PHONE_PATTERN.test(text) || EMAIL_PATTERN.test(text) || PAYMENT_RISK_PATTERN.test(text);
}

export const CONTACT_SHARE_WARNING =
  "Sharing contact or payment info? Chats on DormCheck keep a record if something goes wrong. Tap send again if you're sure.";

/** sessionStorage key: the send confirmation asks once per conversation per session. */
export function contactShareConfirmKey(conversationId: string): string {
  return `dc_contact_share_confirmed_${conversationId}`;
}
