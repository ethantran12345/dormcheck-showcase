-- Advisor findings #164-#176: "Public / Signed-In Users Can Execute SECURITY
-- DEFINER Function" across 8 functions (13 issues; the three trigger functions
-- are each reported twice, once for anon and once for authenticated).
--
-- These were worked one at a time, not as a batch. Each revoke below is
-- justified by a live-caller search plus, where the answer was not decidable by
-- reading, a rolled-back probe run against PROD. The four grants that a real
-- caller depends on are NOT touched and are listed at the bottom with the
-- reason, so the next person does not "finish the job" and break them.
--
-- ── The two facts everything below rests on, both established empirically ────
--
-- FACT 1 — a trigger fires even when the invoking role has no EXECUTE on the
--   trigger function. Probed on prod inside BEGIN/ROLLBACK: created a table +
--   BEFORE INSERT trigger, REVOKEd EXECUTE from PUBLIC/anon/authenticated, then
--   inserted as `authenticated` — the trigger still fired and still rewrote the
--   row. Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time,
--   not per fire. A trigger function also cannot be invoked directly (it returns
--   `trigger`), so its EXECUTE grant is INERT: it protects nothing and grants
--   nothing. That makes the three `protect_*` revokes pure surface removal.
--
-- FACT 2 — an RLS policy expression DOES enforce EXECUTE on the functions it
--   calls, as the querying role. Probed the same way: a policy calling a definer
--   function whose EXECUTE had been revoked failed the SELECT outright with
--   `42501 permission denied for function`. This is why `dorm_university` and
--   `ranking_group_university` keep their authenticated grant — revoking them
--   would not "harden" anything, it would take `group_dorm_rankings` offline for
--   every signed-in student.
--
-- FACT 3 (corollary, also probed) — a SECURITY DEFINER wrapper insulates the
--   functions it calls: the inner call runs as the wrapper's owner, so the
--   CALLER needs no EXECUTE on the inner function. This is what makes the
--   `group_university` revoke safe.

-- ── #166 / #173 — protect_backup_code_delete() ──────────────────────────────
-- Trigger function, returns trigger, bound to mfa_backup_codes.protect_backup_code_delete.
-- No policy, view, constraint or other function references it. Inert per FACT 1.
REVOKE EXECUTE ON FUNCTION public.protect_backup_code_delete() FROM PUBLIC, anon, authenticated;

-- ── #167 / #174 — protect_business_listing_moderation() ─────────────────────
-- Trigger function, bound to business_listings.protect_business_listing_moderation.
-- No other reference anywhere in the catalog. Inert per FACT 1.
REVOKE EXECUTE ON FUNCTION public.protect_business_listing_moderation() FROM PUBLIC, anon, authenticated;

-- ── #168 / #175 — protect_seller_rating_target() ────────────────────────────
-- Trigger function, bound to seller_ratings.protect_seller_rating_target.
-- No other reference anywhere in the catalog. Inert per FACT 1.
REVOKE EXECUTE ON FUNCTION public.protect_seller_rating_target() FROM PUBLIC, anon, authenticated;

-- ── #165 / #171 — group_university(uuid) ────────────────────────────────────
-- Reached from exactly ONE place: public.delete_group_message, which is itself
-- SECURITY DEFINER, so per FACT 3 its caller needs no EXECUTE here. Appears in
-- no RLS policy, view or constraint (the earlier "used in a policy" reading was
-- a substring artifact — the policy text contains `ranking_group_university`,
-- a different function). No client calls it: `src/` and `api/` mention it only
-- in the generated type files. Safe for both roles.
REVOKE EXECUTE ON FUNCTION public.group_university(uuid) FROM PUBLIC, anon, authenticated;

-- ── #164 — estimate_ad_reach(uuid, integer[]) — ANON ONLY ───────────────────
-- The single live caller is src/pages/advertiser/AdvertiserPortalPage.tsx:319,
-- and /advertise is wrapped in <ProtectedRoute> (src/routes/AdvertiserRoutes.tsx)
-- on top of invite-gated advertiser accounts — so no signed-out path reaches it.
-- Revoking PUBLIC + anon leaves the EXPLICIT `authenticated=X` ACL entry intact
-- (it is granted in its own right, not inherited from PUBLIC), so the portal is
-- unaffected. #170 (the authenticated half) is deliberately NOT actioned.
REVOKE EXECUTE ON FUNCTION public.estimate_ad_reach(uuid, integer[]) FROM PUBLIC, anon;
-- Re-affirmed rather than assumed, so this migration is correct even if a future
-- edit changes how `authenticated` obtained the privilege.
GRANT EXECUTE ON FUNCTION public.estimate_ad_reach(uuid, integer[]) TO authenticated;

-- ── DELIBERATELY UNCHANGED — a real caller depends on each of these ─────────
--   #169  dorm_university(bigint)          authenticated — called directly in the
--         WITH CHECK of group_dorm_rankings."Accepted members manage group
--         rankings". Revoking = 42501 for every signed-in student (FACT 2).
--   #176  ranking_group_university(uuid)   authenticated — called in BOTH the
--         USING and WITH CHECK of that same policy. Same breakage.
--   #170  estimate_ad_reach(...)           authenticated — the advertiser portal
--         reach estimator, AdvertiserPortalPage.tsx:319.
--   #172  mint_backup_codes()              authenticated — the MFA enrolment path,
--         src/lib/mfa.ts:21. Codes are minted server-side precisely so the client
--         never generates them; removing this grant disables MFA enrolment.
-- None of these four is a finding that can be closed by revoking. They are the
-- intended shape: a definer function that authenticated is SUPPOSED to reach,
-- whose safety comes from its own body and search_path pinning, not from the grant.
