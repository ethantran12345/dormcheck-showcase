import { LEGAL_NOTICE_VERSION } from '../../src/lib/legalNotice';
import { serviceClient } from './api';

/**
 * Record that a seeded persona has already been shown the Privacy §11
 * legal-update notice, so the banner stays out of a UI flow test's way.
 *
 * WHY THIS IS NEEDED. `LegalUpdateNotice`
 * (`src/components/legal/LegalUpdateNotice.tsx`) is a `position: fixed`, `z-40`
 * card pinned to the bottom centre of every authed route, and its inner card is
 * `pointer-events-auto`. Anything it covers becomes unclickable: Playwright
 * reports `<div role="status" …> … subtree intercepts pointer events` and then
 * burns the entire test timeout retrying. That is exactly how
 * `marketplace.lifecycle.spec.ts` › "mark sold, then bring it back to
 * available" died at 45s in the 2026-08-16 audit — the banner sat on top of the
 * My Items card's "Mark as Sold" button. It is not a toast and never
 * auto-dismisses; a real user must acknowledge it before the bottom of the
 * screen is usable again.
 *
 * WHY AT THE DATABASE AND NOT THROUGH THE UI. Acknowledgement persists to
 * `profiles.legal_notice_ack_version`, so clicking it away is a one-time,
 * order-dependent side effect that later specs silently depend on. Writing the
 * column outright says what the fixture actually is — "this persona is a
 * returning user who has already been told" — costs no wall-clock, and cannot
 * flake on the banner's mount timing.
 *
 * WHY IT IS NOT IN `seed-test-users.mjs`. The crawl personas SHOULD still meet
 * this banner: "a fixed overlay swallows clicks on a real control" is precisely
 * the class of defect the audit exists to find, and seeding it away everywhere
 * would blind the crawl to the next one. Only the specs that must click
 * underneath it opt out, and they say so here.
 */
export async function acknowledgeLegalNotice(userId: string): Promise<void> {
  const { error } = await serviceClient()
    .from('profiles')
    .update({
      legal_notice_ack_version: LEGAL_NOTICE_VERSION,
      legal_notice_ack_at: new Date().toISOString(),
    } as never)
    .eq('id', userId);
  if (error) throw new Error(`could not acknowledge the legal notice: ${error.message}`);
}
