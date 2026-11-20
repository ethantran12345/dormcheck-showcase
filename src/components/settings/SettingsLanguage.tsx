import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/i18n/languages";
import { cn } from "@/lib/utils";

/**
 * Language segmented control for Settings > Appearance, mirroring
 * ThemeToggleGroup. Reference example of a translated surface: its own labels
 * come from i18n keys (settings.language.*). Only rendered when the
 * I18N_LANGUAGE_PICKER feature flag is on, so demo locales never reach students.
 */
export function SettingsLanguage({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();

  return (
    <div className={className}>
      <h3 className="text-sm font-bold text-foreground">{t("settings:language.title")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("settings:language.description")}</p>
      <div
        role="radiogroup"
        aria-label={t("settings:language.pickerAriaLabel")}
        className="mt-2 flex max-w-sm gap-1 rounded-lg bg-muted p-1"
      >
        {LANGUAGES.filter((lang) => lang.enabled).map(({ code, nativeLabel, label }) => {
          const selected = i18n.resolvedLanguage === code;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              lang={code}
              onClick={() => void i18n.changeLanguage(code)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600",
                selected
                  ? "bg-card text-foreground shadow-raised"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {nativeLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
