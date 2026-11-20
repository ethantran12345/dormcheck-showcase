-- Security queue (2026-08-02), items 1-2 of the remediation close-out.
--
-- 1. mfa_backup_codes: the client minted its own codes via an own-row INSERT
--    policy. `authenticated` is a role, not a trust level — own-row write
--    access to a security-control table is itself the exploit: an AAL1
--    session (stolen cookie) could mint a fresh code set and redeem one.
--    Fix: minting moves server-side behind mint_backup_codes(), which
--    REQUIRES AAL2 (the enrollment flow verifies TOTP immediately before
--    minting, so the session is already aal2 there). Redemption stays AAL1
--    by definition (a backup code exists for sessions that cannot produce a
--    TOTP) but becomes rate-limited, and it STOPS deleting the user's TOTP
--    factors — the old behavior turned one leaked code into a permanent MFA
--    downgrade. Redemption now just burns the code and flags the profile for
--    re-enrollment.
-- 2. private.roommate_search_posts_contact had NO WHERE clause while its twin
--    private.marketplace_listings_contact carried the tenant predicate.
--    Views in `private` execute as owner and BYPASS RLS — every one needs its
--    predicate hand-written. 0 prod rows at time of fix (latent, not
--    breached).

-- ── 1a. Close the client-side mint path ──────────────────────────────────────
REVOKE ALL ON public.mfa_backup_codes FROM PUBLIC;
REVOKE ALL ON public.mfa_backup_codes FROM anon;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.mfa_backup_codes FROM authenticated;
-- SELECT (own-row via RLS) stays for the settings surface; DELETE (own-row)
-- stays for the disable-2FA flow, which is a self-service teardown, not a gate.
DROP POLICY IF EXISTS mfa_backup_codes_insert_own ON public.mfa_backup_codes;

-- ── 1b. Re-enrollment flag ───────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_reenroll_required boolean NOT NULL DEFAULT false;

-- ── 1c. Server-side mint, AAL2 required ─────────────────────────────────────
-- AAL2 is demanded at MINT/regeneration, not redemption: regenerating the
-- code set is the operation an attacker needs, so it is the one that must
-- prove a live factor.
CREATE OR REPLACE FUNCTION public.mint_backup_codes()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  -- 0/O/1/l-free alphabet, matches the historical client generator.
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_codes text[] := '{}';
  v_bytes bytea;
  v_raw text;
  i int;
  j int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'aal2 required to mint backup codes';
  END IF;
  DELETE FROM public.mfa_backup_codes WHERE user_id = auth.uid();
  FOR i IN 1..10 LOOP
    v_bytes := gen_random_bytes(8);
    v_raw := '';
    FOR j IN 0..7 LOOP
      v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, j) % 31) + 1, 1);
    END LOOP;
    INSERT INTO public.mfa_backup_codes (user_id, code_hash)
    VALUES (auth.uid(), encode(digest(v_raw, 'sha256'), 'hex'));
    v_codes := v_codes || (substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4));
  END LOOP;
  UPDATE public.profiles SET mfa_reenroll_required = false WHERE id = auth.uid();
  RETURN v_codes;  -- plaintext leaves the server exactly once
END;
$$;
REVOKE ALL ON FUNCTION public.mint_backup_codes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_backup_codes() FROM anon;
GRANT EXECUTE ON FUNCTION public.mint_backup_codes() TO authenticated;

-- ── 1d. Redemption: AAL1, single-use, rate-limited, TOTP survives ───────────
-- No grants on the attempts table: only the SECURITY DEFINER function touches it.
CREATE TABLE IF NOT EXISTS private.backup_code_attempts (
  user_id uuid NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS backup_code_attempts_user_time
  ON private.backup_code_attempts (user_id, attempted_at);

CREATE OR REPLACE FUNCTION public.use_backup_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_hash text;
  v_id uuid;
  v_recent int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  -- Rate limit: 5 attempts (hit or miss) per 15 minutes per user.
  SELECT count(*) INTO v_recent
    FROM private.backup_code_attempts
   WHERE user_id = auth.uid()
     AND attempted_at > now() - interval '15 minutes';
  IF v_recent >= 5 THEN
    RETURN false;
  END IF;
  INSERT INTO private.backup_code_attempts (user_id) VALUES (auth.uid());
  DELETE FROM private.backup_code_attempts WHERE attempted_at < now() - interval '1 day';

  v_hash := encode(digest(lower(replace(trim(p_code), '-', '')), 'sha256'), 'hex');
  UPDATE public.mfa_backup_codes
     SET used_at = now()
   WHERE user_id = auth.uid() AND code_hash = v_hash AND used_at IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  -- Single-use consumed above (used_at). TOTP factors and the remaining
  -- codes are deliberately untouched; the account is flagged instead.
  UPDATE public.profiles SET mfa_reenroll_required = true WHERE id = auth.uid();
  RETURN true;
END;
$$;

-- ── 2. roommate contact view: predicate copied from the marketplace twin,
--       plus the base table's own visibility rule (is_active OR owner). ──────
CREATE OR REPLACE VIEW private.roommate_search_posts_contact AS
SELECT id,
       CASE WHEN (show_phone OR user_id = auth.uid()) THEN phone_number ELSE NULL::text END AS phone_number,
       CASE WHEN (show_instagram OR user_id = auth.uid()) THEN instagram ELSE NULL::text END AS instagram,
       CASE WHEN (show_snapchat OR user_id = auth.uid()) THEN snapchat ELSE NULL::text END AS snapchat
  FROM public.roommate_search_posts
 WHERE (university_id = current_university_id() OR user_id = auth.uid() OR is_superadmin())
   AND (is_active = true OR user_id = auth.uid() OR is_superadmin());
