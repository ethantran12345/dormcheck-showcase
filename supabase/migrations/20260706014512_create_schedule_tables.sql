-- Class-schedule campus navigator: reference buildings + term catalog + per-user schedule.
-- buildings/course_sections are seeded by service-role scripts (scripts/seed-buildings.mjs,
-- scripts/seed-course-sections.mjs); clients only read them.

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  abbr text not null unique,
  name text not null,
  building_number text,
  address text,
  city text,
  zip text,
  lat double precision,
  lng double precision,
  campus text not null default 'Pittsburgh',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_sections (
  id uuid primary key default gen_random_uuid(),
  term text not null,                         -- e.g. '2271' (Fall 2026)
  subject text not null,                      -- 'CHEM'
  catalog_number text not null,               -- '0110'
  section text not null,                      -- '1300'
  class_number text not null,                 -- Pitt class nbr, join key to CX/25Live
  component text,                             -- LEC | REC | LAB | ...
  title text,                                 -- official full title (Acalog) or 25Live fallback
  title_display text,                         -- title-cased for UI
  days text[] not null default '{}',          -- {'Mo','We','Fr'}
  start_time time,
  end_time time,                              -- inferred from Pitt standard blocks
  room text,                                  -- full room code, e.g. 'CL0306'
  building_abbr text references public.buildings(abbr),
  location_status text not null default 'located'
    check (location_status in ('located','private','online_tba')),
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  unique (term, class_number)
);

create index course_sections_term_subject_idx
  on public.course_sections (term, subject, catalog_number);
create index course_sections_title_idx
  on public.course_sections using gin (to_tsvector('simple', coalesce(title, '')));

-- Per-user: where the student lives (dorm pick or custom sublet address)
create table public.user_home_location (
  user_id uuid primary key references auth.users(id) on delete cascade,
  building_id uuid references public.buildings(id),
  label text,
  lat double precision,
  lng double precision,
  updated_at timestamptz not null default now()
);

-- Per-user: added classes. Denormalized fields are always populated so manual
-- entries need no catalog row and catalog edits don't mutate user schedules.
create table public.user_classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid references public.course_sections(id) on delete set null,
  label text not null,                        -- 'CHEM 0110 LEC' or custom
  days text[] not null default '{}',
  start_time time,
  end_time time,
  building_id uuid references public.buildings(id),
  room text,
  term text,
  color text,
  created_at timestamptz not null default now()
);

create index user_classes_user_id_idx on public.user_classes (user_id);

alter table public.buildings enable row level security;
alter table public.course_sections enable row level security;
alter table public.user_home_location enable row level security;
alter table public.user_classes enable row level security;

create policy rls_buildings_select
  on public.buildings for select to authenticated
  using (true);

create policy rls_course_sections_select
  on public.course_sections for select to authenticated
  using (true);

create policy rls_user_home_location_select
  on public.user_home_location for select to authenticated
  using (user_id = auth.uid());
create policy rls_user_home_location_insert
  on public.user_home_location for insert to authenticated
  with check (user_id = auth.uid());
create policy rls_user_home_location_update
  on public.user_home_location for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy rls_user_home_location_delete
  on public.user_home_location for delete to authenticated
  using (user_id = auth.uid());

create policy rls_user_classes_select
  on public.user_classes for select to authenticated
  using (user_id = auth.uid());
create policy rls_user_classes_insert
  on public.user_classes for insert to authenticated
  with check (user_id = auth.uid());
create policy rls_user_classes_update
  on public.user_classes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy rls_user_classes_delete
  on public.user_classes for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.buildings from anon, public;
revoke all on public.course_sections from anon, public;
revoke all on public.user_home_location from anon, public;
revoke all on public.user_classes from anon, public;

grant select on public.buildings to authenticated;
grant select on public.course_sections to authenticated;
grant select, insert, update, delete on public.user_home_location to authenticated;
grant select, insert, update, delete on public.user_classes to authenticated;
