import React, { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardPaste, FileDown, Plus, Check, Link } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FULL_SCREEN_DIALOG_BODY_CLASS,
  FULL_SCREEN_DIALOG_CONTENT_CLASS,
  FULL_SCREEN_DIALOG_FOOTER_CLASS,
  FULL_SCREEN_DIALOG_HEADER_CLASS,
} from "@/lib/profileDialogClasses";
import { parseNotes } from "@/lib/parseChecklistNotes";

interface ImportNotesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionOrder: string[];
  addItem: (
    category: string,
    itemName: string,
    link?: string | null,
    iconName?: string | null,
    isChecked?: boolean
  ) => Promise<boolean>;
  addSection: (name: string) => Promise<void>;
}

export function ImportNotesModal({
  open,
  onOpenChange,
  sectionOrder,
  addItem,
  addSection,
}: ImportNotesModalProps) {
  const { t } = useTranslation();
  const [rawText, setRawText] = useState("");
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [itemSections, setItemSections] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [pendingNewSections, setPendingNewSections] = useState<string[]>([]);
  const newSectionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewSection) {
      newSectionInputRef.current?.focus();
    }
  }, [showNewSection]);

  const parsedItems = useMemo(() => parseNotes(rawText), [rawText]);

  const allSections = useMemo(() => {
    const all = [...sectionOrder];
    pendingNewSections.forEach((s) => {
      if (!all.includes(s)) all.push(s);
    });
    return all;
  }, [sectionOrder, pendingNewSections]);

  const getItemSection = (i: number) => itemSections[i] ?? selectedSection;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setRawText("");
      setSelectedSection("");
      setItemSections({});
      setShowNewSection(false);
      setNewSectionName("");
      setPendingNewSections([]);
    }
    onOpenChange(next);
  };

  const handleCreateSection = async () => {
    const trimmed = newSectionName.trim();
    if (!trimmed) return;
    setPendingNewSections((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed]
    );
    setSelectedSection(trimmed);
    setShowNewSection(false);
    setNewSectionName("");
    await addSection(trimmed);
  };

  const handleImport = async () => {
    if (parsedItems.length === 0) return;
    setImporting(true);
    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      const section = getItemSection(i);
      if (!section) continue;
      await addItem(section, item.name, item.link ?? null, null, item.checked);
    }
    setImporting(false);
    handleOpenChange(false);
  };

  const canImport =
    parsedItems.length > 0 &&
    !importing &&
    parsedItems.every((_, i) => Boolean(getItemSection(i)));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName="bg-black/60"
        className={cn(FULL_SCREEN_DIALOG_CONTENT_CLASS, "sm:!max-w-lg")}
      >
        <DialogHeader
          className={cn(
            FULL_SCREEN_DIALOG_HEADER_CLASS,
            "space-y-1.5 !px-6 !pb-4 !pt-[max(1.5rem,env(safe-area-inset-top))] text-center sm:!pt-6 sm:text-left",
          )}
        >
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-5 w-5 text-muted-foreground" />
            {t("checklist:import.title")}
          </DialogTitle>
          <DialogDescription>
            {t("checklist:import.description")}
          </DialogDescription>
        </DialogHeader>

        <div className={cn(FULL_SCREEN_DIALOG_BODY_CLASS, "space-y-4 !px-6 !py-0")}>
          {/* How-to hint */}
          <div className="space-y-0.5 rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-muted-foreground">{t("checklist:import.howToCopyLabel")}</p>
            <p><span className="font-medium text-foreground">Apple Notes</span> - {t("checklist:import.appleNotesSteps")}</p>
            <p><span className="font-medium text-foreground">Google Keep</span> - {t("checklist:import.googleKeepSteps")}</p>
            <p><span className="font-medium text-foreground">Notion</span> - {t("checklist:import.notionSteps")}</p>
          </div>

          {/* Paste area */}
          <div className="space-y-1.5">
            <label htmlFor="import-notes-text" className="text-sm font-medium text-foreground">{t("checklist:import.pasteHere")}</label>
            <Textarea
              id="import-notes-text"
              placeholder={"- Shower caddy\n- Twin XL sheets\n• Laptop stand\n1. Command hooks\n[ ] Extension cord"}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setItemSections({});
              }}
              className="h-32 resize-none overflow-y-auto font-mono text-sm focus-visible:ring-malachite-600"
            />
          </div>

          {/* Live preview - fixed-height panel, always mounted */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              {t("checklist:import.preview")}{" "}
              <span className="font-normal text-muted-foreground">
                ({t("checklist:import.itemsDetected", { count: parsedItems.length })})
              </span>
            </p>
            <div className="h-56 overflow-y-auto rounded-md border border-border">
              {parsedItems.length > 0 ? (
                <ul className="divide-y divide-border">
                  {parsedItems.map((item, i) => (
                    <li
                      key={i}
                      className="flex min-h-0 items-center gap-1.5 px-2 py-1.5 text-xs sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
                    >
                      {/* Checked state indicator */}
                      <span
                        className={cn(
                          "flex h-3 w-3 shrink-0 items-center justify-center rounded-full border sm:h-3.5 sm:w-3.5",
                          item.checked
                            ? "border-malachite-600 bg-malachite-600"
                            : "border-border"
                        )}
                      >
                        {item.checked && (
                          <Check className="h-1.5 w-1.5 stroke-[3] text-white sm:h-2 sm:w-2" />
                        )}
                      </span>

                      {/* Name + optional link badge */}
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {item.name}
                        {item.link && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground sm:ml-1.5">
                            <Link className="h-2.5 w-2.5 shrink-0" />
                            <span className="max-w-[60px] truncate sm:max-w-[80px]">{item.link.replace(/^https?:\/\//, "")}</span>
                          </span>
                        )}
                      </span>

                      {/* Per-item section selector - compact, truncated, opens upward */}
                      <Select
                        value={getItemSection(i)}
                        onValueChange={(v) =>
                          setItemSections((prev) => ({ ...prev, [i]: v }))
                        }
                      >
                        <SelectTrigger className="h-6 min-h-6 w-16 max-w-[4rem] shrink-0 px-1.5 text-[10px] focus:ring-malachite-600 sm:w-28 sm:max-w-none sm:px-2 sm:text-xs [&>span]:truncate">
                          <SelectValue placeholder="…" />
                        </SelectTrigger>
                        <SelectContent side="top" position="popper">
                          {allSections.map((section) => (
                            <SelectItem
                              key={section}
                              value={section}
                              className="py-1 text-[10px] sm:py-1.5 sm:text-xs"
                            >
                              {section}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              ) : rawText.trim() ? (
                <p className="p-3 text-sm italic text-muted-foreground">
                  {t("checklist:import.noItemsDetected")}
                </p>
              ) : (
                <p className="p-3 text-sm italic text-muted-foreground">
                  {t("checklist:import.itemsWillAppear")}
                </p>
              )}
            </div>
          </div>

          {/* Section selector */}
          <div className="space-y-1.5 pb-4">
            <label htmlFor="import-notes-section" className="text-sm font-medium text-foreground">{t("checklist:import.defaultSection")}</label>
            <Select value={selectedSection} onValueChange={setSelectedSection}>
              <SelectTrigger id="import-notes-section" className="focus:ring-malachite-600">
                <SelectValue placeholder="Choose a section…" />
              </SelectTrigger>
              <SelectContent>
                {allSections.map((section) => (
                  <SelectItem key={section} value={section}>
                    {section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Create new section inline */}
            {!showNewSection ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowNewSection(true)}
                // [&_svg]:size-3 keeps the 12px plus off the base [&_svg]:size-4.
                className="mt-1 flex h-auto items-center gap-1 rounded-none p-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
              >
                <Plus className="h-3 w-3" />
                {t("checklist:import.createNewSection")}
              </Button>
            ) : (
              <div className="mt-2 flex gap-2">
                <Input
                  ref={newSectionInputRef}
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder={t("checklist:import.newSectionNamePlaceholder")}
                  className="h-8 text-sm focus-visible:ring-malachite-600"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateSection();
                    if (e.key === "Escape") {
                      setShowNewSection(false);
                      setNewSectionName("");
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleCreateSection}
                  disabled={!newSectionName.trim()}
                  className="h-8 shrink-0 bg-foreground text-background hover:opacity-90"
                >
                  {t("checklist:actions.create")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNewSection(false);
                    setNewSectionName("");
                  }}
                  className="h-8 shrink-0"
                >
                  {t("common:actions.cancel")}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div
          className={cn(
            FULL_SCREEN_DIALOG_FOOTER_CLASS,
            "flex justify-end gap-2 border-t !px-6 !py-4",
          )}
        >
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={!canImport}
            onClick={handleImport}
            className="gap-1.5 bg-malachite-800 text-white hover:bg-malachite-800"
          >
            {importing ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("checklist:import.importing")}
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                {t("checklist:import.confirmImport")}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
