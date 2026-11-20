/** Affiliate short links / Amazon product URLs - e.g. Shop Essentials "Buy on Amazon" rows. */
export function isAmazonAffiliateUrl(link: string | null | undefined): boolean {
  const t = (link ?? "").trim();
  if (!t) return false;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const h = new URL(withProto).hostname.toLowerCase();
    return (
      h === "amzn.to" ||
      h.endsWith(".amzn.to") ||
      h === "amazon.com" ||
      h.endsWith(".amazon.com")
    );
  } catch {
    return /\bamzn\.to\b/i.test(t) || /\bamazon\.com\b/i.test(t);
  }
}

const AFFILIATE_TAG = "dormcheck-20";

/** True only for parseable http(s) URLs - guards guest-facing hrefs against javascript:/data: schemes. */
export function isSafeHttpUrl(link: string | null | undefined): link is string {
  const t = (link ?? "").trim();
  if (!t) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Ensure Amazon product URLs carry the Associates tag (`tag=dormcheck-20`).
 * Non-Amazon URLs (and amzn.to short links, which carry the tag server-side)
 * pass through unchanged.
 */
export function withAffiliateTag(link: string): string {
  const t = link.trim();
  if (!t) return link;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const url = new URL(withProto);
    const h = url.hostname.toLowerCase();
    if (h !== "amazon.com" && !h.endsWith(".amazon.com")) return withProto;
    url.searchParams.set("tag", AFFILIATE_TAG);
    return url.toString();
  } catch {
    return link;
  }
}
