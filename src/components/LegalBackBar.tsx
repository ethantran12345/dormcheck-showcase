import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { PageContainer } from "@/components/ui/page-container";

/**
 * Native-only back bar for the legal pages (`/privacy`, `/terms`).
 *
 * On desktop/mobile web the legal pages rely on `GlobalTopNav` for navigation,
 * so this renders nothing there (the marketing visual cleanup stays intact). On
 * the native shell those pages mount bare - no `NativeTopBar` (hidden when
 * signed out), no `BottomNav` (hidden when native + signed out) - so without
 * this they are a dead-end. Apple requires the legal pages reachable in-app
 * even signed out, so the way *out* has to live on the page itself.
 *
 * Tapping back prefers in-app history; if the page was the entry point (deep
 * link, or iOS restoring the WebView onto it after the app was backgrounded) it
 * falls back to a safe route so it is never a dead-end.
 */
export function LegalBackBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!Capacitor.isNativePlatform()) return null;

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(user ? "/my-home" : "/auth", { replace: true });
  };

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-md pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))]">
      <PageContainer width="prose" className="px-3 pb-2">
        <Button
          variant="ghost"
          onClick={handleBack}
          aria-label={t("common:actions.back")}
          className="min-h-[44px] gap-2 text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("common:actions.back")}
        </Button>
      </PageContainer>
    </div>
  );
}
