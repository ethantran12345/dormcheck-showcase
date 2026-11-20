-- Security queue item 1 (group 1): dorm Q&A tables authenticated-only SELECT.
-- Mirror pass 2c dorm_future_residents pattern. No pre-login client reader.

-- ---------------------------------------------------------------------------
-- dorm_questions
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "dorm_questions_select_anon" ON public.dorm_questions;

DROP POLICY IF EXISTS "dorm_questions_select_authenticated" ON public.dorm_questions;
CREATE POLICY "dorm_questions_select_authenticated"
ON public.dorm_questions
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.dorm_questions FROM anon;

-- ---------------------------------------------------------------------------
-- dorm_answers
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "dorm_answers_select_anon" ON public.dorm_answers;

DROP POLICY IF EXISTS "dorm_answers_select_authenticated" ON public.dorm_answers;
CREATE POLICY "dorm_answers_select_authenticated"
ON public.dorm_answers
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.dorm_answers FROM anon;

-- ---------------------------------------------------------------------------
-- dorm_question_upvotes (baseline policy covered anon + authenticated)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "dorm_question_upvotes_select_all" ON public.dorm_question_upvotes;

CREATE POLICY "dorm_question_upvotes_select_authenticated"
ON public.dorm_question_upvotes
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.dorm_question_upvotes FROM anon;
