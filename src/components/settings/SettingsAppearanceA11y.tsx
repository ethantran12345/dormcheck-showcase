import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { useAccessibility } from '@/contexts/AccessibilityContext';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import {
  PROFILE_ROW_ICON_CHIP_CLASS,
  PROFILE_ROW_ICON_CLASS,
} from '@/lib/profileDialogClasses';
import type { TextSize } from '@/lib/accessibility';
import { SettingsCardGroup } from './SettingsSectionShell';

const TEXT_SIZE_OPTIONS: Array<{ value: TextSize; label: string; labelKey: string; sampleClass: string }> = [
  { value: 'default', label: 'Default', labelKey: 'settings:appearance.textSize.optionDefault', sampleClass: 'text-sm' },
  { value: 'large', label: 'Large', labelKey: 'settings:appearance.textSize.optionLarge', sampleClass: 'text-base' },
  { value: 'larger', label: 'Larger', labelKey: 'settings:appearance.textSize.optionLarger', sampleClass: 'text-lg' },
];

/**
 * Accessibility group under Appearance (Settings R5). Every control here changes
 * real app behavior:
 *   - Reduce motion → sets .reduce-motion/.motion-safe-override on <html> and drives
 *     framer-motion's MotionConfig (defaults to the OS value until toggled).
 *   - Text size → scales the root font-size so rem-based sizing follows app-wide.
 * High contrast is intentionally NOT shipped here — a genuine implementation needs a
 * full parallel high-contrast token palette, which is out of scope for R5. See the
 * TODO in CHANGELOG; no dead toggle is rendered.
 */
export function SettingsAppearanceA11y() {
  const { t } = useTranslation();
  const { reduceMotionResolved, setReduceMotion, textSize, setTextSize } = useAccessibility();

  return (
    <SettingsCardGroup label="Accessibility">
      {/* Reduce motion */}
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
            <Sparkles className={PROFILE_ROW_ICON_CLASS} aria-hidden />
          </div>
          <div className="min-w-0">
            <label htmlFor="reduce-motion-switch" className="text-sm font-semibold text-foreground">
              {t('settings:appearance.reduceMotion.title')}
            </label>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {t('settings:appearance.reduceMotion.description')}
            </p>
          </div>
        </div>
        <Switch
          id="reduce-motion-switch"
          checked={reduceMotionResolved}
          aria-label={t('settings:appearance.reduceMotion.title')}
          onCheckedChange={(checked) => {
            haptic.selection();
            setReduceMotion(checked ? 'on' : 'off');
          }}
        />
      </div>

      {/* Text size */}
      <div className="p-4">
        <p className="text-sm font-semibold text-foreground">{t('settings:appearance.textSize.title')}</p>
        <p className="mb-3 mt-0.5 text-xs leading-snug text-muted-foreground">
          {t('settings:appearance.textSize.description')}
        </p>
        <div
          role="radiogroup"
          aria-label={t('settings:appearance.textSize.title')}
          className="flex max-w-sm gap-1 rounded-lg bg-muted p-1"
        >
          {TEXT_SIZE_OPTIONS.map(({ value, labelKey, sampleClass }) => {
            const selected = textSize === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t('settings:appearance.textSize.optionLabel', { label: t(labelKey) })}
                onClick={() => {
                  haptic.selection();
                  setTextSize(value);
                }}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
                  selected
                    ? 'bg-card text-foreground shadow-raised'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className={cn('leading-none', sampleClass)} aria-hidden>
                  A
                </span>
                <span className="text-xs">{t(labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </SettingsCardGroup>
  );
}
