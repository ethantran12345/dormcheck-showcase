-- Smoking / vaping preference for roommate compatibility snapshot
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS smoking text;
