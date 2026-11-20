import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type ReportableContentType =
  | 'marketplace_listing'
  | 'roommate_post'
  | 'building_chat_link'
  | 'user'
  | 'seller_rating'
  | 'student_setup'
  | 'group_message'
  | 'dm_message'
  // Restored 2026-09-06 alongside the dorm ratings feature. A review carries no
  // free text, so these are post-hoc reports of a bad-faith rating, never
  // pre-moderation.
  | 'student_review';

/** Structured report categories (content_reports.category CHECK, migration
 *  20260712100000). Keep values in sync with the DB constraint. */
export type ReportCategory =
  | 'scam_fraud'
  | 'fake_listing'
  | 'harassment'
  | 'off_platform_payment'
  | 'spam'
  | 'other';

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  scam_fraud: 'Scam or fraud',
  fake_listing: 'Fake listing',
  harassment: 'Harassment',
  off_platform_payment: 'Asking to pay off-platform',
  spam: 'Spam',
  other: 'Other',
};

/**
 * Submit a content report. Idempotent on the (content_type, content_id,
 * reporter_id) unique constraint - re-reporting the same content is
 * treated as success.
 */
export function useReportContent() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      contentType: ReportableContentType;
      contentId: string;
      category: ReportCategory;
      reason?: string;
    }): Promise<void> => {
      if (!user?.id) throw new Error('Not signed in');

      const base = {
        content_type: params.contentType,
        content_id: params.contentId,
        reporter_id: user.id,
        reason: params.reason?.trim() || null,
      };
      // `category` lands with migration 20260712100000; generated types lag
      // prod by convention, and prod may not have the column yet - fall back
      // to a category-less report rather than losing it (PGRST204 = unknown
      // column in PostgREST schema cache).
      let { error } = await supabase
        .from('content_reports')
        .insert({ ...base, category: params.category } as never);
      if (error?.code === 'PGRST204') {
        ({ error } = await supabase.from('content_reports').insert(base));
      }

      if (error) {
        // 23505 = unique violation = already reported (idempotent success)
        if (error.code === '23505') return;
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate admin reports view (if loaded) and the count badge
      queryClient.invalidateQueries({ queryKey: ['admin-content-reports'] });
      queryClient.invalidateQueries({ queryKey: ['admin-pending-reports-count'] });
    },
  });
}
