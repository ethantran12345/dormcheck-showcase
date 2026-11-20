-- Advisor #34 (auth_rls_initplan): the sole policy on public.marketplace_alerts
-- calls auth.uid() unwrapped, so it re-evaluates per row. Wrap it in a scalar
-- subquery so Postgres hoists it to a one-time InitPlan. Behavior is identical
-- (owner-only ALL); only the per-query evaluation changes.
drop policy if exists "Users manage their own marketplace alerts" on public.marketplace_alerts;

create policy "Users manage their own marketplace alerts" on public.marketplace_alerts
  for all to authenticated
  using  ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
