import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BellRing,
  Building2,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  LifeBuoy,
  ListPlus,
  Loader2,
  LogOut,
  Map as MapIcon,
  MessageCircle,
  MessageSquarePlus,
  Moon,
  PackagePlus,
  Settings,
  Shield,
  ShoppingBag,
  Sun,
  Tag,
  Truck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useUniversity } from '@/contexts/UniversityContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import {
  PALETTE_ACTION_PATHS,
  readRecentActions,
  recordRecentAction,
  visiblePaletteActions,
  type PaletteActionId,
} from '@/lib/paletteActions';
import { ShortcutKeys } from '@/components/shortcuts/ShortcutKeys';
import { useShowKeyboardHints } from '@/components/shortcuts/useShowKeyboardHints';
import { SAFETY_CENTER_PATH, visibleSettingsSections } from '@/components/settings/settingsSections';
import { dormSlugFromName } from '@/lib/dormSlug';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { safeImageSrc } from '@/lib/sanitize';

type SearchCategory = 'all' | 'actions' | 'pages' | 'dorms' | 'marketplace' | 'checklist';

type ActionEntry = {
  id: PaletteActionId;
  label: string;
  icon: LucideIcon;
  /** Extra lowercase terms that should match this action. */
  keywords: string[];
  tone?: 'destructive';
};

/** Touch-first input: raising the keyboard on open would cover the actions list. */
function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

type PageEntry = {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** Extra lowercase terms that should match this page. */
  keywords: string[];
  /** Optional router state (e.g. marketplace listing deep-link). */
  state?: Record<string, unknown>;
};

/** Small debounce so remote search fires on pauses, not every keystroke. */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function GlobalSearchDialog({
  open,
  onOpenChange,
  takeReturnFocus,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hands back the control that opened the palette (null once it is gone). */
  takeReturnFocus?: () => HTMLElement | null;
  /** Swap the palette for the "?" shortcuts sheet (footer button). */
  onShowShortcuts?: () => void;
}) {
  const { t } = useTranslation();
  const showKeyboardHints = useShowKeyboardHints();
  const navigate = useNavigate();
  const { user, isAdmin, signOut } = useAuth();
  // View-as aware: a superadmin previewing as a student gets the student's palette.
  const { effectiveIsAdmin } = useAdminUniversitySilo();
  const { resolvedTheme, setPreference } = useTheme();
  // App Store 1.2: a blocked user's content must not surface anywhere,
  // including global search results.
  const { blockedUserIds } = useBlockedUserIds();
  const { showHousing, showRoommates, showMap, showSchedule, showPostItem } = useFeatureFlags();
  const { university } = useUniversity();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('all');
  const q = query.trim().toLowerCase();
  const debouncedQ = useDebounced(q, 250);
  const remoteEnabled = open && debouncedQ.length >= 2;

  // Reset state whenever the palette closes so it reopens fresh; re-read recents
  // on open so an action taken in another tab still floats up here.
  const [recentActions, setRecentActions] = useState<string[]>(() => readRecentActions());
  useEffect(() => {
    if (!open) {
      setQuery('');
      setCategory('all');
    } else {
      setRecentActions(readRecentActions());
    }
  }, [open]);

  const actions = useMemo<ActionEntry[]>(() => {
    const isDark = resolvedTheme === 'dark';
    const byId: Record<PaletteActionId, ActionEntry> = {
      'new-listing': { id: 'new-listing', label: t('misc:search.actions.newListing'), icon: PackagePlus, keywords: ['post', 'sell', 'new listing', 'list an item', 'marketplace'] },
      'add-checklist-item': { id: 'add-checklist-item', label: t('misc:search.actions.addChecklistItem'), icon: ListPlus, keywords: ['add', 'checklist', 'item', 'packing', 'todo'] },
      'start-message': { id: 'start-message', label: t('misc:search.actions.startMessage'), icon: MessageSquarePlus, keywords: ['message', 'dm', 'chat', 'new message', 'write'] },
      'toggle-theme': {
        id: 'toggle-theme',
        label: isDark ? t('misc:search.actions.lightMode') : t('misc:search.actions.darkMode'),
        icon: isDark ? Sun : Moon,
        keywords: ['theme', 'dark', 'light', 'mode', 'appearance'],
      },
      'notification-settings': { id: 'notification-settings', label: t('misc:search.actions.notificationSettings'), icon: BellRing, keywords: ['notifications', 'alerts', 'email', 'push', 'settings'] },
      'admin-console': { id: 'admin-console', label: t('misc:search.actions.adminConsole'), icon: Shield, keywords: ['admin', 'console', 'moderation', 'reports'] },
      'sign-out': { id: 'sign-out', label: t('misc:search.actions.signOut'), icon: LogOut, keywords: ['sign out', 'log out', 'logout', 'leave'], tone: 'destructive' },
    };
    return visiblePaletteActions(
      { showPostItem, isAdmin: effectiveIsAdmin, isNative: Capacitor.isNativePlatform() },
      recentActions,
    ).map((id) => byId[id]);
  }, [t, resolvedTheme, showPostItem, effectiveIsAdmin, recentActions]);

  const matchedActions = useMemo(() => {
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.keywords.some((k) => k.includes(q) || q.includes(k)),
    );
  }, [actions, q]);
  const pages = useMemo<PageEntry[]>(() => {
    const entries: PageEntry[] = [
      { id: 'my-home', label: t('misc:nav.myHome'), icon: User, path: '/my-home', keywords: ['home', 'dashboard', 'countdown', 'move in'] },
      { id: 'checklist', label: t('misc:nav.checklist'), icon: ClipboardCheck, path: '/checklist', keywords: ['checklist', 'packing', 'items', 'todo', 'shop', 'essentials'] },
      { id: 'logistics', label: t('misc:nav.logistics'), icon: Truck, path: '/logistics', keywords: ['move in', 'move out', 'logistics', 'moving', 'boxes'] },
      { id: 'marketplace', label: t('misc:nav.marketplace'), icon: ShoppingBag, path: '/marketplace', keywords: ['marketplace', 'buy', 'sell', 'listings', 'shop'] },
      { id: 'my-items', label: t('misc:search.myListings'), icon: Tag, path: '/marketplace/my-items', keywords: ['my items', 'my listings', 'selling', 'sold'] },
      { id: 'messages', label: t('misc:search.messages'), icon: MessageCircle, path: '/messages', keywords: ['messages', 'chat', 'dm', 'inbox'] },
      { id: 'notifications', label: t('misc:search.notifications'), icon: Bell, path: '/notifications', keywords: ['notifications', 'alerts', 'activity'] },
      { id: 'roommates', label: t('misc:nav.roommates'), icon: Users, path: showRoommates ? '/roommates' : '/roommates/us', keywords: ['roommates', 'roommate', 'group', 'match', 'people'] },
      { id: 'profile', label: t('common:labels.profile'), icon: User, path: '/profile', keywords: ['profile', 'me', 'my account', 'avatar'] },
      { id: 'settings', label: t('common:labels.settings'), icon: Settings, path: '/settings', keywords: ['settings', 'account', 'preferences'] },
      // Safety Center lost its standalone route (PRD §5b); Settings > Support is
      // now its only home, so search deep-links straight into that doc.
      { id: 'safety', label: t('misc:search.safety'), icon: LifeBuoy, path: SAFETY_CENTER_PATH, keywords: ['safety', 'emergency', 'report', 'help'] },
    ];
    if (showSchedule) {
      entries.push({ id: 'schedule', label: t('misc:nav.schedule'), icon: CalendarDays, path: '/schedule', keywords: ['schedule', 'classes', 'calendar', 'courses'] });
    }
    if (showHousing) {
      entries.push({
        id: 'housing',
        label: t('misc:nav.housing'),
        icon: Building2,
        path: '/housing',
        keywords: ['housing', 'dorms', 'explore', 'buildings', 'residence'],
      });
    }
    if (showMap) {
      entries.push({
        id: 'map',
        label: t('misc:search.campusMap'),
        icon: MapIcon,
        path: '/map',
        keywords: ['map', 'campus', 'directions', 'buildings'],
      });
    }
    // Settings sections deep-link straight to their panel (?section=).
    for (const section of visibleSettingsSections(isAdmin)) {
      entries.push({
        id: `settings-${section.id}`,
        label: `${t('common:labels.settings')} · ${t(section.labelKey)}`,
        icon: section.icon,
        path: `/settings?section=${section.id}`,
        keywords: [section.label.toLowerCase(), 'settings', section.id],
      });
    }
    return entries;
  }, [t, isAdmin, showHousing, showMap, showRoommates, showSchedule, university.shortName]);

  const matchedPages = useMemo(() => {
    if (!q) return pages.slice(0, 8);
    return pages.filter(
      (p) => p.label.toLowerCase().includes(q) || p.keywords.some((k) => k.includes(q) || q.includes(k)),
    );
  }, [pages, q]);

  const { data: dorms = [], isFetching: dormsFetching } = useQuery({
    queryKey: ['global_search_dorms', debouncedQ],
    enabled: remoteEnabled && showHousing,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('master_housing')
        .select('residence_hall, image_url')
        .ilike('residence_hall', `%${debouncedQ}%`)
        .limit(30);
      if (error) return [];
      // One row per building (master_housing has a row per room type), with
      // Bouquet Gardens A-F consolidated the way useDorms groups them.
      const seen = new Set<string>();
      const buildings: { name: string; slug: string; image_url: string | null }[] = [];
      for (const row of data ?? []) {
        let name = String(row.residence_hall ?? '').trim();
        if (!name) continue;
        if (/^bouquet gardens/i.test(name)) name = 'Bouquet Gardens';
        if (seen.has(name)) continue;
        seen.add(name);
        buildings.push({ name, slug: dormSlugFromName(name), image_url: row.image_url });
        if (buildings.length >= 6) break;
      }
      return buildings;
    },
  });

  const { data: listings = [], isFetching: listingsFetching } = useQuery({
    queryKey: ['global_search_listings', debouncedQ, blockedUserIds.size],
    enabled: remoteEnabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketplace_listings')
        // user_id is selected only so blocked sellers can be filtered out below.
        .select('id, title, price, image_urls, status, user_id')
        .ilike('title', `%${debouncedQ}%`)
        .in('status', ['available', 'pending'])
        .eq('is_sublease', false)
        .order('created_at', { ascending: false })
        // Over-fetch so filtering blocked sellers cannot shrink the result
        // list below the 6 the UI shows.
        .limit(24);
      if (error) return [];
      return (data ?? [])
        .filter((row) => !row.user_id || !blockedUserIds.has(row.user_id))
        .slice(0, 6);
    },
  });

  const { data: checklistItems = [], isFetching: checklistFetching } = useQuery({
    queryKey: ['global_search_checklist', debouncedQ, user?.id],
    enabled: remoteEnabled && !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklist_items')
        .select('id, item, is_checked')
        .eq('user_id', user!.id)
        .ilike('item', `%${debouncedQ}%`)
        .limit(20);
      if (error) return [];
      // The same item name can exist on the personal list and a group list -
      // show it once (prefer the unchecked copy so it doesn't look done).
      const byName = new Map<string, { id: string; item: string; is_checked: boolean }>();
      for (const row of data ?? []) {
        const key = row.item.trim().toLowerCase();
        const existing = byName.get(key);
        if (!existing || (existing.is_checked && !row.is_checked)) byName.set(key, row);
      }
      return Array.from(byName.values()).slice(0, 6);
    },
  });

  const go = (path: string, state?: Record<string, unknown>) => {
    onOpenChange(false);
    navigate(path, state ? { state } : undefined);
  };

  const runAction = (id: PaletteActionId) => {
    setRecentActions(recordRecentAction(id));
    if (id === 'toggle-theme') {
      onOpenChange(false);
      setPreference(resolvedTheme === 'dark' ? 'light' : 'dark');
      return;
    }
    if (id === 'sign-out') {
      onOpenChange(false);
      void signOut();
      return;
    }
    go(PALETTE_ACTION_PATHS[id]);
  };

  // A debounced query is still settling, or one of the remote groups is in flight:
  // without this a slow network reads as "no results".
  const searching =
    q.length >= 2 && (q !== debouncedQ || dormsFetching || listingsFetching || checklistFetching);

  const handleOpenAutoFocus = useCallback((e: Event) => {
    if (!isCoarsePointer()) return;
    // Keep the on-screen keyboard down: focus the dialog itself so screen readers
    // still land inside it, and the student can tap the field when they want it.
    e.preventDefault();
    (e.currentTarget as HTMLElement | null)?.focus();
  }, []);

  const handleCloseAutoFocus = useCallback(
    (e: Event) => {
      const target = takeReturnFocus?.();
      if (!target) return;
      e.preventDefault();
      target.focus();
    },
    [takeReturnFocus],
  );

  const showGroup = (g: Exclude<SearchCategory, 'all'>) => category === 'all' || category === g;

  const categories: { id: SearchCategory; label: string }[] = [
    { id: 'all', label: t('misc:search.filterAll') },
    { id: 'actions', label: t('misc:search.groupActions') },
    { id: 'pages', label: t('misc:search.groupPages') },
    ...(showHousing ? [{ id: 'dorms' as const, label: t('misc:search.groupDorms') }] : []),
    { id: 'marketplace', label: t('misc:search.groupMarketplace') },
    { id: 'checklist', label: t('misc:search.groupChecklist') },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      onOpenAutoFocus={handleOpenAutoFocus}
      onCloseAutoFocus={handleCloseAutoFocus}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('misc:search.placeholder')}
        aria-label={t('misc:search.placeholder')}
      />
      {/* Mercury-style category chips under the input. */}
      <div
        role="tablist"
        aria-label={t('misc:search.filtersLabel')}
        className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2"
      >
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
              category === c.id
                ? 'border-malachite-600 bg-malachite-50 text-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300'
                : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <CommandList className="max-h-[min(60vh,420px)]">
        {searching ? (
          <div role="status" className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {t('misc:search.searching')}
          </div>
        ) : (
          <CommandEmpty>{t('misc:search.noResults')}</CommandEmpty>
        )}

        {showGroup('actions') && matchedActions.length > 0 && (
          <CommandGroup heading={t('misc:search.groupActions')}>
            {matchedActions.map((a) => {
              const Icon = a.icon;
              return (
                <CommandItem key={a.id} value={`action-${a.id}`} onSelect={() => runAction(a.id)}>
                  <Icon
                    className={cn('mr-2', a.tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}
                    aria-hidden
                  />
                  <span className="truncate">{a.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {showGroup('pages') && matchedPages.length > 0 && (
          <CommandGroup heading={t('misc:search.groupPages')}>
            {matchedPages.map((p) => {
              const Icon = p.icon;
              return (
                <CommandItem key={p.id} value={p.id} onSelect={() => go(p.path, p.state)}>
                  <Icon className="mr-2 text-muted-foreground" aria-hidden />
                  <span className="truncate">{p.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {showGroup('dorms') && dorms.length > 0 && (
          <CommandGroup heading={t('misc:search.groupDorms')}>
            {dorms.map((d) => (
              <CommandItem key={d.slug} value={`dorm-${d.slug}`} onSelect={() => go(`/housing/${d.slug}`)}>
                {safeImageSrc(d.image_url ?? '') ? (
                  <img
                    src={safeImageSrc(d.image_url ?? '') ?? undefined}
                    alt=""
                    className="mr-2 h-7 w-7 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <Building2 className="mr-2 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{d.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showGroup('marketplace') && listings.length > 0 && (
          <CommandGroup heading={t('misc:search.groupMarketplace')}>
            {listings.map((l) => (
              <CommandItem
                key={l.id}
                value={`listing-${l.id}`}
                onSelect={() => go('/marketplace', { openListingId: l.id })}
              >
                {safeImageSrc(l.image_urls?.[0] ?? '') ? (
                  <img
                    src={safeImageSrc(l.image_urls?.[0] ?? '') ?? undefined}
                    alt=""
                    className="mr-2 h-7 w-7 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <ShoppingBag className="mr-2 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{l.title}</span>
                {l.price != null && (
                  <span className="ml-auto pl-2 text-xs font-semibold text-muted-foreground">${l.price}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showGroup('checklist') && checklistItems.length > 0 && (
          <CommandGroup heading={t('misc:search.groupChecklist')}>
            {checklistItems.map((c) => (
              <CommandItem key={c.id} value={`checklist-${c.id}`} onSelect={() => go('/checklist')}>
                <CircleCheck
                  className={cn('mr-2', c.is_checked ? 'text-malachite-600' : 'text-muted-foreground')}
                  aria-hidden
                />
                <span className={cn('truncate', c.is_checked && 'text-muted-foreground line-through')}>
                  {c.item}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {/* Desktop-only key legend, from the shortcut registry. Absent on touch and
          native: a phone has none of these keys. */}
      {showKeyboardHints && (
        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground md:flex">
          <span className="inline-flex items-center gap-1.5">
            <ShortcutKeys id="paletteMove" />
            {t('misc:shortcuts.footer.move')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShortcutKeys id="paletteRun" />
            {t('misc:shortcuts.footer.run')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShortcutKeys id="paletteClose" />
            {t('misc:shortcuts.footer.close')}
          </span>
          {onShowShortcuts && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onShowShortcuts}
              className="ml-auto h-auto gap-1.5 px-1.5 py-0.5 text-xs font-semibold text-muted-foreground hover:bg-accent focus-visible:ring-malachite-600 focus-visible:ring-offset-0"
            >
              {t('misc:shortcuts.footer.all')}
              <ShortcutKeys id="showShortcuts" />
            </Button>
          )}
        </div>
      )}
    </CommandDialog>
  );
}
