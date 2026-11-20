-- Carry the per-tenant master gate from the pre-rename jsonb key `phase1Only`
-- to its new name `limitedSurfaces`. EXPAND ONLY: the old key is deliberately
-- LEFT IN PLACE so a client still running the previous bundle keeps resolving
-- the tenant correctly. The contract migration that drops `phase1Only` comes in
-- a later release, after the dual-key read in src/hooks/useFeatureFlags.ts
-- (sanitizeOverrides) is removed.
--
-- Why this migration must exist at all — the silent-failure hazard:
-- universities.feature_flags is jsonb, so it accepts any key, and
-- sanitizeOverrides() drops keys it does not recognise. Renaming the reader
-- without carrying the data would make a row holding {"phase1Only": false}
-- sanitize to {}, fall back to the static default, and silently re-gate every
-- student at that school -- with no error in any log, client or server. This
-- was reproduced as a failing test before the fix landed; the regression lives
-- in src/test/featureFlagOverrides.test.ts under "sanitizeOverrides".
--
-- The flag is a pure rename: `limitedSurfaces` means exactly what `phase1Only`
-- meant (run the reduced surface set). Only the name changed, because the
-- institutional pilot the old name referred to no longer exists.

UPDATE public.universities
SET feature_flags = feature_flags || jsonb_build_object('limitedSurfaces', feature_flags -> 'phase1Only')
WHERE jsonb_typeof(feature_flags -> 'phase1Only') = 'boolean'
  -- Idempotent, and never clobbers a value someone already wrote under the new
  -- key: only rows that lack `limitedSurfaces` are touched.
  AND feature_flags -> 'limitedSurfaces' IS NULL;

COMMENT ON COLUMN public.universities.feature_flags IS
  'Sparse per-tenant feature-flag overrides (camelCase keys, mirrors client FeatureFlags + limitedSurfaces). Missing keys inherit the static config default. "phase1Only" is the DEPRECATED former name of "limitedSurfaces" and is still read by the client for one release.';
