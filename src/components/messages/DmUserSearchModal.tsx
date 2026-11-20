import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, MessageCircle, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  FULL_SCREEN_DIALOG_BODY_CLASS,
  FULL_SCREEN_DIALOG_CONTENT_CLASS,
  FULL_SCREEN_DIALOG_HEADER_CLASS,
} from '@/lib/profileDialogClasses';
import { getOrCreateConversation } from '@/lib/getOrCreateConversation';
import { useAuth } from '@/hooks/useAuth';
import { primaryEmailDomain } from '@/config/universities';
import { useUniversity } from '@/contexts/UniversityContext';

interface SearchUserResult {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface DmUserSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  onConversationSelected: (conversationId: string) => void;
}

export function DmUserSearchModal({
  isOpen,
  onClose,
  currentUserId,
  onConversationSelected,
}: DmUserSearchModalProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const { isAdmin } = useAuth();
  const { university } = useUniversity();
  const emailDomain = primaryEmailDomain(university);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setResults([]);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.rpc('search_users', { search_query: q });
        if (error) throw error;
        setResults((data ?? []) as SearchUserResult[]);
      } catch (err) {
        console.error('[DmUserSearchModal] search error:', err);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen]);

  const handleSelect = useCallback(
    async (profile: SearchUserResult) => {
      if (selectingId) return;
      setSelectingId(profile.id);
      try {
        const convId = await getOrCreateConversation(currentUserId, profile.id, !isAdmin);
        if (convId) {
          onConversationSelected(convId);
          onClose();
        }
      } finally {
        setSelectingId(null);
      }
    },
    [currentUserId, onConversationSelected, onClose, selectingId]
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName="bg-black/60"
        className={cn(FULL_SCREEN_DIALOG_CONTENT_CLASS, 'sm:!max-w-lg [&>button]:hidden')}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        <DialogHeader
          className={cn(
            FULL_SCREEN_DIALOG_HEADER_CLASS,
            'flex-row items-center justify-between space-y-0 border-b border-border !px-5 !pb-4 sm:!pt-6',
          )}
        >
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <MessageCircle className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            {t('messaging:dmSearch.title')}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="shrink-0 border-b border-border p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('messaging:dmSearch.searchPlaceholder', { domain: emailDomain })}
              className="pl-9"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('messaging:dmSearch.onlyDomain', { domain: emailDomain })}</p>
        </div>

        <div className={cn(FULL_SCREEN_DIALOG_BODY_CLASS, '!px-0 !py-0')}>
          {!searchQuery.trim() && !searching && (
            <div className="flex flex-col px-5 py-8">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Users className="h-7 w-7 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                </div>
                <h2 className="mt-4 text-base font-semibold text-foreground">
                  {t('messaging:dmSearch.emptyTitle', { school: university.shortName })}
                </h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  {t('messaging:dmSearch.emptyBody', { domain: emailDomain })}
                </p>
              </div>
            </div>
          )}
          {searching && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          )}
          {!searching && searchQuery.trim() && results.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('messaging:dmSearch.noResults', { domain: emailDomain })}</p>
          )}
          {!searching && results.length > 0 && (
            <div className="divide-y divide-border">
              {results.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => void handleSelect(profile)}
                  disabled={selectingId !== null}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={profile.avatar_url ?? undefined} alt="" />
                    <AvatarFallback className="bg-muted text-sm text-muted-foreground">
                      {(profile.full_name ?? '?').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {profile.full_name ?? 'Unknown'}
                    </p>
                  </div>
                  {selectingId === profile.id ? (
                    <span className="text-xs text-muted-foreground">{t('messaging:dmSearch.opening')}</span>
                  ) : (
                    <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
