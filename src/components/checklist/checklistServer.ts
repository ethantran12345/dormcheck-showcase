import { supabase } from "@/integrations/supabase/client";
import type { ChecklistGroup, GroupMember } from "./checklistTypes";

async function fetchAllChecklistGroups(userId: string): Promise<ChecklistGroup[]> {
  const { data: rows, error } = await supabase
    .from('ranking_group_members')
    .select('*, ranking_collaborations(*)')
    .eq('user_id', userId)
    .eq('status', 'accepted');

  // Throw, don't return []: a failed read rendered as "you have no group lists"
  // (contract §7). Callers' react-query handles the error state.
  if (error) throw error;
  if (!rows) return [];

  interface GroupMemberRow {
    ranking_collaborations: {
      id: string;
      owner_id: string;
      group_name: string | null;
    };
  }

  const groups: Array<{ id: string; owner_id: string; group_name: string | null }> = (rows as GroupMemberRow[])
    .map((row) => row.ranking_collaborations)
    .filter(Boolean);

  if (groups.length === 0) return [];

  const groupIds: string[] = Array.from(
    new Set(groups.map((r) => String(r.id ?? '')))
  );

  const { data: collaboratorRows } = await supabase
    .from('ranking_group_members')
    .select('group_id, user_id, status')
    .in('group_id', groupIds)
    .eq('role', 'collaborator')
    .in('status', ['accepted', 'pending']);

  interface CollaboratorRow {
    group_id: string;
    user_id: string;
    status: string;
  }

  const acceptedCollabByGroup = new Map<string, string>();
  const pendingCollabByGroup = new Map<string, string>();
  (collaboratorRows as CollaboratorRow[] | null ?? []).forEach((r) => {
    const gid = String(r.group_id);
    const uid = String(r.user_id);
    const status = String(r.status ?? '');
    if (status === 'accepted') {
      if (!acceptedCollabByGroup.has(gid)) acceptedCollabByGroup.set(gid, uid);
    } else if (status === 'pending') {
      if (!pendingCollabByGroup.has(gid)) pendingCollabByGroup.set(gid, uid);
    }
  });

  const chosenCollabByGroup = new Map<string, string>();
  groupIds.forEach((gid) => {
    const accepted = acceptedCollabByGroup.get(gid);
    const pending = pendingCollabByGroup.get(gid);
    if (typeof accepted === 'string' && accepted) chosenCollabByGroup.set(gid, accepted);
    else if (typeof pending === 'string' && pending) chosenCollabByGroup.set(gid, pending);
  });

  const allUserIds = [...new Set([
    ...groups.flatMap((r) => [String(r.owner_id ?? '')]),
    ...chosenCollabByGroup.values(),
  ])].filter(Boolean);

  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, full_name, avatar_url')
    .in('id', allUserIds);

  interface ProfileRow {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  }

  const profileById = new Map<string, { full_name?: string | null; avatar_url?: string | null }>(
    (profiles as ProfileRow[] | null ?? []).map((p) => [String(p.id), { full_name: p.full_name, avatar_url: p.avatar_url }])
  );

  return groups
    .map((r) => {
      const oid = String(r.owner_id ?? '');
      const cid = chosenCollabByGroup.get(String(r.id ?? '')) ?? '';
      const op = profileById.get(oid);
      const cp = profileById.get(cid);
      return {
        id: String(r.id ?? ''),
        owner_id: oid,
        collaborator_id: cid,
        owner_name: op?.full_name ?? null,
        collaborator_name: cp?.full_name ?? null,
        owner_avatar_url: op?.avatar_url ?? null,
        collaborator_avatar_url: cp?.avatar_url ?? null,
        group_name: (r.group_name as string | null)?.trim() || null,
        is_owner: oid === userId,
      };
    })
    .sort((a, b) => (a.is_owner ? 0 : 1) - (b.is_owner ? 0 : 1));
}

async function fetchGroupMembers(selectedGroupId: string): Promise<GroupMember[]> {
  const { data: rows, error } = await supabase
    .from('ranking_group_members')
    .select('id, user_id, role, status')
    .eq('group_id', selectedGroupId)
    .eq('status', 'accepted');

  if (error || !rows?.length) return [];

  interface GroupMemberRow {
    id: string;
    user_id: string;
    role: string;
    status: string;
  }

  const userIds = [...new Set((rows as GroupMemberRow[]).map((r) => String(r.user_id)))];
  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, full_name, avatar_url')
    .in('id', userIds);

  interface ProfileRow {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  }

  const profileById = new Map(
    (profiles as ProfileRow[] | null ?? []).map((p) => [
      String(p.id),
      {
        full_name: p.full_name,
        avatar_url: p.avatar_url,
      },
    ])
  );

  const result: GroupMember[] = (rows as GroupMemberRow[]).map((r) => {
    const p = profileById.get(String(r.user_id));
    return {
      id: r.id,
      user_id: String(r.user_id),
      full_name: p?.full_name ?? null,
      avatar_url: p?.avatar_url ?? null,
      role: (r.role ?? 'collaborator') as 'owner' | 'collaborator',
      status: r.status ?? 'accepted',
    };
  });

  return result;
}

export { fetchAllChecklistGroups, fetchGroupMembers };
