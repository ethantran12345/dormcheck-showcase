-- requires: 20260910000000_marketplace_service_posts.sql
--
-- #144 / #155 — the anon marketplace projection stops publishing surnames.
--
-- DECISION (Ethan, 2026-08-06): drop `p.full_name` from the guest projection and
-- expose a FIRST NAME ONLY. A full name + building + item on an unauthenticated
-- page is a doxxing dataset for a specific named undergrad: one unauthenticated
-- script yielded {full_name, university, item, price, meetup_location} for every
-- student with an approved listing. 20260830050000 removed the user_id join key
-- and stripped room numbers off meetup_location, which took the corpus from
-- "targeting dataset" down to "named roster" — this migration takes the name off
-- it too, which is the last identifying field on the anon path.
--
-- Why a first name still ships: the guest listing card and detail modal show a
-- seller so the feed reads as a real market rather than an anonymous dump
-- (App Store 5.1.1(v) browsing). "Ethan" is not a person-locator; "Ethan Tran"
-- at a named building is.
--
-- WHAT CHANGES: exactly one expression, `seller_name`. The column NAME and TYPE
-- are unchanged on purpose, so this is a CREATE OR REPLACE VIEW rather than a
-- drop/recreate:
--   * non-destructive DDL — nothing for db:preflight to gate, no window where
--     the guest feed 404s;
--   * order-independent deploy — an already-deployed client that selects
--     `seller_name` keeps working the moment this lands (it just renders a first
--     name), so the migration can go to prod before or after the web deploy
--     without an expand/contract dance.
-- Renaming it to `seller_first_name` was considered and rejected for exactly
-- that reason: the rename is the only part that would have forced a synchronized
-- cutover, and a synchronized cutover on the App Store browse surface is the
-- risk, not the safety.
--
-- The derivation: first whitespace-delimited token of the trimmed full name,
-- then trailing punctuation trimmed so a "Tran, Ethan" style entry does not
-- publish the surname as if it were a given name. NULL and '' both collapse to
-- NULL, and the client already renders a nameless card for NULL.
--
-- >>> HAZARD FOR WHOEVER APPLIES THE BACKLOG: prod is currently 8 migrations
-- >>> behind, and 20260910000000_marketplace_service_posts.sql — which is one of
-- >>> them — DROPs and recreates this view with `p.full_name AS seller_name`,
-- >>> reintroducing this exact leak. That is fine only because THIS migration
-- >>> sorts after it and restores first-name-only. Apply them as a pair, never
-- >>> 20260910000000 alone. Same rule as the 20260829000000 -> 20260830050000
-- >>> pairing that migration's own header warns about.
--
-- Coverage: supabase/tests/marketplace_guest_view_harden.test.sql asserts the
-- projected name is single-token; e2e/auth-gating-canary.spec.ts asserts the
-- same property against the live wire payload on dormcheck.com.
--
-- Rollback (reintroduces the leak — do not, without a written decision):
--   replace the seller_name expression below with `p.full_name`.

CREATE OR REPLACE VIEW private.marketplace_public
WITH (security_barrier = true) AS
SELECT
  l.id,
  l.university_id,
  l.title,
  l.description,
  l.price,
  l.original_price,
  l.category,
  l.condition,
  l.image_urls,
  -- Anon-path sanitization (20260830050000): strip keyworded room tokens, then
  -- any remaining digit runs, then collapse the leftover whitespace/punctuation.
  nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(l.meetup_location,
            '(room|rm\.?|apt\.?|suite|unit|floor|fl\.?|#)\s*[0-9]+[a-z]?', ' ', 'gi'),
          '[0-9]+(st|nd|rd|th)?[a-z]?', ' ', 'gi'),
        '\s+', ' ', 'g'),
      ' ,-'),
    ''
  ) AS meetup_location,
  l.price_negotiable,
  l.payment_methods,
  l.status,
  l.verified_at,
  l.created_at,
  l.post_type,
  l.service_category,
  l.service_date,
  l.service_duration_minutes,
  -- Same sanitization as meetup_location: service_location is the anon-visible
  -- "where", so it must not carry a room number either.
  nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(l.service_location,
            '(room|rm\.?|apt\.?|suite|unit|floor|fl\.?|#)\s*[0-9]+[a-z]?', ' ', 'gi'),
          '[0-9]+(st|nd|rd|th)?[a-z]?', ' ', 'gi'),
        '\s+', ' ', 'g'),
      ' ,-'),
    ''
  ) AS service_location,
  l.service_notes,
  false AS show_instagram,
  false AS show_snapchat,
  false AS show_phone,
  -- #144/#155: FIRST NAME ONLY. Never restore p.full_name here.
  nullif(btrim((regexp_split_to_array(btrim(p.full_name), '\s+'))[1], ' ,.-'), '')
    AS seller_name,
  coalesce(
    (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id', i.id,
                 'listing_id', i.listing_id,
                 'name', i.name,
                 'price', i.price,
                 'status', i.status,
                 'x', i.x,
                 'y', i.y,
                 'photo_index', i.photo_index
               )
               ORDER BY i.photo_index NULLS LAST, i.id
             )
      FROM public.marketplace_listing_items i
      WHERE i.listing_id = l.id
    ),
    '[]'::jsonb
  ) AS items
FROM public.marketplace_listings l
LEFT JOIN public.profiles_public p ON p.id = l.user_id
WHERE l.status IN ('available', 'pending', 'open', 'claimed')
  AND l.post_type <> 'sublease'
  AND l.moderation_decision = 'approved';

COMMENT ON VIEW public.marketplace_public IS
  'Guest-readable, approved-only (fail-closed), PII-free projection of marketplace_listings (App Store 5.1.1(v)). Covers items and service posts. No user_id join key; seller_name is FIRST NAME ONLY (#144/#155, 2026-08-06) - never restore full_name; meetup_location and service_location are room-number-stripped; contact columns excluded with show_* pinned false. Cross-school by design (decision 2026-08-01) - the client school filter is UX, not a boundary. New columns must be added to both column lists deliberately.';
