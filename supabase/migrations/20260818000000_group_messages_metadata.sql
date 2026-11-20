-- Rich message attachments for group/community chats.
--
-- Adds an optional structured payload alongside the plain-text `content`, so a
-- resident can share a checklist item ("I'm bringing this") or their Instagram
-- handle and have it render as a card/chip. `content` always carries a
-- human-readable fallback, so old clients (and last_message previews) still work.
--
-- Additive + nullable = backward compatible; this is the expand step, no contract.
alter table public.group_messages
  add column if not exists metadata jsonb;

comment on column public.group_messages.metadata is
  'Optional structured attachment: discriminated union keyed by metadata->>''type'' (checklist_item | instagram). NULL for plain text. `content` always carries a human-readable fallback.';

-- group_messages uses COLUMN-LEVEL grants (the SEC-6 pattern), so a new column is
-- NOT covered by the existing per-column grants: a bare select('*') on the base
-- table would fail with 42501 until the new column is granted. Least-privilege:
-- authenticated only (community/messages are auth-gated), SELECT + INSERT only
-- (messages are immutable - never updated), no anon.
grant select (metadata), insert (metadata)
  on public.group_messages to authenticated;

-- Rollback:
--   revoke select (metadata), insert (metadata) on public.group_messages from authenticated;
--   alter table public.group_messages drop column if exists metadata;
