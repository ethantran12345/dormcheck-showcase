import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  PROFILE_ROW_ICON_CHIP_CLASS,
  PROFILE_ROW_ICON_CLASS,
} from '@/lib/profileDialogClasses';

type MessagePrivacy = 'anyone' | 'connections';

/**
 * P1.9 privacy controls (migration 20260712180000): who can open a new
 * conversation with you, and whether you appear in user search. Both enforced
 * server-side (conversations INSERT policy + search_users RPC) - this UI just
 * writes the prefs.
 */
export function SettingsPrivacyControls() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const messagePrivacyOptions: { value: MessagePrivacy; label: string; description: string }[] = [
    {
      value: 'anyone',
      label: t('settings:privacy.messaging.options.anyone'),
      description: t('settings:privacy.messaging.optionsDescriptions.anyone'),
    },
    {
      value: 'connections',
      label: t('settings:privacy.messaging.options.connections'),
      description: t('settings:privacy.messaging.optionsDescriptions.connections'),
    },
  ];

  const queryKey = useMemo(() => ['privacy_prefs', user?.id], [user?.id]);
  const { data } = useQuery({
    queryKey,
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('profiles')
        .select('message_privacy, discoverable' as '*')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return row as unknown as { message_privacy: MessagePrivacy; discoverable: boolean } | null;
    },
  });

  const messagePrivacy: MessagePrivacy = data?.message_privacy === 'connections' ? 'connections' : 'anyone';
  const discoverable = data?.discoverable !== false;

  const save = useCallback(
    async (patch: { message_privacy?: MessagePrivacy; discoverable?: boolean }) => {
      if (!user?.id || saving) return;
      setSaving(true);
      try {
        const { error } = await supabase.from('profiles').update(patch as never).eq('id', user.id);
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey });
        toast.success(t('common:state.saved'), { description: t('settings:privacy.saveSuccess') });
      } catch {
        toast.error(t('settings:privacy.saveError'), { description: t('common:toast.genericError') });
      } finally {
        setSaving(false);
      }
    },
    [user?.id, saving, queryClient, queryKey, t],
  );

  return (
    <>
      {/* Who can message you */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
            <MessageCircle className={PROFILE_ROW_ICON_CLASS} />
          </div>
          <div>
            <p className="font-medium text-sm leading-tight text-foreground">{t('settings:privacy.messaging.title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
              {t('settings:privacy.messaging.description')}
            </p>
          </div>
        </div>
        <div role="radiogroup" aria-label={t('settings:privacy.messaging.title')} className="space-y-2">
          {messagePrivacyOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={messagePrivacy === opt.value}
              disabled={saving}
              onClick={() => messagePrivacy !== opt.value && void save({ message_privacy: opt.value })}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
                messagePrivacy === opt.value
                  ? 'border-malachite-600 bg-malachite-600/10'
                  : 'border-border hover:bg-secondary/50',
              )}
            >
              <p className="text-sm font-medium text-foreground">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Discoverability */}
      <div className="w-full flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
            <Search className={PROFILE_ROW_ICON_CLASS} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm leading-tight text-foreground">{t('settings:privacy.searchVisibility.title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
              {t('settings:privacy.searchVisibility.description')}
            </p>
          </div>
        </div>
        <Switch
          aria-label={t('settings:privacy.searchVisibility.title')}
          checked={discoverable}
          onCheckedChange={(checked) => void save({ discoverable: checked })}
          disabled={saving}
          className="shrink-0 data-[state=checked]:bg-malachite-600"
        />
      </div>
    </>
  );
}
