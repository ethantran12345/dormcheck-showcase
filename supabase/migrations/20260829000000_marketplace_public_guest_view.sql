-- App Store guideline 5.1.1(v): the Student Market must be browsable without an
-- account. Registration may only be required for the account-based parts
-- (messaging a seller, saving, reporting, posting).
--
-- The feed was gated at TWO layers: the `ProtectedRoute` on /marketplace, and
-- `REVOKE ALL ON public.marketplace_listings FROM anon`
-- (20260613240000_lock_marketplace_reviews_setups_authenticated_only.sql, which
-- exists to keep seller PII off the anon surface). Removing only the route guard
-- would render an empty page for guests, so this migration adds the missing
-- read path instead of re-granting anon on the base table.
--
-- `public.marketplace_public` is a read-only, approved-only, PII-free projection:
--   * NO contact columns. phone_number / instagram_handle / snapchat_handle are
--     not selected here at all, and `marketplace_listings_contact` keeps its
--     existing authenticated-only posture — unchanged by this migration.
--   * The three `show_*` opt-in flags are projected as constant FALSE so the
--     client renders no contact affordance for a guest even if it forgets to
--     branch on auth. The real flags stay readable on the base table for
--     authenticated callers.
--   * Approved-only. `status IN ('available','pending')` is the approval signal:
--     `guard_listing_status_change()` (20260719150000_marketplace_pre_moderation)
--     makes it impossible for a non-service_role, non-admin owner to move a row
--     out of 'pending_review'/'under_review', so reaching 'available' means the
--     moderator approved it. The explicit `moderation_decision` test is belt and
--     braces; legacy rows pre-dating the moderation columns are NULL and were
--     live-by-approval, hence the coalesce.
--   * Seller display name is denormalised from `public.profiles_public` — the
--     projection TABLE (20260820020000), not the `public_profiles` VIEW over it.
--     That view carries `security_invoker = true`, and security_invoker
--     propagates the *current* role rather than the calling view's owner, so
--     joining it here re-checks `profiles_public` as `anon`, whose RLS policy is
--     `TO authenticated` — the whole definer chain collapses and the guest read
--     fails with `42501: permission denied for table profiles_public`. Verified
--     against the local stack; joining the base table keeps the check on the
--     definer view's owner. Only `full_name` is read, which is exactly what the
--     `public_profiles` view exposes anyway.
--   * Seller display name is denormalised rather than
--     left to a PostgREST embed: `marketplace_public` is a view, and PostgREST
--     only resolves view→view embed lineage through API-exposed schemas (the
--     same constraint documented in 20260813000000_private_schema_for_definer_views).
--     Same reason `items` ships as a jsonb aggregate. One query, zero embeds,
--     so the guest path cannot fail on an unresolvable relationship.
--
-- SECURITY SETTINGS — the choice, and why:
--   * `private.marketplace_public` is left DEFINER-style (no security_invoker).
--     That is the entire point: it must read `public.marketplace_listings` as
--     its owner, because `anon` holds no grant on that table. A security_invoker
--     view here would run as `anon`, hit the REVOKE, and return 42501 — exactly
--     the empty page this migration exists to prevent.
--   * `public.marketplace_public` is a thin `security_invoker = true` wrapper.
--     This is the house pattern from 20260813000000: it keeps the definer
--     surface out of `public` (PostgREST never exposes `private`, so the definer
--     view is not directly API-reachable) and clears the `security_definer_view`
--     advisor ERROR (lint 0010) that a definer view in `public` would raise.
--   * `security_barrier = true` on BOTH. The WHERE clause here is a security
--     boundary, not a convenience filter — it is what keeps unapproved and
--     under-review listings away from anon. Without the barrier the planner is
--     free to push a cheap, user-supplied predicate (a leaky operator, or a
--     VOLATILE function in a client-controlled filter) below the moderation
--     test and observe rows the view is meant to withhold. The barrier costs
--     some pushdown; the client's filters here are plain equality/range on
--     indexed columns, so the practical cost is negligible.
--
-- No tenant filter inside the view: `public.current_university_id()` is not
-- EXECUTE-able by `anon` (the same reason the contact view 42501s for anon), so
-- the view exposes `university_id` and the client filters on it, matching what
-- the authenticated feed already does with `filters.universityId`.
--
-- Rollback:
--   drop view public.marketplace_public;
--   drop view private.marketplace_public;

create view private.marketplace_public
with (security_barrier = true) as
select
  l.id,
  l.user_id,
  l.university_id,
  l.title,
  l.description,
  l.price,
  l.original_price,
  l.category,
  l.condition,
  l.image_urls,
  l.meetup_location,
  l.price_negotiable,
  l.payment_methods,
  l.status,
  l.verified_at,
  l.created_at,
  -- Contact opt-ins are never true on the guest surface (see header).
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
  and coalesce(l.moderation_decision, 'approved') = 'approved';

grant select on private.marketplace_public to anon, authenticated;

create view public.marketplace_public
with (security_invoker = true, security_barrier = true) as
select * from private.marketplace_public;

grant select on public.marketplace_public to anon, authenticated;

comment on view public.marketplace_public is
  'Guest-readable, approved-only, PII-free projection of marketplace_listings (App Store 5.1.1(v)). Contact columns are excluded and the show_* opt-ins are constant false; seller contact stays on marketplace_listings_contact (authenticated only).';
