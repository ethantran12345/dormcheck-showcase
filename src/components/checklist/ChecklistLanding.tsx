import React from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Users, CheckSquare, ShoppingCart } from "lucide-react";

/** Landing UI for unauthenticated users - no user-dependent hooks or queries. */
function ChecklistLanding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen w-full flex-col bg-gradient-to-b from-background to-muted">
      <div className="flex flex-1 flex-col items-center px-6 text-center">
        <div className="w-full max-w-2xl py-16">
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground">
            {t("checklist:landing.moveInChecklist")}
          </h1>
          <p className="mb-8 max-w-md mx-auto text-lg text-muted-foreground">
            {t("checklist:landing.description")}
          </p>
          {/* The Button `default` variant already carries the AA-safe brand fill:
              light `--primary` is malachite-800 (139 82% 24%) on white
              `--primary-foreground`, with its own dark-mode split. This used to
              inline-style raw #03C03C, which fails AA under white text and, as an
              inline style, was invisible to the class-string gates. Use the token. */}
          <Button
            size="lg"
            onClick={() => navigate("/auth")}
            className="rounded-full px-8 py-6 text-base font-bold shadow-raised"
          >
            {t("common:actions.signIn")}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-5xl mx-auto px-6 w-full pb-8">
          <div className="bg-muted border border-border rounded-xl p-6 text-left">
            <Users className="w-10 h-10 text-foreground mb-4" strokeWidth={1.5} />
            <h3 className="font-semibold text-foreground mb-2">{t("checklist:landing.inviteRoommates")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("checklist:landing.inviteRoommatesDesc")}
            </p>
          </div>
          <div className="bg-muted border border-border rounded-xl p-6 text-left">
            <CheckSquare className="w-10 h-10 text-foreground mb-4" strokeWidth={1.5} />
            <h3 className="font-semibold text-foreground mb-2">{t("checklist:landing.trackEssentials")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("checklist:landing.trackEssentialsDesc")}
            </p>
          </div>
          <div className="bg-muted border border-border rounded-xl p-6 text-left">
            <ShoppingCart className="w-10 h-10 text-foreground mb-4" strokeWidth={1.5} />
            <h3 className="font-semibold text-foreground mb-2">{t("checklist:landing.buyAndSell")}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("checklist:landing.buyAndSellDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export { ChecklistLanding };
