-- Per-user theme preference for the authed app shell (Mercury-style dark mode).
-- Expand-only: nullable, NULL = 'system' (follow OS). Client writes via the
-- existing own-row profiles UPDATE policy; no new grants needed.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_preference text DEFAULT NULL
  CHECK (theme_preference IS NULL OR theme_preference IN ('light', 'dark', 'system'));

COMMENT ON COLUMN public.profiles.theme_preference
  IS 'App theme: light | dark | system (NULL = system). Pre-auth surfaces are always light.';
