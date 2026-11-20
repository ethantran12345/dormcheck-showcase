import { toast } from "sonner";
import type { ChecklistItem } from "@/types";
import { isIOS, deliverPdfForIOS } from "@/components/checklist/checklistPdf";
import { STANDARD_CATEGORIES, type GroupMember } from "@/components/checklist/checklistTypes";

/**
 * "Export PDF" from the checklist actions menu. Lifted verbatim out of
 * ChecklistPage during the §5b split - the page held ~230 lines of jsPDF layout
 * that had nothing to do with rendering a checklist. Behaviour is unchanged:
 * same layout, same fillable-checkbox pass, same iOS/mobile/desktop delivery.
 *
 * `t` is passed in rather than imported so the caller's i18n instance (and its
 * loaded namespaces) is the one used, exactly as before.
 */
export interface ExportChecklistPdfOptions {
  t: (key: string, vars?: Record<string, unknown>) => string;
  isMobile: boolean;
  categorizedItems: Record<string, ChecklistItem[]>;
  groupMembers: GroupMember[];
  currentUserId: string | undefined;
  totalEstimatedCost: number;
  myShare: number;
  isGroupContext: boolean;
  selectedGroupDisplayName: string | null;
}

export async function exportChecklistPdf({
  t,
  isMobile,
  categorizedItems,
  groupMembers,
  currentUserId,
  totalEstimatedCost,
  myShare,
  isGroupContext,
  selectedGroupDisplayName,
}: ExportChecklistPdfOptions): Promise<void> {
  const ios = isIOS();
  const pdfWindow = isMobile && !ios ? window.open("", "_blank") : null;
  // Load the PDF libs on demand so ~350-400KB stays out of the eager bundle
  // (matches the dynamic pdf-lib import below).
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF();
  const BRAND: [number, number, number] = [3, 192, 60];
  const LIGHT_BRAND: [number, number, number] = [217, 237, 233];
  let y: number;

  const loadImage = (url: string): Promise<{ data: string; w: number; h: number }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")?.drawImage(img, 0, 0);
        resolve({
          data: c.toDataURL("image/png"),
          w: img.naturalWidth,
          h: img.naturalHeight,
        });
      };
      img.onerror = reject;
      img.src = url;
    });

  try {
    const logo = await loadImage("/dormcheck-logo-new.png");
    const logoW = 40;
    const logoH = logoW * (logo.h / logo.w);
    doc.addImage(logo.data, "PNG", 14, 10, logoW, logoH);
    y = 10 + logoH + 6;
  } catch {
    y = 22;
  }

  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text(t('checklist:page.dormEssentialsChecklist'), 14, y);
  y += 8;

  const orderedCats = [
    ...STANDARD_CATEGORIES,
    ...Object.keys(categorizedItems).filter((c) => !(STANDARD_CATEGORIES as readonly string[]).includes(c)),
  ];
  const body: string[][] = [];
  const flatItems: ChecklistItem[] = [];
  for (const cat of orderedCats) {
    const catItems = categorizedItems[cat] ?? [];
    for (const it of catItems) {
      const assignee = it.assigned_to
        ? (groupMembers.find((m) => m.user_id === it.assigned_to)?.full_name ?? "Unknown")
        : t('checklist:page.unassigned');
      const price = Number(it.estimated_price) || 0;
      const pids = (it.split_participant_ids ?? []).filter(Boolean);
      const pcts = it.split_percentages ?? {};
      let costSplitText = price > 0 ? `$${price.toFixed(2)}` : "";
      if (pids.length >= 2) {
        const others = pids.filter((id) => id !== currentUserId);
        const otherNames = others.map(
          (id) => groupMembers.find((m) => m.user_id === id)?.full_name?.split(" ")[0] ?? "?"
        );
        const pctVals = pids.map((id) => Math.round(pcts[id] ?? 100 / pids.length));
        const pctStr = pctVals.map((v) => `${v}%`).join("/");
        costSplitText += costSplitText ? ` (Split ${pctStr} with ${otherNames.join(", ")})` : `Split ${pctStr} with ${otherNames.join(", ")}`;
      }
      body.push([cat, it.item, assignee, costSplitText]);
      flatItems.push(it);
    }
  }

  const totalItems = body.length;
  const completedItems = flatItems.filter(
    (i) => (i.status ?? (i.is_checked ? "packed" : "need")) === "packed"
  ).length;
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(t('checklist:page.itemsCompleted', { completed: completedItems, total: totalItems }), 14, y);
  y += 6;

  doc.setFontSize(10);
  doc.text(t('checklist:page.totalEstimatedCost', { total: totalEstimatedCost.toFixed(2) }), 14, y);
  y += 5;
  if (isGroupContext && groupMembers.length > 0) {
    doc.text(t('checklist:page.myShare', { share: myShare.toFixed(2) }), 14, y);
    y += 5;
  }
  y += 3;

  if (selectedGroupDisplayName && groupMembers.length > 0) {
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(t('checklist:page.group', { group: selectedGroupDisplayName }), 14, y);
    y += 6;
    const collaborators = groupMembers.map((m) => m.full_name || "Unknown").join(", ");
    doc.setFontSize(10);
    doc.text(t('checklist:page.collaborators', { names: collaborators }), 14, y);
    y += 8;
  }

  if (body.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(t('checklist:page.noItemsYet'), 14, y);
    const emptyBlob = doc.output("blob");
    if (ios && isMobile) {
      deliverPdfForIOS(emptyBlob);
    } else if (isMobile && pdfWindow && !pdfWindow.closed) {
      const blobUrl = URL.createObjectURL(emptyBlob);
      pdfWindow.location.href = blobUrl;
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } else if (!isMobile) {
      doc.save("DormCheck_Essentials_List.pdf");
    }
    toast.success(t('checklist:page.pdfExported'));
    return;
  }

  const checkboxRects: { pageIndex: number; x: number; y: number; width: number; height: number; checked: boolean }[] = [];

  autoTable(doc, {
    startY: y,
    head: [[t('checklist:page.done'), t('checklist:page.category'), t('checklist:page.item'), t('checklist:page.assignedTo'), t('checklist:page.costSplit')]],
    body: body.map((row) => ["", row[0], row[1], row[2], row[3]]),
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 12, cellPadding: 3, halign: "center" },
      1: { cellWidth: 26, cellPadding: 4, fontSize: 9 },
      2: { cellWidth: 70, cellPadding: 5, fontSize: 10 },
      3: { cellWidth: 32, cellPadding: 4, fontSize: 9 },
      4: { cellWidth: 42, cellPadding: 4, fontSize: 9 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1) {
        const prev = data.table.body[data.row.index - 1] as unknown as { text: string }[] | undefined;
        const isFirstOfCategory = !prev || String(prev[1]) !== String(data.cell.raw);
        if (isFirstOfCategory) {
          data.cell.styles.fillColor = LIGHT_BRAND;
        }
      }
      if (data.section === "body" && data.column.index === 0) {
        data.cell.text = [];
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const boxSize = 3.5;
        const x = data.cell.x + (data.cell.width - boxSize) / 2;
        const cellY = data.cell.y + (data.cell.height - boxSize) / 2;
        const checked =
          (flatItems[data.row.index]?.status ??
            (flatItems[data.row.index]?.is_checked ? "packed" : "need")) === "packed";
        checkboxRects.push({
          pageIndex: (doc as unknown as { internal: { getCurrentPageInfo?: () => { pageNumber: number } } }).internal?.getCurrentPageInfo?.()?.pageNumber ?? 1,
          x,
          y: cellY,
          width: boxSize,
          height: boxSize,
          checked,
        });
        if (checked) {
          doc.setFillColor(3, 192, 60);
          doc.setDrawColor(3, 192, 60);
          doc.rect(x, cellY, boxSize, boxSize, "FD");
          doc.setFontSize(6);
          doc.setTextColor(255, 255, 255);
          doc.text("✓", x + boxSize / 2, cellY + boxSize / 2 + 0.4, { align: "center" });
          doc.setFontSize(10);
        } else {
          doc.setDrawColor(150, 150, 150);
          doc.rect(x, cellY, boxSize, boxSize, "S");
        }
      }
    },
    margin: { left: 14 },
  });

  let blob: Blob;
  if (checkboxRects.length > 0) {
    try {
      const { PDFDocument } = await import("pdf-lib");
      const mmToPt = 72 / 25.4;
      const pdfBytes = doc.output("arraybuffer") as ArrayBuffer;
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const form = pdfDoc.getForm();
      const pageCount = pdfDoc.getPageCount();
      for (let i = 0; i < checkboxRects.length; i++) {
        const r = checkboxRects[i];
        const pageIndex = Math.min(Math.max(0, r.pageIndex - 1), pageCount - 1);
        const page = pdfDoc.getPage(pageIndex);
        const pageHeightPt = page.getHeight();
        const leftPt = r.x * mmToPt;
        const bottomPt = pageHeightPt - (r.y + r.height) * mmToPt;
        const widthPt = r.width * mmToPt;
        const heightPt = r.height * mmToPt;
        const checkBox = form.createCheckBox(`done_${i}`);
        checkBox.addToPage(page, { x: leftPt, y: bottomPt, width: widthPt, height: heightPt });
        if (r.checked) checkBox.check();
        else checkBox.uncheck();
      }
      const saved = await pdfDoc.save();
      blob = new Blob([saved as BlobPart], { type: "application/pdf" });
    } catch {
      blob = doc.output("blob");
    }
  } else {
    blob = doc.output("blob");
  }

  if (ios && isMobile) {
    deliverPdfForIOS(blob);
  } else if (isMobile && pdfWindow && !pdfWindow.closed) {
    const blobUrl = URL.createObjectURL(blob);
    pdfWindow.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } else if (!isMobile) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "DormCheck_Essentials_List.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
  toast.success(t('checklist:page.pdfExported'));
}
