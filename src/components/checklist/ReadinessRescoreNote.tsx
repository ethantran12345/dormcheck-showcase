import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_PREFIX = "dc-readiness-rescore-dismissed-";

/**
 * ChecklistReadinessSummary is mounted TWICE at once (the mobile banner and the
 * desktop rail), so a purely local `dismissed` state leaves the other copy
 * showing a note the student just dismissed - visible the moment the viewport
 * crosses the breakpoint. These module-level listeners let one dismissal reach
 * every mounted instance without threading a provider through the checklist.
 */
const listeners = new Set<() => void>();

function notifyDismissed(): void {
  for (const listener of listeners) listener();
}

/**
 * One-time note explaining that the move-in readiness number was rescored on
 * 2026-08-03 (the first-night component no longer pays out its full weight when
 * a student has no night-one items - see computeChecklistReadiness).
 *
 * Two deliberate narrowings, both so this is a note and not an interruption:
 *
 * 1. It renders ONLY when `hasNightOne` is false. That is exactly the set of
 *    students whose number moved; for everyone else the score is unchanged and
 *    a notice about it would be noise about nothing.
 * 2. Dismissal is keyed by user id rather than a bare flag, so two students on
 *    one device do not dismiss each other's copy. It is still localStorage, so
 *    it does not follow a student across devices - a server-side flag would
 *    need a `profiles` column and a migration, which is more than a one-time
 *    note is worth. Worst case is seeing it once more on a second device.
 */
export function ReadinessRescoreNote({ hasNightOne }: { hasNightOne: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setDismissed(true);
      return;
    }
    const read = () => {
      try {
        setDismissed(localStorage.getItem(`${STORAGE_PREFIX}${user.id}`) === "true");
      } catch {
        // Private mode / quota: show the note rather than suppress it. It is one
        // line with a dismiss control, so the failure mode is mild either way.
        setDismissed(false);
      }
    };
    read();
    listeners.add(read);
    return () => {
      listeners.delete(read);
    };
  }, [user?.id]);

  if (hasNightOne || dismissed || !user?.id) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${user.id}`, "true");
    } catch {
      /* ignore quota / private mode */
    }
    notifyDismissed();
  };

  return (
    <div className="mt-3 flex items-start gap-2 rounded-control border border-border bg-muted px-3 py-2">
      <p className="flex-1 text-xs text-muted-foreground">
        {t("checklist:v2.readinessRescoreNote")}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label={t("checklist:v2.readinessRescoreDismiss")}
        // Glyph size belongs on the BUTTON's descendant group: Button's base
        // [&_svg]:size-4 is itself a descendant rule and would silently outrank
        // an h-3.5/w-3.5 written on the <X> (lint:glyphs G1).
        className="relative -mr-1 h-5 w-5 shrink-0 rounded-full before:absolute before:-inset-2 before:content-[''] hover:bg-transparent [&_svg]:size-3.5 [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
