import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Search, X, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FULL_SCREEN_DIALOG_BODY_CLASS,
  FULL_SCREEN_DIALOG_CONTENT_CLASS,
  FULL_SCREEN_DIALOG_FOOTER_CLASS,
  FULL_SCREEN_DIALOG_HEADER_CLASS,
} from '@/lib/profileDialogClasses';
import { toast } from 'sonner';
import { sanitizeText } from '@/lib/sanitize';
import type { Database } from '@/integrations/supabase/types';

type ProfileRow = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'avatar_url'
>;

const SEARCH_DEBOUNCE_MS = 300;

// Stable default so the reset effect's dependency doesn't change every render
// (a fresh [] default caused a setState loop while the modal was mounted closed).
const EMPTY_MEMBERS: ProfileRow[] = [];

function escapeIlikeUserFragment(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

interface CreateGroupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupCreated?: (groupId: string) => void;
  /** Optional: prefill group name (used by building chats later) */
  initialName?: string;
  /** Optional: prefill some members (used by building chats later) */
  initialMembers?: ProfileRow[];
}

export function CreateGroupModal({
  open,
  onOpenChange,
  onGroupCreated,
  initialName = '',
  initialMembers = EMPTY_MEMBERS,
}: CreateGroupModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [groupName, setGroupName] = useState(initialName);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<ProfileRow[]>(initialMembers);
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const groupNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    if (!open) {
      setGroupName(initialName);
      setSearchTerm('');
      setDebouncedSearch('');
      setSelectedMembers(initialMembers);
      setSearchResults([]);
    }
  }, [open, initialName, initialMembers]);

  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    if (!user?.id) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    (async () => {
      const safe = escapeIlikeUserFragment(debouncedSearch);
      const pattern = `%${safe}%`;
      const { data, error } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .ilike('full_name', pattern)
        .neq('id', user.id)
        .limit(10);

      if (cancelled) return;
      if (error) {
        toast.error(t('messaging:createGroup.toast.searchFailed'));
        setSearchResults([]);
      } else {
        const selectedIds = new Set(selectedMembers.map((m) => m.id));
        setSearchResults((data ?? []).filter((p) => !selectedIds.has(p.id)));
      }
      setIsSearching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, user?.id, selectedMembers]);

  const canCreate = useMemo(() => {
    return (
      !!user &&
      groupName.trim().length >= 1 &&
      groupName.trim().length <= 60 &&
      selectedMembers.length >= 1 &&
      !isCreating
    );
  }, [user, groupName, selectedMembers.length, isCreating]);

  const addMember = (profile: ProfileRow) => {
    setSelectedMembers((prev) => [...prev, profile]);
    setSearchTerm('');
    setSearchResults([]);
  };

  const removeMember = (profileId: string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== profileId));
  };

  const handleCreate = async () => {
    if (!user || !canCreate) return;
    setIsCreating(true);

    try {
      const sanitizedName = sanitizeText(groupName).trim();
      if (!sanitizedName) {
        toast.error(t('messaging:createGroup.toast.nameRequired'));
        return;
      }

      const { data: newGroup, error: gErr } = await supabase
        .from('group_conversations')
        .insert({
          name: sanitizedName.slice(0, 60),
          created_by: user.id,
        })
        .select('*')
        .single();

      if (gErr || !newGroup) {
        toast.error(t('messaging:createGroup.toast.createFailed'), {
          description: gErr?.message ?? t('messaging:createGroup.toast.unknownError'),
        });
        return;
      }

      const memberRows = [
        { group_id: newGroup.id, user_id: user.id },
        ...selectedMembers.map((m) => ({ group_id: newGroup.id, user_id: m.id })),
      ];

      const { error: mErr } = await supabase.from('group_members').insert(memberRows);

      if (mErr) {
        await supabase.from('group_conversations').delete().eq('id', newGroup.id);
        toast.error(t('messaging:createGroup.toast.addMembersFailed'), {
          description: mErr.message,
        });
        return;
      }

      toast.success(t('messaging:createGroup.toast.created', { name: newGroup.name, count: selectedMembers.length + 1 }));
      queryClient.invalidateQueries({ queryKey: ['group-conversations', user.id] });
      onGroupCreated?.(newGroup.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(t('messaging:createGroup.toast.unexpectedError'), {
        description: (e as Error).message,
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-black/60"
        className={cn(FULL_SCREEN_DIALOG_CONTENT_CLASS, 'sm:!max-w-lg [&>button]:hidden')}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          groupNameInputRef.current?.focus();
        }}
      >
        <DialogHeader
          className={cn(
            FULL_SCREEN_DIALOG_HEADER_CLASS,
            'flex-row items-center justify-between space-y-0 border-b border-border !px-5 !pb-4 sm:!pt-6',
          )}
        >
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Users className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            {t('messaging:createGroup.title')}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('actions.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className={cn(FULL_SCREEN_DIALOG_BODY_CLASS, 'space-y-5')}>
          <div>
            <label htmlFor="group-name" className="mb-1.5 block text-sm font-medium text-foreground">
              {t('messaging:createGroup.nameLabel')}
            </label>
            <Input
              ref={groupNameInputRef}
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t('messaging:createGroup.namePlaceholder')}
              maxLength={60}
            />
            <p className="mt-1 text-xs text-muted-foreground">{groupName.length}/60</p>
          </div>

          {selectedMembers.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">{t('messaging:createGroup.membersCount', { n: selectedMembers.length })}</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => removeMember(m.id)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
                    aria-label={t('messaging:createGroup.removeMember', { name: m.full_name ?? t('messaging:createGroup.memberFallback') })}
                  >
                    {m.full_name ?? 'Unknown'}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="member-search" className="mb-1.5 block text-sm font-medium text-foreground">
              {t('messaging:createGroup.addMembersLabel')}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="member-search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('messaging:createGroup.searchPlaceholder')}
                className="pl-9"
              />
            </div>

            {isSearching && (
              <div className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('messaging:createGroup.searching')}
              </div>
            )}
            {!isSearching && debouncedSearch.length >= 2 && searchResults.length === 0 && (
              <p className="px-1 py-3 text-sm text-muted-foreground">{t('messaging:createGroup.noMatches')}</p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addMember(p)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <Avatar className="h-9 w-9">
                      {p.avatar_url ? <AvatarImage src={p.avatar_url} alt={p.full_name ?? ''} /> : null}
                      <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                        {(p.full_name ?? '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium text-foreground">{p.full_name ?? 'Unknown'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={cn(FULL_SCREEN_DIALOG_FOOTER_CLASS, 'border-t border-border')}>
          <Button
            type="button"
            // KEEP: primary CTA of the create-group modal
            className="w-full bg-malachite-800 text-white hover:bg-malachite-900"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('messaging:createGroup.creating')}
              </>
            ) : (
              t('messaging:createGroup.create')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
