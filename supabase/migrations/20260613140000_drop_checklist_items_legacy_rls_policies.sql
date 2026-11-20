-- Drop legacy baseline checklist_items policies that OR-defeat rls_checklist_items_*.
-- Pass 2c added stricter rls_* policies but left the weaker baseline policies in place.
-- PostgreSQL ORs permissive policies, so pending members and non-members could bypass gates.

DROP POLICY IF EXISTS "Users can manage their own checklist" ON public.checklist_items;
DROP POLICY IF EXISTS "Users can view shared checklist items" ON public.checklist_items;
DROP POLICY IF EXISTS "Users can update shared checklist items" ON public.checklist_items;
