-- requires: 20260830040000_marketplace_moderation_decision_backfill.sql
--
-- P3 (guest exposure review 2026-08-01, Ethan's decisions): harden the anon
-- marketplace projection. Ships options A + C + D + F from
-- docs/audits/marketplace-guest-exposure-options.md; encodes E as an explicit
-- product decision; and additionally sanitizes meetup_location on the anon path.
--
--   A — user_id is DROPPED from both views. It was the stable per-student join
--       key that made the anon corpus scrapeable as a dataset; the guest UI
--       never reads it (mapGuestRows spread it into a field no guest-path
--       consumer touches — every listing.user_id read is gated on `user &&`).
--   C — the public wrapper lists its columns EXPLICITLY (was `select *`).
--       >>> Any new column added to marketplace_listings (or to the private
--       >>> view) is anon-INVISIBLE by default. Publishing a new column to
--       >>> guests is a deliberate act: add it to BOTH column lists here in a
--       >>> new migration, and justify it in the security-posture audit.
--   D — the predicate is now moderation_decision = 'approved', fail CLOSED.
--       The former coalesce(moderation_decision,'approved') treated legacy
--       NULLs as approved — the P0-1 bug class. 20260830040000 backfills
--       classifiable legacy rows first; unclassifiable ones stay NULL and are
--       simply absent from the guest feed.
--   E — PRODUCT DECISION (Ethan, 2026-08-01): guest browse is GLOBAL, i.e.
--       cross-school, deliberately. A prospective transfer or incoming student
--       browsing another school's market is a growth surface, and it is
--       consistent with "extension of campus systems, not a replacement."
--       There is intentionally NO tenant predicate here; the client narrows to
--       one school with a UX-layer filter (MarketplaceTab guest fetch,
--       .eq('university_id', …)), which is a presentation choice, not a
--       security boundary. Do not "fix" this by adding a tenant clamp.
--   meetup_location — seller-authored free text that in practice carries dorm/
--       building names and sometimes ROOM numbers; with a name attached it is
--       the field that turns the feed into a targeting dataset. The guest UI
--       renders it (listing card + detail modal), so it cannot simply be
--       omitted; instead the anon projection strips room-number-shaped tokens
--       (keyworded "Room/Apt/Suite/Floor/# 1201B" forms, then any remaining
--       standalone digit runs like "1201" / "5th") and tidies whitespace.
--       Building-level text survives ("Towers Lobby"); the precise room does
--       not. Authenticated users keep the full value via the base table.
--   F — the inert `grant select on private.marketplace_listings_contact to
--       anon` (20260813040000:24) is revoked. Nothing anon-side ever read it
--       (the public wrapper was already REVOKEd from anon in 20260621130000,
--       and src/lib/marketplaceContact.ts runs authenticated); it existed only
--       as a latent path where one PostgREST schema-exposure config change
--       away, anon could read seller phone/Instagram/Snapchat.
--
-- Views are dropped and recreated (CREATE OR REPLACE VIEW cannot remove a
-- column). Security posture (definer private view + invoker public wrapper +
-- security_barrier on both) is unchanged from 20260829000000 — see that
-- header for the full rationale.
--
-- Rollback:
--   re-run 20260829000000 (recreates both views with the old shape);
--   grant select on private.marketplace_listings_contact to anon;

drop view if exists public.marketplace_public;
drop view if exists private.marketplace_public;

create view private.marketplace_public
with (security_barrier = true) as
select
  l.id,
  l.university_id,
  l.title,
  l.description,
  l.price,
  l.original_price,
  l.category,
  l.condition,
  l.image_urls,
  -- Anon-path sanitization (see header): strip keyworded room tokens, then any
  -- remaining digit runs, then collapse the leftover whitespace/punctuation.
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
  ) as meetup_location,
  l.price_negotiable,
  l.payment_methods,
  l.status,
  l.verified_at,
  l.created_at,
  false as show_instagram,
  false as show_snapchat,
  false as show_phone,
  p.full_name as seller_name,
  coalesce(
    (
      select jsonb_agg(
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
               order by i.photo_index nulls last, i.id
             )
      from public.marketplace_listing_items i
      where i.listing_id = l.id
    ),
    '[]'::jsonb
  ) as items
from public.marketplace_listings l
left join public.profiles_public p on p.id = l.user_id
where l.status in ('available', 'pending')
  and l.is_sublease = false
  and l.moderation_decision = 'approved';

grant select on private.marketplace_public to anon, authenticated;

-- C: explicit column list — a new base/private column never auto-publishes.
create view public.marketplace_public
with (security_invoker = true, security_barrier = true) as
select
  id,
  university_id,
  title,
  description,
  price,
  original_price,
  category,
  condition,
  image_urls,
  meetup_location,
  price_negotiable,
  payment_methods,
  status,
  verified_at,
  created_at,
  show_instagram,
  show_snapchat,
  show_phone,
  seller_name,
  items
from private.marketplace_public;

grant select on public.marketplace_public to anon, authenticated;

comment on view public.marketplace_public is
  'Guest-readable, approved-only (fail-closed), PII-free projection of marketplace_listings (App Store 5.1.1(v)). No user_id join key; meetup_location is room-number-stripped; contact columns excluded with show_* pinned false. Cross-school by design (decision 2026-08-01) — the client school filter is UX, not a boundary. New columns must be added to both column lists deliberately.';

-- F: dead anon surface on the contact view.
revoke select on private.marketplace_listings_contact from anon;
