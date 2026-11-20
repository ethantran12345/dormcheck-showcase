import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollText, X } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { LEGAL_NOTICE_VERSION, needsLegalNotice } from '@/lib/legalNotice';

/**
 * In-platform notice that Terms / Privacy changed materially.
 *
 * Privacy §11 commits us to communicating material changes in-platform or by
 * email; this is the in-platform channel. It is a NOTICE, not a consent gate:
 * it never blocks the app, never traps focus, and dismissing it records only
 * that the user was told.
 *
 * State lives per account in `profiles.legal_notice_ack_version` rather than in
 * localStorage, so the record survives a device change and so we can actually
 * answer "was this user notified?" later. See src/lib/legalNotice.ts for the
 * version contract.
 */
export function LegalUpdateNotice() {
  const { user } = useAuth();
  const { t } = useTranslation(['misc', 'common']);
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const queryKey = ['legal-notice-ack', userId] as const;

  const {
    data: acknowledgedVersion,
    isLoading,
    isError: readFailed,
    isFetching,
    refetch,
  } = useQuery({
    queryKey,
    enabled: !!userId,
    // The row is tiny and only this component writes it, so a long stale window
    // costs nothing and keeps the notice off the critical path of every route.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        // Cast: generated types deliberately lag prod (see
        // .claude/rules/supabase-backend.md), so this column is not in types.ts
        // until the next batched regen.
        .select('legal_notice_ack_version' as '*')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as { legal_notice_ack_version?: string | null } | null)
        ?.legal_notice_ack_version ?? null) as string | null;
    },
  });

  const acknowledge = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({
          legal_notice_ack_version: LEGAL_NOTICE_VERSION,
          legal_notice_ack_at: new Date().toISOString(),
        } as never)
        .eq('id', userId!);
      if (error) throw error;
    },
    // Optimistic: the notice should disappear the instant it is dismissed. A
    // failed write simply means it returns on the next load, which is the safe
    // direction to fail for a legal notice.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, LEGAL_NOTICE_VERSION);
      return { previous };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(queryKey, context?.previous ?? null);
    },
  });

  // Never flash the banner before we know: an unnecessary "we changed our
  // terms" is worse than a late one.
  if (!userId || isLoading || !needsLegalNotice(acknowledgedVersion)) return null;

  return (
    // Floating rather than in the document flow, and deliberately so: several
    // pages pull themselves up under the shell's top offset with `-mt-12`
    // (/my-home and /settings do, /checklist and /marketplace do not), which
    // silently ate 48px of an in-flow banner and rendered it clipped mid-card.
    // A fixed layer cannot be reached by a sibling's negative margin, so this
    // is correct on every route instead of on the ones we happened to check.
    // pointer-events-none on the layer keeps the rest of the screen clickable.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:px-6 md:pb-6">
      {/* Centred by the flex parent rather than `mx-auto`: `max-w-xl` here is the
          intrinsic size of a floating card (the contract's Dialog case), not a
          page's reading measure, and `mx-auto + max-w-*` is exactly the shape
          that means "hand-rolled page container". See ui/page-container.tsx. */}
      <div
        role="status"
        className="pointer-events-auto relative flex w-full max-w-xl flex-col gap-3 rounded-card border border-stone-200 bg-card p-4 shadow-overlay"
      >
        <div className="flex items-start gap-3 pr-8">
          <ScrollText className="mt-0.5 h-5 w-5 shrink-0 text-malachite-600" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug text-foreground">
              {t('misc:legalNotice.title')}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {t('misc:legalNotice.body')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-8">
          <Button asChild size="sm" variant="outline">
            <Link to="/terms">{t('misc:legalNotice.readTerms')}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/privacy">{t('misc:legalNotice.readPrivacy')}</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => acknowledge.mutate()}
            disabled={acknowledge.isPending}
          >
            {t('misc:legalNotice.acknowledge')}
          </Button>
          {readFailed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {t('common:actions.retry')}
            </Button>
          )}
        </div>
        {(readFailed || acknowledge.isError) && (
          <p role="alert" className="pl-8 text-xs leading-relaxed text-destructive">
            {t('misc:error.sectionBody')}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common:actions.dismiss')}
          onClick={() => acknowledge.mutate()}
          disabled={acknowledge.isPending}
          // Tint stated as a descendant rule, not as an inherited text-*: Button
          // already sets the glyph colour via [&_svg], so an inherited value
          // loses to it and the X would resolve to foreground (DECISIONS 2026-07-27).
          className="absolute right-1 top-1 h-8 w-8 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
