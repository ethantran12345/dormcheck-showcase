-- Immediate moderation alert on a new content report (App Store guideline 1.2).
--
-- /terms and /moderation now publish a 24-hour commitment: a reported item is
-- removed and the user ejected within 24 hours of the report. The only reactive
-- signal before this migration was `api/cron/report-nudge.ts`, which fires at
-- 48h and is capped at one admin email per day -- structurally incapable of
-- keeping a 24h promise. This trigger is what starts the clock with a human.
--
-- Shape is a deliberate copy of `private.dispatch_push`
-- (20260711232304_trigger_push.sql): a REVOKEd `private.*_config` singleton
-- holding the endpoint + shared secret, an async `net.http_post`, and a
-- swallow-everything EXCEPTION block. The swallow is the important part -- an
-- alert that fails must never roll back the report insert, because a lost
-- report is a far worse 1.2 outcome than a missed email.
--
-- The POST body carries the report id ONLY. `api/report-alert.ts` re-reads every
-- field with the service-role client, so the endpoint cannot be used to inject
-- arbitrary content into branded mail even if the token leaks.
--
-- Seeding (run once per environment, values NOT in git):
--   INSERT INTO private.report_alert_config (endpoint_url, alert_token)
--   VALUES ('https://dormcheck.com/api/report-alert', '<REPORT_ALERT_TOKEN>');
-- The same token must be set as REPORT_ALERT_TOKEN in the Vercel project env.
-- Unseeded, the trigger warns and no-ops; it never blocks a report.
--
-- Rollback:
--   drop trigger content_report_alert on public.content_reports;
--   drop function private.dispatch_report_alert();
--   drop table private.report_alert_config;

create table if not exists private.report_alert_config (
  id           boolean primary key default true check (id),
  endpoint_url text not null,
  alert_token  text not null
);
revoke all on table private.report_alert_config from public, anon, authenticated;

create or replace function private.dispatch_report_alert()
returns trigger
language plpgsql security definer
set search_path to 'private', 'public', 'net'
as $$
declare
  v_cfg private.report_alert_config%rowtype;
begin
  select * into v_cfg from private.report_alert_config where id;
  if not found then
    raise warning 'dispatch_report_alert: private.report_alert_config not seeded; skipping';
    return new;
  end if;

  perform net.http_post(
    url := v_cfg.endpoint_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.alert_token
    ),
    body := jsonb_build_object('reportId', new.id)
  );
  return new;
exception when others then
  -- Never fail the insert: losing the report is worse than losing the alert.
  raise warning 'dispatch_report_alert failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke execute on function private.dispatch_report_alert()
  from public, anon, authenticated;

drop trigger if exists content_report_alert on public.content_reports;
create trigger content_report_alert
  after insert on public.content_reports
  for each row execute function private.dispatch_report_alert();
