import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Ghost, Instagram, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { normalizeHandle } from '@/lib/socialHandles';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/ui/responsive-modal';

type Platform = 'instagram' | 'snapchat';

const PLATFORMS: { key: Platform; icon: typeof Instagram }[] = [
  { key: 'instagram', icon: Instagram },
  { key: 'snapchat', icon: Ghost },
];

interface ShareSocialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the composed message text; sending is the caller's job. */
  onPick: (text: string) => void;
}

/**
 * Share your own Instagram / Snapchat handle into a DM.
 *
 * The point of difference from the group-chat version: a handle you have not
 * set yet is editable RIGHT HERE. The group flow toasts "add it in your
 * profile first", which sends someone out of the conversation mid-sentence and
 * loses their place; here the same tap saves the handle to `profiles` and
 * shares it in one motion. Only ever your OWN handles — never anyone else's.
 */
export function ShareSocialDialog({ open, onOpenChange, onPick }: ShareSocialDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [handles, setHandles] = useState<Record<Platform, string>>({ instagram: '', snapchat: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [editing, setEditing] = useState<Platform | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const draftRef = useRef<HTMLInputElement>(null);

  // Focus management, not page-load autofocus: the field only exists because
  // the user just tapped to edit it, so moving focus there is the expected
  // continuation of their gesture (`autoFocus` would trip jsx-a11y for the
  // page-load case this is not).
  useEffect(() => {
    if (editing) draftRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    setIsLoading(true);
    setEditing(null);
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('instagram_username, snapchat_username')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setHandles({
        instagram: normalizeHandle((data?.instagram_username as string | null) ?? ''),
        snapchat: normalizeHandle((data?.snapchat_username as string | null) ?? ''),
      });
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  const share = (platform: Platform, handle: string) => {
    onPick(t(`messaging:social.message.${platform}`, { handle }));
    onOpenChange(false);
  };

  const startEditing = (platform: Platform) => {
    setEditing(platform);
    setDraft(handles[platform]);
  };

  // Save-and-share in one motion: the handle lands on the profile (so it is
  // there next time and on the roommate profile) and goes straight out.
  const saveAndShare = async (platform: Platform) => {
    const handle = normalizeHandle(draft);
    if (!handle || !user?.id) return;
    setSaving(true);
    // Written as a literal per platform, not a computed key: the generated
    // `profiles` update type rejects an index-signature object, and spelling
    // the columns out keeps this honest about which two it can touch.
    const patch =
      platform === 'instagram' ? { instagram_username: handle } : { snapchat_username: handle };
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    setSaving(false);
    if (error) {
      toast.error(t('messaging:social.saveFailed'));
      return;
    }
    setHandles((prev) => ({ ...prev, [platform]: handle }));
    setEditing(null);
    share(platform, handle);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent dialogClassName="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('messaging:social.title')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t('messaging:social.subtitle')}</ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            {t('messaging:social.loading')}
          </div>
        ) : (
          <ul className="space-y-1">
            {PLATFORMS.map(({ key, icon: Icon }) => {
              const handle = handles[key];
              const isEditing = editing === key;
              const platformName = t(`messaging:social.platform.${key}`);

              if (isEditing) {
                return (
                  <li key={key} className="rounded-card border border-border p-3">
                    <label htmlFor={`social-${key}`} className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {platformName}
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`social-${key}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={t('messaging:social.handlePlaceholder')}
                        ref={draftRef}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        onClick={() => { void saveAndShare(key); }}
                        disabled={!normalizeHandle(draft) || saving}
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden />
                        )}
                        <span className="ml-1.5">{t('messaging:social.saveAndShare')}</span>
                      </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t('messaging:social.savesToProfile')}
                    </p>
                  </li>
                );
              }

              return (
                <li key={key} className="flex items-center gap-2">
                  {/* `h-auto` clears Button's default h-10: this row is sized by
                      its 40px icon tile plus padding and carries two text lines. */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => (handle ? share(key, handle) : startEditing(key))}
                    className="flex h-auto min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{platformName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {handle ? `@${handle}` : t('messaging:social.notSet')}
                      </span>
                    </span>
                  </Button>
                  {handle && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => startEditing(key)}
                      aria-label={t('messaging:social.editHandle', { platform: platformName })}
                      className="h-auto w-auto shrink-0 rounded-control p-2 transition-colors hover:bg-accent [&_svg]:text-muted-foreground"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
