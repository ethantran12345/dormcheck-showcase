import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Loader2, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { activeUniversities, getUniversityById } from '@/config/universities';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';
import { missingKeyFields } from '@/lib/dormDataHealth';
import { DormCsvTools } from '@/components/admin/DormCsvTools';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PAGE_SEARCH_ATTR } from '@/lib/pageSearch';
import { PageContainer } from '@/components/ui/page-container';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type DormRow = Pick<
  Tables<'master_housing'>,
  | 'id' | 'residence_hall' | 'housing_type' | 'accomodation' | 'rate_per_term' | 'capacity' | 'university_id'
  | 'image_url' | 'address' | 'latitude' | 'longitude' | 'details'
>;

/**
 * Silo-scoped dorm list. A university_admin only ever receives their own
 * school's rows (master_housing tenant RLS); a superadmin bypasses RLS, so
 * their picked silo is applied as an explicit filter.
 */
async function fetchDorms(siloFilter: string | null): Promise<DormRow[]> {
  let query = supabase
    .from('master_housing')
    .select(
      'id, residence_hall, housing_type, accomodation, rate_per_term, capacity, university_id, image_url, address, latitude, longitude, details',
    )
    .order('residence_hall', { ascending: true });
  if (siloFilter) query = query.eq('university_id', siloFilter);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** "5400" / "$5,400" / "$5,400.00" -> "$5,400 / term"; anything unparseable renders as-is. */
function formatRate(raw: string | null): string {
  if (!raw || raw.trim().length === 0) return ' - ';
  const numeric = Number.parseFloat(raw.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(numeric) || /[a-z]/i.test(raw)) return raw;
  return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: 0 })} / term`;
}

function parseRate(raw: string | null): number | null {
  if (!raw) return null;
  const numeric = Number.parseFloat(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) && !/[a-z]/i.test(raw) ? numeric : null;
}

type HallGroup = {
  key: string;
  hall: string;
  universityId: string | null;
  housingTypes: string[];
  rows: DormRow[];
  minRate: number | null;
  maxRate: number | null;
};

type SortKey = 'hall' | 'accommodations' | 'rate';
type SortDir = 'asc' | 'desc';

function groupByHall(rows: DormRow[]): HallGroup[] {
  const groups = new Map<string, HallGroup>();
  for (const row of rows) {
    const hall = row.residence_hall?.trim() || 'Unnamed hall';
    const key = `${row.university_id ?? ''}::${hall}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, hall, universityId: row.university_id, housingTypes: [], rows: [], minRate: null, maxRate: null };
      groups.set(key, group);
    }
    group.rows.push(row);
    if (row.housing_type && !group.housingTypes.includes(row.housing_type)) {
      group.housingTypes.push(row.housing_type);
    }
    const rate = parseRate(row.rate_per_term);
    if (rate != null) {
      group.minRate = group.minRate == null ? rate : Math.min(group.minRate, rate);
      group.maxRate = group.maxRate == null ? rate : Math.max(group.maxRate, rate);
    }
  }
  return [...groups.values()];
}

function rateRangeLabel(group: HallGroup): string {
  if (group.minRate == null) return ' - ';
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return group.minRate === group.maxRate
    ? `${fmt(group.minRate)} / term`
    : `${fmt(group.minRate)}-${fmt(group.maxRate)} / term`;
}

export default function DormsListPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: authLoading, profileLoaded } = useAuth();
  const { siloUniversityId } = useAdminUniversitySilo();
  const siloFilter = isSuperAdmin ? siloUniversityId : null;
  // Superadmins see every tenant's dorms (RLS bypass), so give them a school
  // column + filter to tell Pitt from CMU. A university_admin only ever sees
  // their own school (RLS-scoped), so the column/filter would just be noise.
  const [universityFilter, setUniversityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // Deep-link from the dashboard "By Dorm" table: `?q=<hall>` pre-filters the list.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [sortKey, setSortKey] = useState<SortKey>('hall');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['admin-dorms-list', siloUniversityId],
    queryFn: () => fetchDorms(siloFilter),
    enabled: !authLoading && !!user && isAdmin === true && (!isSuperAdmin || !!siloUniversityId),
    staleTime: 30_000,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const housingTypes = useMemo(
    () => [...new Set(rows.map((r) => r.housing_type).filter((t): t is string => !!t))].sort(),
    [rows],
  );

  const searchActive = search.trim().length > 0;

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!isSuperAdmin || universityFilter === 'all' || row.university_id === universityFilter) &&
        (typeFilter === 'all' || row.housing_type === typeFilter) &&
        (term.length === 0 ||
          (row.residence_hall ?? '').toLowerCase().includes(term) ||
          (row.accomodation ?? '').toLowerCase().includes(term)),
    );
    const grouped = groupByHall(filtered);
    const dir = sortDir === 'asc' ? 1 : -1;
    grouped.sort((a, b) => {
      if (sortKey === 'accommodations') return (a.rows.length - b.rows.length) * dir || a.hall.localeCompare(b.hall);
      if (sortKey === 'rate') {
        const ar = a.minRate ?? Number.POSITIVE_INFINITY;
        const br = b.minRate ?? Number.POSITIVE_INFINITY;
        return (ar - br) * dir || a.hall.localeCompare(b.hall);
      }
      return a.hall.localeCompare(b.hall) * dir;
    });
    return grouped;
  }, [rows, isSuperAdmin, universityFilter, typeFilter, search, sortKey, sortDir]);

  const totalShown = groups.reduce((n, g) => n + g.rows.length, 0);

  if (authLoading || !profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const columnCount = isSuperAdmin ? 5 : 4;

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-malachite-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Manage Dorms</h1>
              <p className="text-sm text-muted-foreground">
                Housing data grouped by residence hall. Expand a hall to see its room types.
              </p>
            </div>
          </div>
          <DormCsvTools />
        </div>

        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              // P8.3: "/" focuses this, the scoped search for the dorms list.
              {...{ [PAGE_SEARCH_ATTR]: '' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search halls or room types"
              aria-label="Search halls or room types"
              className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
            />
          </div>

          {isSuperAdmin && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter dorms by university">
              <FilterChip
                label="All universities"
                active={universityFilter === 'all'}
                onClick={() => setUniversityFilter('all')}
              />
              {activeUniversities().map((u) => (
                <FilterChip
                  key={u.id}
                  label={u.name}
                  active={universityFilter === u.id}
                  onClick={() => setUniversityFilter(u.id)}
                />
              ))}
            </div>
          )}

          {housingTypes.length > 1 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter dorms by housing type">
              <FilterChip label="All types" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              {housingTypes.map((t) => (
                <FilterChip key={t} label={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} />
              ))}
            </div>
          )}
        </div>

        <section className="space-y-3">
          <p className="text-sm text-muted-foreground" role="status">
            {query.isLoading
              ? 'Loading halls...'
              : `${groups.length} ${groups.length === 1 ? 'hall' : 'halls'}, ${totalShown} ${totalShown === 1 ? 'room type' : 'room types'}`}
          </p>
          <div className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
            {query.isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : query.isError ? (
              <div className="px-4 py-6 text-center text-sm text-foreground">
                Couldn't load dorms.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-sm">
                  <TableHeader className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <TableRow>
                      {isSuperAdmin && <TableHead className="px-4 py-3 font-medium">University</TableHead>}
                      <SortableHeader label="Residence Hall" sortKey="hall" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                      <SortableHeader label="Room Types" sortKey="accommodations" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                      <SortableHeader label="Rate / Term" sortKey="rate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                      <TableHead className="px-4 py-3 font-medium">Housing Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border">
                    {groups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={columnCount} className="px-4 py-6 text-center text-sm text-muted-foreground">
                          {searchActive || typeFilter !== 'all' ? 'No halls match the current filters.' : 'No dorms found.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      groups.map((group) => {
                        const isOpen = searchActive || expanded.has(group.key);
                        return (
                          <GroupRows
                            key={group.key}
                            group={group}
                            isOpen={isOpen}
                            isSuperAdmin={isSuperAdmin}
                            onToggle={() => toggleGroup(group.key)}
                          />
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </section>
      </PageContainer>
    </div>
  );
}

function GroupRows({
  group,
  isOpen,
  isSuperAdmin,
  onToggle,
}: {
  group: HallGroup;
  isOpen: boolean;
  isSuperAdmin: boolean;
  onToggle: () => void;
}) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <>
      <TableRow className="bg-card hover:bg-stone-50 transition-colors">
        {isSuperAdmin && (
          <TableCell className="px-4 py-3">
            <span className="inline-flex items-center rounded-full bg-malachite-50 px-2 py-0.5 text-xs font-semibold text-malachite-800">
              {getUniversityById(group.universityId ?? '')?.shortName ?? 'Unknown'}
            </span>
          </TableCell>
        )}
        <TableCell className="px-4 py-3">
          <Button
            variant="ghost"
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            className="flex items-center gap-2 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 rounded"
          >
            <Chevron className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {group.hall}
          </Button>
        </TableCell>
        <TableCell className="px-4 py-3 text-foreground">
          {group.rows.length} {group.rows.length === 1 ? 'room type' : 'room types'}
          <GroupGapBadge rows={group.rows} />
        </TableCell>
        <TableCell className="px-4 py-3 text-foreground whitespace-nowrap">{rateRangeLabel(group)}</TableCell>
        <TableCell className="px-4 py-3 text-foreground">{group.housingTypes.join(', ') || ' - '}</TableCell>
      </TableRow>
      {isOpen &&
        group.rows.map((row) => (
          <TableRow key={row.id} className="bg-stone-50/60">
            <TableCell className="px-4 py-2 pl-12 text-foreground" colSpan={isSuperAdmin ? 2 : 1}>
              {row.accomodation ?? 'Unspecified room type'}
              <MissingBadge row={row} />
            </TableCell>
            <TableCell className="px-4 py-2 text-muted-foreground">
              {row.capacity?.trim() || ' - '}
            </TableCell>
            <TableCell className="px-4 py-2 text-foreground whitespace-nowrap">{formatRate(row.rate_per_term)}</TableCell>
            <TableCell className="px-4 py-2 text-right">
              <Link
                to={`/admin/dorms/${row.id}`}
                className="text-sm font-medium text-malachite-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 rounded"
              >
                Edit
                <span className="sr-only"> {group.hall} {row.accomodation ?? ''}</span>
              </Link>
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className="px-4 py-3 font-medium" aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Button
        variant="ghost"
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 rounded"
      >
        {label}
        <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-malachite-800' : 'text-muted-foreground')} aria-hidden="true" />
      </Button>
    </TableHead>
  );
}

function MissingBadge({ row }: { row: DormRow }) {
  const missing = missingKeyFields(row);
  if (missing.length === 0) return null;
  return (
    <span
      title={`Missing: ${missing.join(', ')}`}
      className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800"
    >
      {missing.length} {missing.length === 1 ? 'field' : 'fields'} missing
    </span>
  );
}

function GroupGapBadge({ rows }: { rows: DormRow[] }) {
  const withGaps = rows.filter((r) => missingKeyFields(r).length > 0).length;
  if (withGaps === 0) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
      {withGaps} with gaps
    </span>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1',
        active
          ? 'border-malachite-600 bg-malachite-50 text-malachite-800'
          : 'border-border bg-card text-stone-600 hover:bg-stone-100',
      )}
    >
      {label}
    </Button>
  );
}
