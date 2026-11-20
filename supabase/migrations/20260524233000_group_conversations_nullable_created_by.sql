-- Fix nullability contradiction surfaced during account deletion testing.
-- group_conversations.created_by has FK ON DELETE SET NULL but column is
-- NOT NULL, causing auth.admin.deleteUser to fail when the user had created
-- any group_conversations. Aligning column nullability with FK rule.
ALTER TABLE public.group_conversations
  ALTER COLUMN created_by DROP NOT NULL;
