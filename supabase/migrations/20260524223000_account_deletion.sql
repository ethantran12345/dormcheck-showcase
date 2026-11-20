-- Account deletion (App Store 5.1.1).
-- Drops the broken delete_user_data() RPC, creates an audit table for compliance
-- records, and switches the FK rule to SET NULL for the three tables we anonymize
-- (student_reviews, dorm_questions, dorm_answers) so a profile delete leaves the
-- row in place with user_id = NULL.

-- 1. Drop the broken RPC. It references public.roommate_profiles which doesn't
-- exist; every call has been failing. UI is migrating to an Edge Function.
DROP FUNCTION IF EXISTS public.delete_user_data();

-- 2. Audit table for deleted accounts. Service role only (no client policies).
CREATE TABLE IF NOT EXISTS public.deleted_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL,
  email        text,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS deleted_accounts_auth_user_id_idx
  ON public.deleted_accounts (auth_user_id);
CREATE INDEX IF NOT EXISTS deleted_accounts_deleted_at_idx
  ON public.deleted_accounts (deleted_at DESC);

ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;
-- No policies created. With RLS enabled and zero policies, anon/authenticated
-- have no access. Service role bypasses RLS as usual.

COMMENT ON TABLE public.deleted_accounts IS
  'Compliance audit log for App Store 5.1.1 account deletions. Service-role-only.';

-- 3. Anonymize-on-delete: student_reviews
ALTER TABLE public.student_reviews
  DROP CONSTRAINT IF EXISTS student_reviews_user_id_fkey;

ALTER TABLE public.student_reviews
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.student_reviews
  ADD CONSTRAINT student_reviews_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE SET NULL;

-- 4. Anonymize-on-delete: dorm_questions
ALTER TABLE public.dorm_questions
  DROP CONSTRAINT IF EXISTS dorm_questions_user_id_fkey;

ALTER TABLE public.dorm_questions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.dorm_questions
  ADD CONSTRAINT dorm_questions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE SET NULL;

-- 5. Anonymize-on-delete: dorm_answers
ALTER TABLE public.dorm_answers
  DROP CONSTRAINT IF EXISTS dorm_answers_user_id_fkey;

ALTER TABLE public.dorm_answers
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.dorm_answers
  ADD CONSTRAINT dorm_answers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE SET NULL;
