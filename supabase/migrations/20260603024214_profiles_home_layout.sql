-- Per-user My Home widget order and visibility preferences.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_layout jsonb DEFAULT NULL;

COMMENT ON COLUMN public.profiles.home_layout IS
  'My Home dashboard layout: { "order": string[], "hidden": string[] }';
