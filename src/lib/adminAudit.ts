import { supabase } from '@/integrations/supabase/client';

/**
 * Append a row to admin_audit_log for a privileged client-side action.
 * Generalizes the insert shape used by dorm edits and report moderation:
 * stamp the caller as actor, scope to their university, and never let an
 * audit failure block the action itself (log it instead).
 *
 * Server-side actions (api/admin-invite, the role RPCs) write their own
 * audit rows; this helper is for actions performed directly from the client.
 */
export async function logAdminAction(
  action: string,
  targetType: string,
  targetId: string | null,
  universityId?: string | null,
): Promise<void> {
  try {
    const { data: userResult } = await supabase.auth.getUser();
    const userId = userResult.user?.id;
    if (!userId) throw new Error('Not authenticated');

    let scope = universityId;
    if (scope === undefined) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('university_id')
        .eq('id', userId)
        .maybeSingle();
      scope = (prof as { university_id?: string | null } | null)?.university_id ?? null;
    }

    const { error } = await supabase.from('admin_audit_log').insert({
      actor_id: userId,
      action,
      target_type: targetType,
      target_id: targetId,
      university_id: scope,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[admin audit log] failed to log', action, err);
  }
}
