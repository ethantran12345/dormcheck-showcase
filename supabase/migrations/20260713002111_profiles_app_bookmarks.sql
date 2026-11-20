-- Per-user bookmarked app pages for the signed-in desktop web sidebar
-- (Mercury-style "Bookmarks" section). Expand-only: nullable jsonb, NULL = none.
-- Client writes via the existing own-row profiles UPDATE policy; no new grants.
-- Shape: [{ "path": "/settings", "label": "Settings", "icon": "settings" }, ...]
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_bookmarks jsonb DEFAULT NULL;

COMMENT ON COLUMN public.profiles.app_bookmarks
  IS 'Ordered list of the user''s bookmarked app pages: [{path,label,icon}]. NULL = none. Desktop web nav convenience.';
