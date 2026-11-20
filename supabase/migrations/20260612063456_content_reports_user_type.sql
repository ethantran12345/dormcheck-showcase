-- Allow reporting users via content_reports (content_type = 'user').
-- RPC get_content_reports is unchanged; admin UI resolves user preview client-side.

ALTER TABLE public.content_reports DROP CONSTRAINT chk_content_type;

ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type
  CHECK (
    content_type = ANY (
      ARRAY[
        'student_review'::text,
        'marketplace_listing'::text,
        'roommate_post'::text,
        'building_chat_link'::text,
        'user'::text
      ]
    )
  );
