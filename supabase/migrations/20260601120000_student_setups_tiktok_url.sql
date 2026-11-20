-- Optional TikTok dorm tour video link on student room setups
ALTER TABLE public.student_setups
  ADD COLUMN IF NOT EXISTS tiktok_url text;

COMMENT ON COLUMN public.student_setups.tiktok_url IS 'Full https TikTok video URL for an optional dorm tour embed; null when omitted.';
