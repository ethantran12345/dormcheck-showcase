import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { logAdminAction } from '@/lib/adminAudit';
import type { Json, Tables } from '@/integrations/supabase/types';

export type DormEdit = Tables<'dorm_edits'>;

export interface DormEditWithEditor extends DormEdit {
  editor_full_name: string | null;
}

async function fetchDormEdits(dormId: number): Promise<DormEditWithEditor[]> {
  const { data: edits, error } = await supabase
    .from('dorm_edits')
    .select('*')
    .eq('dorm_id', dormId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    if (error.code === 'PGRST301' || error.code === '42501') return [];
    throw error;
  }

  const rows = edits ?? [];
  if (rows.length === 0) return [];

  const editorIds = Array.from(
    new Set(rows.map((r) => r.edited_by).filter((v): v is string => typeof v === 'string')),
  );
  const fullNameById = new Map<string, string | null>();
  if (editorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('public_profiles')
      .select('id, full_name')
      .in('id', editorIds);
    (profiles ?? []).forEach((p) => {
      fullNameById.set(p.id, p.full_name ?? null);
    });
  }

  return rows.map((r) => ({
    ...r,
    editor_full_name: r.edited_by ? fullNameById.get(r.edited_by) ?? null : null,
  }));
}

export function useDormEdits(dormId: number | null | undefined) {
  const query = useQuery({
    queryKey: ['dorm-edits', dormId],
    queryFn: () => fetchDormEdits(dormId as number),
    enabled: typeof dormId === 'number' && Number.isFinite(dormId),
    staleTime: 30_000,
  });

  return {
    edits: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
    refetch: query.refetch,
  };
}

/**
 * Insert an audit-trail row for a single field change on master_housing.
 * RLS permits admins only; non-admin callers receive an error from Postgres.
 * Phase 1: this is a stub - no editing UI calls it yet.
 */
export async function logDormEdit(
  dormId: number,
  fieldName: string,
  oldValue: Json,
  newValue: Json,
): Promise<void> {
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { error } = await supabase.from('dorm_edits').insert({
    dorm_id: dormId,
    edited_by: userId,
    field_name: fieldName,
    old_value: oldValue,
    new_value: newValue,
  });
  if (error) throw error;

  // Roll-up entry in the tiered admin audit trail. dorm_edits keeps the field-level
  // detail (master_housing ids are ints, target_id is uuid); a failure here is
  // logged but does not reverse the edit.
  await logAdminAction(`dorm_edit.${fieldName}`, 'master_housing', null);
}
