-- university_resources: admin-editable resource hub links, per university.
-- Class A tenant root (registry: supabase/registry/table-classification.json).
-- Seeded from src/data/pittResources.ts (Pitt only; CMU starts empty); the
-- static file remains the student-page fallback if this table is unreachable.
-- absorbedBy stays code-side (pittGuides.ts interplay), keyed by slug.

create table public.university_resources (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id),
  slug text not null,
  category text not null check (category in ('apply','dining','living','contact')),
  title text not null,
  description text not null default '',
  url text not null,
  audience text not null default 'all' check (audience in ('first-year','upperclass','apartment','all')),
  icon_key text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, slug)
);

alter table public.university_resources enable row level security;

-- Class A RESTRICTIVE tenant fence (authenticated): own university or superadmin.
select public.apply_tenant_isolation('public.university_resources');

-- Students (and anon) read active rows; the client filters by university_id and
-- rows are public link directories (no PII). Admins also see inactive rows.
create policy university_resources_public_read on public.university_resources
  for select to anon, authenticated
  using (is_active);

create policy university_resources_admin_read on public.university_resources
  for select to authenticated
  using (public.current_app_role() in ('university_admin','superadmin'));

-- Writes: admins only; the RESTRICTIVE tenant policy pins university_admin to
-- their own school (superadmin bypasses via is_superadmin()).
create policy university_resources_admin_insert on public.university_resources
  for insert to authenticated
  with check (public.current_app_role() in ('university_admin','superadmin'));

create policy university_resources_admin_update on public.university_resources
  for update to authenticated
  using (public.current_app_role() in ('university_admin','superadmin'))
  with check (public.current_app_role() in ('university_admin','superadmin'));

create policy university_resources_admin_delete on public.university_resources
  for delete to authenticated
  using (public.current_app_role() in ('university_admin','superadmin'));

create or replace function public.university_resources_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

create trigger tr_university_resources_updated_at
  before update on public.university_resources
  for each row execute function public.university_resources_set_updated_at();

-- Seed: current pittResources.ts content, byte-identical fields, Pitt only.
insert into public.university_resources
  (slug, category, title, description, url, audience, sort_order, university_id)
select v.slug, v.category, v.title, v.description, v.url, v.audience, v.sort_order,
       (select id from public.universities where slug = 'pitt')
from (values
  ('apply-housing-portal', 'apply', 'Housing Portal (StarRez) Login', 'Log in with Pitt SSO to apply, select a room, and manage housing', 'https://pitt.starrezhousing.com/StarRezPortalX', 'all', 0),
  ('apply-contract', 'apply', 'Housing & Dining Contract', 'Complete the required 2026-27 housing contract', 'https://www.pc.pitt.edu/sites/default/files/assets/housing/26-27%20Housing%20Contract.pdf', 'all', 1),
  ('apply-communities', 'apply', 'Living Learning Communities', 'Themed housing communities you can apply to', 'https://www.pc.pitt.edu/housing-services/selection-central/communities-within-housing', 'all', 2),
  ('apply-first-year-process', 'apply', 'First-Year Application Process', 'Log in with Pitt SSO and complete the first-year application in the Housing Portal', 'https://pitt.starrezhousing.com/StarRezPortalX', 'first-year', 3),
  ('apply-first-year-overview', 'apply', 'Incoming First-Year Housing', 'Housing overview for incoming first-year students', 'https://www.pc.pitt.edu/housing-services/incoming-first-year-students', 'first-year', 4),
  ('apply-guaranteed-upperclass', 'apply', 'Guaranteed Upperclass Housing', 'Selection process for students with a housing guarantee', 'https://www.pc.pitt.edu/housing-services/guaranteed-upper-class-students', 'upperclass', 5),
  ('apply-non-guaranteed', 'apply', 'Non-Guaranteed / Transfer Application', 'Apply or select a room directly in the Housing Portal', 'https://pitt.starrezhousing.com/StarRezPortalX/054B4176/1/1/Home-Home?UrlToken=D830AACD', 'upperclass', 6),
  ('apply-leased-apartments', 'apply', 'University-Owned & Leased Apartments', 'How apartment-style selection works', 'https://www.pc.pitt.edu/housing-services/selection-process/university-owned-leased-apartments', 'apartment', 7),
  ('apply-rate-schedule', 'apply', 'Room Rate Schedule (PDF)', 'Official 2025-26 housing rates for every hall', 'https://www.pc.pitt.edu/sites/default/files/Housing-Services-Rate-Schedule-2025-2026_0.pdf', 'all', 8),
  ('dining-meal-plans', 'dining', 'Explore Meal Memberships', 'Compare Pitt Eats meal plan options', 'https://dineoncampus.com/pitt/all-about-meal-memberships', 'all', 0),
  ('dining-hours', 'dining', 'Dining Locations & Hours', 'Where to eat on campus and when it is open', 'https://dineoncampus.com/pitt/hours-of-operation', 'all', 1),
  ('dining-pitt-cash', 'dining', 'Add Pitt Ca$h & Panther Funds', 'Load funds onto your Panther Card', 'https://pittcash.pitt.edu/', 'all', 2),
  ('dining-off-campus', 'dining', 'Off-Campus Panther Funds Spots', 'Restaurants and shops that accept Panther Funds', 'https://acceptinglocations.com/pantherfunds/', 'all', 3),
  ('dining-rates', 'dining', 'Meal Plan Prices', 'Official meal membership rates for every plan', 'https://www.pc.pitt.edu/sites/default/files/2025-2026%20Meal%20Membership%20Rates_0.pdf', 'all', 4),
  ('dining-apply', 'dining', 'Apply for or Change a Meal Plan', 'How to add or change your meal membership', 'https://www.pc.pitt.edu/how-apply-meal-membership', 'all', 5),
  ('dining-additional-dollars', 'dining', 'Add Dining Dollars', 'Add extra dining dollars to your plan', 'https://www.pc.pitt.edu/additional-dining-dollars', 'all', 6),
  ('living-move-in', 'living', 'Move-In & Arrival', 'Official arrival dates, maps, and day-of logistics', 'https://www.arrival.pitt.edu', 'all', 0),
  ('living-maintenance', 'living', 'Maintenance Requests', 'Report a facilities issue in your hall', 'https://www.pc.pitt.edu/housing-services/maintenance-requests', 'all', 1),
  ('living-amenities', 'living', 'Residence Life Amenities', 'What comes with living on campus', 'https://www.pc.pitt.edu/housing-services/amenities/residence-life-amenities', 'all', 2),
  ('living-forms', 'living', 'Forms & Documents', 'Housing forms, requests, and official documents', 'https://www.pc.pitt.edu/forms-and-documents', 'all', 3),
  ('living-contract-termination', 'living', 'Contract Termination', 'How housing & dining contract release works', 'https://www.pc.pitt.edu/housing-and-dining-contract-termination', 'all', 4),
  ('living-roommate', 'living', 'Find a Roommate', 'Search for and request roommates inside the Housing Portal', 'https://pitt.starrezhousing.com/StarRezPortalX', 'all', 5),
  ('living-packing', 'living', 'Packing Checklist', 'What to bring (and what to leave home)', 'https://www.arrival.pitt.edu/you-arrive/packing-list', 'all', 6),
  ('living-ship2pitt', 'living', 'Ship2Pitt', 'Mail belongings to campus before arrival', 'https://www.logistics.pitt.edu/ship2pitt', 'all', 7),
  ('living-pitt-id', 'living', 'Pitt ID / Panther Card', 'Your ID for door access, meals, and Panther Funds', 'https://www.pc.pitt.edu/pitt-id', 'all', 8),
  ('living-mobile-id', 'living', 'Mobile Panther ID', 'Add your Pitt ID to your phone', 'https://www.pc.pitt.edu/pitt-id/mobile-panther-id', 'all', 9),
  ('living-lost-card', 'living', 'Lost or Replace Card', 'Report a lost Panther Card', 'https://www.pc.pitt.edu/lost-card', 'all', 10),
  ('living-accessible-housing', 'living', 'Accessible Housing (DRS)', 'Request housing accommodations through Disability Resources & Services', 'https://www.wellbeing.pitt.edu/disability-access/disability-resources-services', 'all', 11),
  ('contact-panther-central', 'contact', 'Panther Central', '24/7 help with housing, dining, and your Panther Card. Litchfield Towers lobby, 3990 Fifth Ave.', 'https://www.pc.pitt.edu', 'all', 0)
) as v(slug, category, title, description, url, audience, sort_order);
