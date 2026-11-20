import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Loader2, Package, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/ui/responsive-modal';
import type { GroupMessageMetadata } from '@/types/groupMessageMeta';

type ChecklistItemMeta = Extract<GroupMessageMetadata, { type: 'checklist_item' }>;

interface ShareableChecklistItem {
  id: string;
  item: string;
  category: string | null;
  icon_name: string | null;
  image_url: string | null;
}

interface ShareChecklistItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen item's attachment payload. */
  onPick: (meta: ChecklistItemMeta) => void;
}

/**
 * Lets a resident pick one of their own checklist items to share into a
 * community/group room ("I'm bringing this"). Reads the caller's
 * `checklist_items` directly (lighter than the full useChecklist hook) and
 * returns a `checklist_item` attachment payload; sending is the caller's job.
 */
export function ShareChecklistItemDialog({ open, onOpenChange, onPick }: ShareChecklistItemDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<ShareableChecklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    setIsLoading(true);
    setError(false);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from('checklist_items')
        .select('id, item, category, icon_name, image_url, status')
        .eq('user_id', user.id)
        .neq('status', 'skip')
        .order('category', { ascending: true })
        .order('order_index', { ascending: true });
      if (cancelled) return;
      if (qErr) {
        setError(true);
      } else {
        setItems((data ?? []) as ShareableChecklistItem[]);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  // Reset the search each time it reopens.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.item.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  const handlePick = (i: ShareableChecklistItem) => {
    onPick({
      type: 'checklist_item',
      itemId: i.id,
      name: i.item,
      category: i.category,
      iconName: i.icon_name,
      imageUrl: i.image_url,
    });
    onOpenChange(false);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent dialogClassName="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('messaging:group.share.itemTitle')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t('messaging:group.share.itemSubtitle')}</ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {!isLoading && !error && items.length > 0 && (
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('messaging:group.share.searchPlaceholder')}
              className="pl-9"
              aria-label={t('messaging:group.share.searchPlaceholder')}
            />
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {t('messaging:group.share.loading')}
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('messaging:group.share.error')}</p>
          ) : items.length === 0 ? (
            <div className="py-8 text-center">
              <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
              <p className="text-sm font-medium text-foreground">{t('messaging:group.share.emptyTitle')}</p>
              <Link
                to="/checklist"
                onClick={() => onOpenChange(false)}
                className="mt-1 inline-block text-sm font-semibold text-foreground underline"
              >
                {t('messaging:group.share.emptyCta')}
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('messaging:group.share.noMatches')}</p>
          ) : (
            <ul className="space-y-1 pb-2">
              {filtered.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(i)}
                    className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {i.image_url ? (
                        <img src={i.image_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{i.item}</span>
                      {i.category && (
                        <span className="block truncate text-xs text-muted-foreground">{i.category}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
