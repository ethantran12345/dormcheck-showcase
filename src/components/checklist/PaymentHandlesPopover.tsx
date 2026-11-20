import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from 'sonner';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2 } from "lucide-react";

type Props = {
  venmoUsername: string | null | undefined;
  zelleInfo: string | null | undefined;
  /** When set, refreshes settlement context for this group after save. */
  groupId?: string | null;
  /** Minimal trigger (e.g. link text). */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
};

export function PaymentHandlesPopover({
  venmoUsername,
  zelleInfo,
  groupId,
  children,
  align = "start",
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [venmo, setVenmo] = useState(venmoUsername?.trim() ?? "");
  const [zelle, setZelle] = useState(zelleInfo?.trim() ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setVenmo(venmoUsername?.trim() ?? "");
      setZelle(zelleInfo?.trim() ?? "");
    }
  }, [open, venmoUsername, zelleInfo]);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const v = venmo.trim() || null;
      const z = zelle.trim() || null;
      const { error } = await supabase
        .from("profiles")
        .update({ venmo_username: v, zelle_info: z })
        .eq("id", user.id);
      if (error) throw error;
      await queryClient.invalidateQueries({
        queryKey: groupId
          ? ["checklist-settlement-context", groupId]
          : ["checklist-settlement-context"],
      });
      toast.success(t("checklist:payment.saved"));
      setOpen(false);
    } catch (e: unknown) {
      toast.error('Could not save', {
        description: e instanceof Error ? e.message : 'Try again',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-3" align={align} sideOffset={6}>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("checklist:payment.description")}
        </p>
        <div className="space-y-2">
          <div>
            <Label htmlFor="quick-venmo" className="text-xs">
              {t("checklist:payment.venmoLabel")}
            </Label>
            <Input
              id="quick-venmo"
              value={venmo}
              onChange={(e) => setVenmo(e.target.value)}
              placeholder={t("checklist:payment.venmoPlaceholder")}
              className="mt-1 h-8 text-sm"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="quick-zelle" className="text-xs">
              {t("checklist:payment.zelleLabel")}
            </Label>
            <Input
              id="quick-zelle"
              value={zelle}
              onChange={(e) => setZelle(e.target.value)}
              placeholder={t("checklist:payment.zellePlaceholder")}
              className="mt-1 h-8 text-sm"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 bg-malachite-800 text-white hover:bg-malachite-900"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common:actions.save")}
          </Button>
          <Link
            to="/profile/edit"
            className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setOpen(false)}
          >
            {t("checklist:payment.openProfile")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
