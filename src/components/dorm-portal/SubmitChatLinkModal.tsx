import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHAT_PLATFORMS,
  PLATFORM_CONFIG,
  isValidPlatformUrl,
  type ChatPlatform,
} from '@/lib/chatPlatforms';
import { useSubmitChatLink } from '@/hooks/useBuildingChatLinks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubmitChatLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: number;
  residenceHallName: string;
  /** Pre-fill a floor (used if user is submitting from a per-floor
   *  context - optional) */
  initialFloor?: string;
  onSubmitted?: (linkId: string) => void;
}

export function SubmitChatLinkModal({
  open,
  onOpenChange,
  buildingId,
  residenceHallName,
  initialFloor,
  onSubmitted,
}: SubmitChatLinkModalProps) {
  const { t } = useTranslation();
  const submitMutation = useSubmitChatLink();

  const [platform, setPlatform] = useState<ChatPlatform>('snapchat');
  const [url, setUrl] = useState('');
  const [floor, setFloor] = useState(initialFloor ?? '');
  const [label, setLabel] = useState('');

  // Reset on close
  useEffect(() => {
    if (!open) {
      setPlatform('snapchat');
      setUrl('');
      setFloor(initialFloor ?? '');
      setLabel('');
    }
  }, [open, initialFloor]);

  const platformConfig = PLATFORM_CONFIG[platform];

  // Validate URL whenever it or platform changes
  const urlValidation = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) return { isValid: false, isEmpty: true };
    return {
      isValid: isValidPlatformUrl(trimmed, platform),
      isEmpty: false,
    };
  }, [url, platform]);

  const canSubmit =
    !urlValidation.isEmpty &&
    urlValidation.isValid &&
    label.trim().length <= 60 &&
    floor.trim().length <= 20 &&
    !submitMutation.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      const linkId = await submitMutation.mutateAsync({
        buildingId,
        platform,
        url: url.trim(),
        floor: floor.trim() || null,
        label: label.trim() || null,
      });
      toast.success(t('housing:portal.submitChatLink.linkAdded', { platform: platformConfig.label }));
      onSubmitted?.(linkId);
      onOpenChange(false);
    } catch (e) {
      toast.error(t('housing:portal.submitChatLink.addError'), {
        description: (e as Error).message,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('housing:portal.submitChatLink.heading')}</DialogTitle>
          <DialogDescription>
            {t('housing:portal.submitChatLink.description', { building: residenceHallName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Platform picker */}
          <div>
            <p id="chat-platform-label" className="block text-sm font-medium text-foreground mb-2">
              {t('housing:portal.submitChatLink.platformLabel')}
            </p>
            <div role="group" aria-labelledby="chat-platform-label" className="grid grid-cols-3 gap-2">
              {CHAT_PLATFORMS.map((p) => {
                const config = PLATFORM_CONFIG[p];
                const Icon = config.icon;
                const isSelected = platform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:border-border',
                    )}
                    aria-pressed={isSelected}
                  >
                    <Icon className={cn('h-5 w-5', config.iconClass)} />
                    <span className="text-xs font-medium text-foreground">{config.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* URL */}
          <div>
            <label htmlFor="chat-url" className="block text-sm font-medium text-foreground mb-1.5">
              {t('housing:portal.submitChatLink.inviteLinkLabel')} <span className="text-red-500">*</span>
            </label>
            <Input
              id="chat-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={platformConfig.example}
              className={cn(
                !urlValidation.isEmpty && !urlValidation.isValid && 'border-red-300 focus-visible:ring-red-300',
              )}
              autoComplete="off"
              inputMode="url"
            />
            <p className="text-xs text-muted-foreground mt-1">{platformConfig.hint}</p>
            {!urlValidation.isEmpty && !urlValidation.isValid && (
              <p className="text-xs text-red-600 mt-1">
                {t('housing:portal.submitChatLink.invalidUrlError', { platform: platformConfig.label, example: platformConfig.example })}
              </p>
            )}
          </div>

          {/* Floor (optional) */}
          <div>
            <label htmlFor="chat-floor" className="block text-sm font-medium text-foreground mb-1.5">
              {t('housing:portal.submitChatLink.floorLabel')} <span className="text-muted-foreground font-normal">{t('common:state.optional')}</span>
            </label>
            <Input
              id="chat-floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder={t('housing:portal.submitChatLink.floorPlaceholder')}
              maxLength={20}
            />
            <p className="text-xs text-muted-foreground mt-1">{t('housing:portal.submitChatLink.floorHint')}</p>
          </div>

          {/* Label (optional) */}
          <div>
            <label htmlFor="chat-label" className="block text-sm font-medium text-foreground mb-1.5">
              {t('housing:portal.submitChatLink.labelLabel')} <span className="text-muted-foreground font-normal">{t('common:state.optional')}</span>
            </label>
            <Input
              id="chat-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('housing:portal.submitChatLink.labelPlaceholder')}
              maxLength={60}
            />
            <p className="text-xs text-muted-foreground mt-1">{label.length}/60</p>
          </div>

          {/* Privacy note */}
          <div className="rounded-md bg-muted border border-border p-3 text-xs text-muted-foreground">
            {t('housing:portal.submitChatLink.privacyNote', { platform: platformConfig.label })}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitMutation.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('housing:portal.submitChatLink.adding')}
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4 mr-2" />
                {t('housing:portal.submitChatLink.addLink')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
