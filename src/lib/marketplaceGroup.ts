import { supabase } from '@/integrations/supabase/client';

/**
 * Who shares a marketplace with whom.
 *
 * `universities.marketplace_group` (migration 20260911000000) is the mechanism the
 * whole marketplace uses for cross-school reach: `marketplace_listings` has read at
 * group range since 20260918000000, and `public.buildings` joined it in
 * 20261002000000. This helper is the client-side mirror of `shares_marketplace()`,
 * resolved from an EXPLICIT university id rather than from the session, because
 * everything spatial on a listing resolves against the listing's school and not the
 * viewer's.
 *
 * It is a mirror, not a boundary. The RESTRICTIVE `tenant_isolation` policies are the
 * boundary; this exists so a query does not ask for rows the database would refuse,
 * and so a picker does not render a shorter list than the student is entitled to.
 */
type UniversityGroupRow = { id: string; marketplace_group: string | null };

/**
 * Every university sharing the given one's `marketplace_group`, including itself.
 *
 * Read from the DB rather than static config, the same reasoning `MarketplaceTab`
 * gives for its own group lookup: a school joins or leaves the group with one UPDATE
 * and no deploy. The table is a handful of rows, so this is one small query rather
 * than a group lookup followed by a membership lookup.
 *
 * FAILS CLOSED, deliberately and in both branches: an error, or a school with no
 * group, yields the passed university alone. Narrower than intended costs a few rows
 * a student cannot see; wider than intended asks for rows RLS will drop, and — on the
 * building picker specifically — would offer a building the tenant-consistency
 * trigger then refuses at INSERT with a 23514 the student cannot act on.
 */
export async function fetchGroupUniversityIds(universityId: string): Promise<string[]> {
  const { data, error } = await supabase.from('universities').select('id, marketplace_group');
  if (error) return [universityId];

  const rows = (data ?? []) as unknown as UniversityGroupRow[];
  const group = rows.find((r) => r.id === universityId)?.marketplace_group ?? null;
  if (!group) return [universityId];

  const ids = rows.filter((r) => r.marketplace_group === group).map((r) => r.id);
  // A group that somehow came back without its own member is a data problem, not a
  // reason to return an empty `in()` — which reads as "nothing at all".
  return ids.includes(universityId) ? ids : [...ids, universityId];
}
