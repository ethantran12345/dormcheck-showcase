-- Campus live data: ingest targets for public university feeds.
--
-- Four sources land here — laundry machine status, dining hours + menus, the
-- academic calendar, and the course catalog. Every one is fetched server-side on
-- a schedule and read by the app from Postgres; the client never touches an
-- upstream host (they are unofficial endpoints with no SLA, and the app CSP
-- would block them anyway).
--
-- Named `campus_*`, not `pitt_*`, and every table is class A university-scoped.
-- Pitt is the first tenant, not a special case: adding a second school is a row
-- in campus_data_sources plus an adapter, never a schema change.
--
-- Sections are NOT duplicated here. The catalog ingest upserts into the existing
-- public.course_sections (unique (term, class_number)), which the schedule
-- surface already reads.
--
-- RLS: class A tenant_isolation on every table; SELECT to authenticated so the
-- app can read its own school's data, writes reserved to the service role used
-- by the cron handlers. Rollback: docs/audits/pitt-live-data-rollback.md.

-- ---------------------------------------------------------------------------
-- Per-university source configuration. The ingest reads this instead of holding
-- Pitt identifiers in code, so a second school is data.
-- ---------------------------------------------------------------------------
create table public.campus_data_sources (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  source text not null check (source in ('laundry', 'dining', 'calendar', 'catalog')),
  is_enabled boolean not null default true,
  -- Source-specific identifiers: dineoncampus site_id, laundryview account,
  -- catalog institution code, calendar feed URLs.
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, source)
);

-- ---------------------------------------------------------------------------
-- Ingest heartbeat. A scheduled job that fails silently is indistinguishable
-- from one that had nothing to do, so every run records its own outcome and the
-- UI reads last-success age from here rather than assuming freshness.
-- ---------------------------------------------------------------------------
create table public.campus_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  source text not null check (source in ('laundry', 'dining', 'calendar', 'catalog')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  rows_written integer not null default 0,
  error text,
  detail jsonb not null default '{}'::jsonb
);

create index campus_ingest_runs_lookup_idx
  on public.campus_ingest_runs (university_id, source, started_at desc);

-- ---------------------------------------------------------------------------
-- Laundry
-- ---------------------------------------------------------------------------
create table public.campus_laundry_rooms (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  external_id text not null,               -- upstream room id
  upstream_name text not null,             -- e.g. 'HOLLAND HALL 11TH FL.'
  -- Normalized to match master_housing.residence_hall ('Holland Hall'). Null when
  -- the upstream name maps to no hall we model; the UI then shows it unattached
  -- rather than silently dropping the room.
  residence_hall text,
  campus text,
  total_washers integer not null default 0,
  total_dryers integer not null default 0,
  free_washers integer not null default 0,
  free_dryers integer not null default 0,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (university_id, external_id)
);

create index campus_laundry_rooms_hall_idx
  on public.campus_laundry_rooms (university_id, residence_hall);

create table public.campus_laundry_machines (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  room_id uuid not null references public.campus_laundry_rooms(id) on delete cascade,
  external_id text not null,
  label text,
  machine_type text not null default 'washer'
    check (machine_type in ('washer', 'dryer', 'combo')),
  status text not null default 'unknown'
    check (status in ('available', 'in_use', 'idle', 'out_of_service', 'offline', 'unknown')),
  status_message text,
  minutes_remaining integer,
  cycle_progress_percent integer,
  is_stacked boolean not null default false,
  observed_at timestamptz not null default now(),
  unique (room_id, external_id)
);

create index campus_laundry_machines_room_idx
  on public.campus_laundry_machines (room_id, machine_type, status);

-- Every other campus_* table indexes university_id as the leading column via its
-- natural unique key; this one is keyed on (room_id, external_id), so the tenant
-- FK needs its own index or the efficiency gate fails and cascading deletes on
-- universities do a sequential scan.
create index campus_laundry_machines_university_idx
  on public.campus_laundry_machines (university_id);

-- ---------------------------------------------------------------------------
-- Dining
-- ---------------------------------------------------------------------------
create table public.campus_dining_locations (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  external_id text not null,
  name text not null,
  is_open boolean,
  status_label text,
  address text,
  -- False when the upstream publishes no menu for this location (retail brands,
  -- or an id the provider 502s on). Lets the UI say "hours only" instead of
  -- rendering an empty menu that looks like a bug.
  has_menu boolean not null default false,
  observed_at timestamptz not null default now(),
  unique (university_id, external_id)
);

create table public.campus_dining_hours (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  location_name text not null,
  service_date date not null,
  -- [{"start":"10:30","end":"21:00"}, …]; empty array means closed that day.
  intervals jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now(),
  unique (university_id, location_name, service_date)
);

create index campus_dining_hours_date_idx
  on public.campus_dining_hours (university_id, service_date);

create table public.campus_dining_menus (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  location_id uuid not null references public.campus_dining_locations(id) on delete cascade,
  service_date date not null,
  period_name text not null,
  -- [{"name":"Farmstand","items":[{"name":…,"calories":…,"filters":[…]}]}]
  categories jsonb not null default '[]'::jsonb,
  item_count integer not null default 0,
  observed_at timestamptz not null default now(),
  unique (location_id, service_date, period_name)
);

create index campus_dining_menus_date_idx
  on public.campus_dining_menus (university_id, service_date);

-- ---------------------------------------------------------------------------
-- Academic calendar
-- ---------------------------------------------------------------------------
create table public.campus_academic_events (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  calendar text not null
    check (calendar in ('academic', 'enrollment', 'grades', 'graduation', 'course')),
  event_date date not null,
  title text not null,
  content text,
  categories text[] not null default '{}',
  observed_at timestamptz not null default now(),
  -- The feeds carry no stable id, so identity is the tuple itself. Re-running the
  -- ingest updates in place instead of duplicating every event each week.
  unique (university_id, calendar, event_date, title)
);

create index campus_academic_events_date_idx
  on public.campus_academic_events (university_id, event_date);

-- ---------------------------------------------------------------------------
-- Course catalog. Courses live here; their sections upsert into course_sections.
-- ---------------------------------------------------------------------------
create table public.campus_course_catalog (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  external_course_id text not null,
  subject text not null,
  course_number text not null,
  title text not null,
  observed_at timestamptz not null default now(),
  unique (university_id, external_course_id, subject, course_number)
);

create index campus_course_catalog_subject_idx
  on public.campus_course_catalog (university_id, subject, course_number);

-- Resumable cursor, shared by every ingest that cannot finish inside one
-- function invocation. A full term catalog is ~5k upstream requests and the
-- dining menu sweep is ~35 locations with retries; both exceed a serverless
-- timeout, so each run advances a bounded batch and records where it stopped.
-- `scope` is the unit a cycle covers: the term code for catalog, the service
-- date for dining.
create table public.campus_ingest_cursor (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  source text not null check (source in ('laundry', 'dining', 'calendar', 'catalog')),
  scope text not null default '',
  stage text not null default 'start',
  last_key text,
  cycle_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, source, scope)
);

-- ---------------------------------------------------------------------------
-- RLS. Reads are per-tenant; every write path is the service role, which bypasses
-- RLS, so no INSERT/UPDATE grant is issued to an app role anywhere below.
-- ---------------------------------------------------------------------------
do $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campus_data_sources', 'campus_ingest_runs',
    'campus_laundry_rooms', 'campus_laundry_machines',
    'campus_dining_locations', 'campus_dining_hours', 'campus_dining_menus',
    'campus_academic_events', 'campus_course_catalog', 'campus_ingest_cursor'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    -- Supabase's default privileges grant authenticated the full arwdDxtm set on
    -- every new table in public, so a bare `REVOKE ... FROM anon, public` leaves
    -- INSERT/UPDATE/DELETE granted. RLS still denies those (there is no permissive
    -- write policy below), but relying on that alone means one future permissive
    -- policy silently opens a write path. Revoke from authenticated explicitly and
    -- grant back only SELECT.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, public;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
      'rls_' || t || '_select', t
    );
    PERFORM public.apply_tenant_isolation(('public.' || quote_ident(t))::regclass);
  END LOOP;
END $$;

-- Seed Pitt's source configuration. Identifiers are public and already visible in
-- any browser request to the same feeds.
insert into public.campus_data_sources (university_id, source, config)
select u.id, s.source, s.config
from public.universities u
cross join (values
  ('laundry'::text, '{"provider":"laundryview","school_id":"197"}'::jsonb),
  ('dining',        '{"provider":"dineoncampus","site_id":"5e6fcc641ca48e0cacd93b04"}'::jsonb),
  ('calendar',      '{"provider":"25livepub","prefix":"pitt"}'::jsonb),
  ('catalog',       '{"provider":"highpoint_cx","institution":"UPITT"}'::jsonb)
) as s(source, config)
where u.slug = 'pitt'
on conflict (university_id, source) do nothing;
