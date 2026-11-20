-- POST_HAVE place details: smoking policy, laundry, bathroom
ALTER TABLE public.roommate_search_posts
  ADD COLUMN IF NOT EXISTS smoking_allowed boolean,
  ADD COLUMN IF NOT EXISTS laundry text,
  ADD COLUMN IF NOT EXISTS bathroom text;
