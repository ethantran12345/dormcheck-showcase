import { Check, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { evaluatePassword, PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy';
import { cn } from '@/lib/utils';

interface PasswordRequirementsProps {
  /** The password being typed; rules tick as it changes. */
  password: string;
  /** Id so the password input can point here via aria-describedby. */
  id: string;
}

/**
 * Live checklist of the signup password rules. Each rule ticks green as it is
 * met. Kept legible for screen readers via the input's aria-describedby plus a
 * per-item sr-only status; no aria-live here so we don't announce on every
 * keystroke.
 */
export function PasswordRequirements({ password, id }: PasswordRequirementsProps) {
  const { t } = useTranslation();
  const rules = evaluatePassword(password);

  return (
    <ul id={id} aria-label={t('auth:passwordRules.ariaLabel')} className="mt-2 space-y-1">
      {rules.map((rule) => (
        <li key={rule.id} className="flex items-center gap-2 text-xs">
          {rule.met ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-malachite-600" strokeWidth={3} aria-hidden="true" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
          )}
          <span className={cn(rule.met ? 'text-foreground' : 'text-muted-foreground')}>
            {t(`auth:passwordRules.${rule.id}`, { min: PASSWORD_MIN_LENGTH })}
          </span>
          <span className="sr-only">{rule.met ? t('auth:passwordRules.met') : t('auth:passwordRules.notMet')}</span>
        </li>
      ))}
    </ul>
  );
}
