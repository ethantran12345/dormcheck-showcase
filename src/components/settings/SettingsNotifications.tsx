import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  BellOff,
  ShieldCheck,
  Mail,
  Smartphone,
  MessageSquare,
  UserPlus,
  Megaphone,
  Users,
  ListOrdered,
  Home,
  ShoppingBag,
  Truck,
  ChevronDown,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  type NotificationCategory,
  type NotificationPrefs,
} from '@/lib/notificationPrefs';
import {
  PROFILE_ROW_ICON_CHIP_CLASS,
  PROFILE_ROW_ICON_CLASS,
} from '@/lib/profileDialogClasses';
import { SettingsSectionHeader } from '@/components/settings/SettingsSectionShell';

type Channel = 'email' | 'push';

// Presentation-only metadata layered over the canonical category list
// (NOTIFICATION_CATEGORIES stays the source of truth - src/test/notificationPrefs.test.ts
// asserts it matches the server list). Icons + the important/general split + the push-only
// set are all display concerns; the data model (notification_prefs JSON) is untouched.
const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  messages: MessageSquare,
  message_requests: UserPlus,
  roommate_invites: Users,
  ranking_invites: ListOrdered,
  housing_groups: Home,
  marketplace: ShoppingBag,
  movein: Truck,
  announcements: Megaphone,
};

// Categories with no email path today - only the Push channel is real for these.
const PUSH_ONLY = new Set<NotificationCategory>(['movein', 'announcements']);

// Mercury pattern: a small set of high-signal categories surface as cards up top;
// everything else lists below. Order within each list is intentional.
const IMPORTANT: NotificationCategory[] = ['messages', 'message_requests', 'announcements'];
const GENERAL: NotificationCategory[] = [
  'roommate_invites',
  'ranking_invites',
  'housing_groups',
  'marketplace',
  'movein',
];

interface NotificationSettingsRow {
  email_notifications: boolean;
  notification_prefs: NotificationPrefs | null;
}

// Quiet hours (R7). Columns are added by a staged migration and are newer than the
// generated Supabase types, so this row is cast at the query boundary (like R4's
// login_alerts). DEFAULT_QUIET_* seed the window the first time a user enables it.
interface QuietHoursRow {
  quiet_hours_enabled: boolean | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
}
const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '08:00';

const SECTION_LABEL_CLASS =
  'px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

export function SettingsNotifications() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  // Which category's inline channel editor is expanded (drill-in). One at a time.
  const [expanded, setExpanded] = useState<NotificationCategory | null>(null);

  // Push-permission truthfulness (P1.9): on native, the OS permission is the
  // real gate - if iOS has push denied, the matrix toggles are theater. Show
  // the actual state and point at iOS Settings (no deep-link plugin yet).
  const [osPushDenied, setOsPushDenied] = useState(false);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.checkPermissions();
        setOsPushDenied(perm.receive === 'denied');
      } catch {
        /* plugin unavailable (web build) - stay silent */
      }
    })();
  }, []);

  const queryKey = useMemo(() => ['notification_settings', user?.id], [user?.id]);
  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!user?.id) return null;
      const { data: row } = await supabase
        .from('profiles')
        .select('email_notifications, notification_prefs')
        .eq('id', user.id)
        .maybeSingle();
      return (row as NotificationSettingsRow | null) ?? null;
    },
    enabled: !!user?.id,
  });

  const masterEmail = data?.email_notifications !== false;
  const prefs: NotificationPrefs = useMemo(() => data?.notification_prefs ?? {}, [data?.notification_prefs]);

  // Quiet hours (R7): push-only Do Not Disturb. Fetched in its own query so it can
  // fail SOFT - the columns are added by a staged migration, so on a project that
  // hasn't applied it yet the select 42703s; we swallow that and hide the control
  // rather than breaking the whole Notifications page. Suppression itself runs
  // server-side in the send-push edge function using the stored IANA timezone.
  const deviceTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  const quietKey = useMemo(() => ['quiet_hours', user?.id], [user?.id]);
  const { data: quiet } = useQuery({
    queryKey: quietKey,
    queryFn: async () => {
      if (!user?.id) return null;
      const { data: row, error } = await supabase
        .from('profiles')
        .select('quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone')
        .eq('id', user.id)
        .maybeSingle();
      // Columns not deployed yet (staged migration) -> mark unsupported, hide the UI.
      if (error) return { unsupported: true } as const;
      return (row as unknown as QuietHoursRow | null) ?? ({} as QuietHoursRow);
    },
    enabled: !!user?.id,
  });

  const quietSupported = !!quiet && !('unsupported' in quiet);
  const quietRow = quietSupported ? (quiet as QuietHoursRow) : null;
  const quietEnabled = quietRow?.quiet_hours_enabled === true;
  const quietStart = quietRow?.quiet_hours_start ?? DEFAULT_QUIET_START;
  const quietEnd = quietRow?.quiet_hours_end ?? DEFAULT_QUIET_END;
  const quietTz = quietRow?.quiet_hours_timezone ?? deviceTz;

  const saveQuiet = useCallback(
    async (patch: Partial<QuietHoursRow>) => {
      if (!user?.id || saving) return;
      setSaving(true);
      try {
        const { error } = await supabase
          .from('profiles')
          .update(patch as never)
          .eq('id', user.id);
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: quietKey });
        toast.success(t('common:state.saved'), { description: t('settings:notifications.quietHours.savedDescription') });
      } catch {
        toast.error(t('settings:notifications.couldNotSave'), { description: t('common:toast.genericError') });
      } finally {
        setSaving(false);
      }
    },
    [user?.id, saving, queryClient, quietKey, t],
  );

  const handleQuietToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        // Seed the window + timezone on first enable so suppression has real values.
        void saveQuiet({
          quiet_hours_enabled: true,
          quiet_hours_start: quietRow?.quiet_hours_start ?? DEFAULT_QUIET_START,
          quiet_hours_end: quietRow?.quiet_hours_end ?? DEFAULT_QUIET_END,
          quiet_hours_timezone: quietRow?.quiet_hours_timezone ?? deviceTz,
        });
      } else {
        void saveQuiet({ quiet_hours_enabled: false });
      }
    },
    [saveQuiet, quietRow, deviceTz],
  );

  const isEnabled = useCallback(
    (channel: Channel, category: NotificationCategory) => prefs[channel]?.[category] !== false,
    [prefs],
  );

  const handleMasterChange = useCallback(
    async (checked: boolean) => {
      if (!user?.id || saving) return;
      setSaving(true);
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ email_notifications: checked })
          .eq('id', user.id);
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey });
        toast.success(t('common:state.saved'), { description: t('settings:notifications.preferenceSaved') });
      } catch {
        toast.error(t('settings:notifications.couldNotSave'), { description: t('common:toast.genericError') });
      } finally {
        setSaving(false);
      }
    },
    [user?.id, saving, queryClient, queryKey, t],
  );

  const handleCategoryChange = useCallback(
    async (channel: Channel, category: NotificationCategory, checked: boolean) => {
      if (!user?.id || saving) return;
      setSaving(true);
      const next: NotificationPrefs = {
        ...prefs,
        [channel]: { ...(prefs[channel] ?? {}), [category]: checked },
      };
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ notification_prefs: next as unknown as Json })
          .eq('id', user.id);
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey });
        toast.success(t('common:state.saved'), { description: t('settings:notifications.preferenceSaved') });
      } catch {
        toast.error(t('settings:notifications.couldNotSave'), { description: t('common:toast.genericError') });
      } finally {
        setSaving(false);
      }
    },
    [user?.id, saving, prefs, queryClient, queryKey, t],
  );

  // At-a-glance channel status for a category, honoring the master email switch
  // and push-only categories. Renders "Off" when nothing will be delivered.
  const renderChips = useCallback(
    (category: NotificationCategory) => {
      const pushOnly = PUSH_ONLY.has(category);
      const emailOn = !pushOnly && masterEmail && isEnabled('email', category);
      const pushOn = isEnabled('push', category);
      if (!emailOn && !pushOn) {
        return (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t('settings:notifications.channelStatus.off')}
          </span>
        );
      }
      return (
        <div className="flex items-center gap-1.5">
          {emailOn && (
            <span className="inline-flex items-center gap-1 rounded-full bg-malachite-600/10 px-2 py-0.5 text-[11px] font-medium text-malachite-800">
              <Mail className="h-3 w-3" aria-hidden />
              {t('settings:notifications.channels.email')}
            </span>
          )}
          {pushOn && (
            <span className="inline-flex items-center gap-1 rounded-full bg-malachite-600/10 px-2 py-0.5 text-[11px] font-medium text-malachite-800">
              <Smartphone className="h-3 w-3" aria-hidden />
              {t('settings:notifications.channels.push')}
            </span>
          )}
        </div>
      );
    },
    [masterEmail, isEnabled, t],
  );

  // The drill-in editor: the real Email/Push switches for one category, shown
  // inline below its card/row instead of a full matrix of every switch.
  const renderEditor = useCallback(
    (category: NotificationCategory) => {
      const categoryLabel = t(`settings:notifications.categories.${category}.label`);
      const pushOnly = PUSH_ONLY.has(category);
      return (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-muted/30 animate-fade-in">
          {!pushOnly && (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight text-foreground">{t('settings:notifications.channels.email')}</p>
                  {!masterEmail && (
                    <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                      {t('settings:notifications.emailDisabledHint')}
                    </p>
                  )}
                </div>
              </div>
              <Switch
                aria-label={t('settings:notifications.emailNotificationsForCategory', { category: categoryLabel })}
                checked={isEnabled('email', category)}
                onCheckedChange={(checked) => handleCategoryChange('email', category, checked)}
                disabled={saving || !masterEmail}
                className="shrink-0 data-[state=checked]:bg-malachite-600"
              />
            </div>
          )}
          <div
            className={cn(
              'flex items-center justify-between gap-3 px-3 py-2.5',
              !pushOnly && 'border-t border-border',
            )}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium leading-tight text-foreground">{t('settings:notifications.channels.push')}</p>
            </div>
            <Switch
              aria-label={t('settings:notifications.pushNotificationsForCategory', { category: categoryLabel })}
              checked={isEnabled('push', category)}
              onCheckedChange={(checked) => handleCategoryChange('push', category, checked)}
              disabled={saving}
              className="shrink-0 data-[state=checked]:bg-malachite-600"
            />
          </div>
        </div>
      );
    },
    [masterEmail, isEnabled, handleCategoryChange, saving, t],
  );

  const toggleExpanded = useCallback((category: NotificationCategory) => {
    setExpanded((cur) => (cur === category ? null : category));
  }, []);

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        icon={Bell}
        title={t('settings:notifications.title')}
        description={t('settings:notifications.description')}
      />

      <div className="space-y-6">
        {osPushDenied && (
          <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 px-3 py-3">
            <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-xs leading-snug text-amber-900">
              {t('settings:notifications.pushDeniedWarning')}
            </p>
          </div>
        )}

        {/* Master email kill-switch */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card shadow-raised p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
              <Bell className={PROFILE_ROW_ICON_CLASS} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight text-foreground">{t('settings:notifications.email.title')}</p>
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                {t('settings:notifications.email.description')}
              </p>
            </div>
          </div>
          <Switch
            aria-label={t('settings:notifications.email.title')}
            checked={masterEmail}
            onCheckedChange={handleMasterChange}
            disabled={saving}
            className="shrink-0 data-[state=checked]:bg-malachite-600"
          />
        </div>

        {/* Important updates - high-signal categories as cards */}
        <div>
          <p className={SECTION_LABEL_CLASS}>{t('settings:notifications.important.title')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {IMPORTANT.map((category) => {
              const categoryLabel = t(`settings:notifications.categories.${category}.label`);
              const categoryDescription = t(`settings:notifications.categories.${category}.description`);
              const Icon = CATEGORY_ICON[category];
              const isOpen = expanded === category;
              return (
                <div key={category} className="rounded-2xl border border-border/50 bg-card shadow-raised p-4">
                  <div className="flex items-start gap-3">
                    <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                      <Icon className={PROFILE_ROW_ICON_CLASS} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight text-foreground">{categoryLabel}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {categoryDescription}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {renderChips(category)}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(category)}
                      aria-expanded={isOpen}
                      aria-label={t('settings:notifications.editChannels', { action: isOpen ? t('common:actions.done') : t('common:actions.edit'), category: categoryLabel })}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-malachite-800 transition-colors hover:bg-malachite-600/10"
                    >
                      {isOpen ? t('common:actions.done') : t('common:actions.edit')}
                      <ChevronDown
                        className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')}
                        aria-hidden
                      />
                    </button>
                  </div>
                  {isOpen && renderEditor(category)}
                </div>
              );
            })}
          </div>
        </div>

        {/* General updates - remaining categories as a divided list */}
        <div>
          <p className={SECTION_LABEL_CLASS}>{t('settings:notifications.general.title')}</p>
          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-raised">
            <div className="divide-y divide-border">
              {GENERAL.map((category) => {
                const categoryLabel = t(`settings:notifications.categories.${category}.label`);
                const categoryDescription = t(`settings:notifications.categories.${category}.description`);
                const Icon = CATEGORY_ICON[category];
                const isOpen = expanded === category;
                return (
                  <div key={category}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(category)}
                      aria-expanded={isOpen}
                      aria-label={t('settings:notifications.editChannels', { action: isOpen ? t('common:actions.done') : t('common:actions.edit'), category: categoryLabel })}
                      className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary/50"
                    >
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        <Icon className={PROFILE_ROW_ICON_CLASS} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight text-foreground">{categoryLabel}</p>
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                          {categoryDescription}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {renderChips(category)}
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform',
                            isOpen && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      </div>
                    </button>
                    {isOpen && <div className="px-4 pb-4">{renderEditor(category)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Quiet hours - push-only Do Not Disturb */}
        {quietSupported && (
          <div className="rounded-2xl border border-border/50 bg-card shadow-raised p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                  <Moon className={PROFILE_ROW_ICON_CLASS} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight text-foreground">{t('settings:notifications.quietHours.title')}</p>
                  <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                    {t('settings:notifications.quietHours.description')}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={t('settings:notifications.quietHours.title')}
                checked={quietEnabled}
                onCheckedChange={handleQuietToggle}
                disabled={saving}
                className="shrink-0 data-[state=checked]:bg-malachite-600"
              />
            </div>

            {quietEnabled && (
              <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3 animate-fade-in">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="quiet-hours-start"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      {t('settings:notifications.quietHours.from')}
                    </label>
                    <input
                      id="quiet-hours-start"
                      type="time"
                      value={quietStart}
                      disabled={saving}
                      onChange={(e) => {
                        if (e.target.value) void saveQuiet({ quiet_hours_start: e.target.value });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-malachite-600 disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="quiet-hours-end"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      {t('settings:notifications.quietHours.to')}
                    </label>
                    <input
                      id="quiet-hours-end"
                      type="time"
                      value={quietEnd}
                      disabled={saving}
                      onChange={(e) => {
                        if (e.target.value) void saveQuiet({ quiet_hours_end: e.target.value });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-malachite-600 disabled:opacity-60"
                    />
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {quietStart === quietEnd
                    ? t('settings:notifications.quietHours.setTimeHint')
                    : quietStart < quietEnd
                      ? t('settings:notifications.quietHours.silencedMessage', { start: quietStart, end: quietEnd })
                      : t('settings:notifications.quietHours.silencedOvernightMessage', { start: quietStart, end: quietEnd })}{' '}
                  {t('settings:notifications.quietHours.timezone', { tz: quietTz })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Always-on security emails */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card shadow-raised p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
              <ShieldCheck className={PROFILE_ROW_ICON_CLASS} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight text-foreground">{t('settings:notifications.securityAccount.title')}</p>
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                {t('settings:notifications.securityAccount.description')}
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {t('settings:notifications.alwaysOn')}
          </span>
        </div>
      </div>
    </div>
  );
}
