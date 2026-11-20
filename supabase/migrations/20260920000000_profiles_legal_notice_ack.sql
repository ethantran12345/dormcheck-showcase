-- Per-account record that a user has seen the in-platform notice for a material
-- change to Terms / Privacy.
--
-- WHY a VERSION and not a bare timestamp: Privacy §11 commits us to communicating
-- material changes in-platform or by email. A timestamp only answers "did they
-- dismiss something, once" — the next legal update would silently count that stale
-- dismissal and the user would never be told. Storing which version was
-- acknowledged means every future change re-notifies by construction. The value
-- is LEGAL_NOTICE_VERSION in src/lib/legalNotice.ts.
--
-- Additive only: no drop, no type change, no constraint removal, no backfill.
-- Existing rows get NULL, which reads as "never acknowledged" and correctly
-- notifies every current user about the 2026-08-12 change.
--
-- Grants: public.profiles carries TABLE-level SELECT/UPDATE for `authenticated`
-- (not column-scoped), so new columns inherit access and need no explicit GRANT.
-- RLS rls_profiles_select_own / rls_profiles_update already restrict both to
-- `id = auth.uid()`, so a user can only ever read or stamp their own row.

alter table public.profiles
  add column if not exists legal_notice_ack_version text,
  add column if not exists legal_notice_ack_at timestamptz;

comment on column public.profiles.legal_notice_ack_version is
  'Version string of the most recent legal notice this user dismissed (see LEGAL_NOTICE_VERSION in src/lib/legalNotice.ts). NULL means never acknowledged.';

comment on column public.profiles.legal_notice_ack_at is
  'When legal_notice_ack_version was recorded. Informational; the version drives whether the notice shows.';
