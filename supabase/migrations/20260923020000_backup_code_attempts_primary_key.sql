-- private.backup_code_attempts gets a surrogate primary key.
-- Closes Supabase advisor issue #184 (no_primary_key, INFO level).
--
-- Verified against LIVE PROD (abcdefghijklmnopqrst) on 2026-08-16:
--   columns: user_id uuid, attempted_at timestamptz — and NOTHING else.
--   pg_constraint for the relation: EMPTY. No PK, no unique, no check, no FK.
--   row count: 0.
--
-- WHY A SURROGATE AND NOT A NATURAL KEY. The obvious natural key is
-- (user_id, attempted_at), and it is wrong here. This is an append-only rate-limit
-- log: `mint_backup_codes()` (20260901000003) counts rows in the last interval,
-- inserts one, and sweeps rows older than a day. attempted_at defaults to the
-- statement timestamp, so two attempts inside one transaction — or two that land
-- on the same microsecond — would collide on that key and RAISE, turning a rate
-- limiter into an error path. A rate limiter that throws instead of counting fails
-- in the wrong direction. A generated identity cannot collide by construction.
--
-- WHY THIS IS CHEAP AND SAFE. The table is empty in prod, so ADD COLUMN … IDENTITY
-- has no backfill and no rewrite of real data. Nothing reads the table by row
-- identity — the only two consumers are a COUNT over a time window and a DELETE by
-- attempted_at, both of which are indifferent to the new column. The existing
-- backup_code_attempts_user_time index on (user_id, attempted_at) still serves both
-- and is left untouched.
--
-- IDEMPOTENCY. ADD COLUMN takes IF NOT EXISTS; the PK is added only when the
-- relation has no primary key yet, so a re-run against an already-migrated database
-- is a no-op rather than a duplicate-object error.
--
-- Rollback:
--   ALTER TABLE private.backup_code_attempts DROP COLUMN id;
--   (dropping the column drops the primary key constraint with it)

ALTER TABLE private.backup_code_attempts
  ADD COLUMN IF NOT EXISTS id bigint GENERATED ALWAYS AS IDENTITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'private.backup_code_attempts'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE private.backup_code_attempts
      ADD CONSTRAINT backup_code_attempts_pkey PRIMARY KEY (id);
  END IF;
END $$;

COMMENT ON COLUMN private.backup_code_attempts.id IS
  'Surrogate primary key (advisor #184, 2026-08-16). Deliberately NOT a natural '
  '(user_id, attempted_at) key: this is an append-only rate-limit log and two '
  'attempts sharing a timestamp must both be recorded, not collide.';
