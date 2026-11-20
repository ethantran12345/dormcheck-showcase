-- Per-user room override for catalog sections whose room is hidden ((Private) /
-- online_tba in 25Live). Keeps "what the catalog said" (room/building_id) separate
-- from "what the student fixed"; effective location = override ?? base.
alter table public.user_classes
  add column override_room text,
  add column override_building_id uuid references public.buildings(id);
