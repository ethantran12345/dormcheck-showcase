-- Drop university_resources: the Pitt Resources feature was removed entirely.
-- Every frontend consumer is gone (ResourcesPage, the native guide pages, the
-- admin CRUD at /admin/resources, useUniversityResources, the My Home widget,
-- and the PlatformPage seed count). This is the destructive CONTRACT step:
-- apply it only after the resources-removal code has shipped and been verified,
-- and only against a confirmed PITR/backup point (Ethan-owned dashboard action).
--
-- Rollback: the full CREATE + policies + seed live in
-- 20260711041131_university_resources.sql — re-run that file to restore.

-- Dropping the table cascades its 5 RLS policies and the updated_at trigger.
drop table if exists public.university_resources cascade;

-- The trigger function is a standalone object, so drop it explicitly.
drop function if exists public.university_resources_set_updated_at();
