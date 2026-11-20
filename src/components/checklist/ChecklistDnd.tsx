import React from "react";
import { useTranslation } from "react-i18next";
import { useSortable, defaultAnimateLayoutChanges, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { GripVertical, Loader2 } from "lucide-react";
import type { ChecklistItem } from "@/types";
import type { ChecklistDragPreview } from "./checklistTypes";

// dnd-kit's own attribute/listener types, derived from the hook so they track its version.
type SortableHandle = ReturnType<typeof useSortable>;

/** Sortable section wrapper: section header gets grip + drag, whole block is sortable. */
function SortableSection({
  isDragging,
  setNodeRef,
  style,
  attributes,
  listeners,
  header,
  children,
  collapseBody,
  isOver,
  sectionDragActive,
  itemDragActive,
}: {
  isDragging: boolean;
  setNodeRef: (el: HTMLDivElement | null) => void;
  style: React.CSSProperties;
  attributes: SortableHandle["attributes"];
  listeners: SortableHandle["listeners"];
  header: React.ReactNode;
  children: React.ReactNode;
  collapseBody?: boolean;
  isOver?: boolean;
  sectionDragActive?: boolean;
  itemDragActive?: boolean;
}) {
  const { t } = useTranslation();
  const isDropTargetSection = collapseBody && isOver && !isDragging;
  const isDropTargetItem = itemDragActive && !collapseBody && isOver && !isDragging;
  const isDropTarget = isDropTargetSection || isDropTargetItem;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        isDragging ? "transition-none" : "transition-transform duration-150 ease-out",
        // Fade full-height section only when body is visible.
        isDragging && !collapseBody && "opacity-30 bg-muted rounded-xl",
        // While actively dragging a collapsed section, show a solid placeholder slot
        isDragging && collapseBody && "bg-muted border-2 border-border shadow-inner rounded-xl",
        // When another section/item is dragged over, show dashed drop target
        !collapseBody && isDropTarget && "rounded-xl border-2 border-dashed border-malachite-600/60 bg-malachite-600/5"
      )}
    >
      <div
        className={cn(
          "group/section mt-6 flex items-center gap-1 bg-transparent py-2.5 px-0 mb-1",
          collapseBody ? "rounded-b-lg border border-border" : "border-b border-border",
          // When dragging an item, let hits pass through header so first row is easy to target.
          itemDragActive && "pointer-events-none"
        )}
      >
        {/* Drag the section only from this grip - never the whole header - so a
            keystroke that bubbles up from a row's edit input can't start a drag. */}
        <div
          {...(attributes as object)}
          {...(listeners as object)}
          className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 transition-opacity duration-150 active:cursor-grabbing hover:text-muted-foreground opacity-100 md:opacity-0 md:group-hover/section:opacity-100"
          aria-label={t("checklist:dnd.dragReorderSection")}
        >
          <GripVertical className="h-4 w-4" strokeWidth={2} />
        </div>
        <div
          className={cn(
            "flex items-center justify-between flex-1 min-w-0"
          )}
        >
          {header}
        </div>
      </div>
      {!collapseBody && (
        <div
          className={cn(
            "pt-0",
            sectionDragActive && "pointer-events-none select-none opacity-50"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Sortable checklist item row: grip on the left, then row content. Fixed min-height during drag to stabilize layout. */
function SortableChecklistRow({
  isDragging,
  isOver,
  isSaving,
  setNodeRef,
  style,
  attributes,
  listeners,
  children,
  className,
  sortableId,
}: {
  isDragging: boolean;
  isOver?: boolean;
  isSaving?: boolean;
  setNodeRef: (el: HTMLDivElement | null) => void;
  style: React.CSSProperties;
  attributes: SortableHandle["attributes"];
  listeners: SortableHandle["listeners"];
  children: React.ReactNode;
  className?: string;
  sortableId?: string;
  /** Supplied by callers (index === 0) as a first-row styling seam; not yet
   *  consumed for rendering. Declared here to keep the ItemSortable → row
   *  prop contract type-valid. */
  isFirstInSection?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-sortable-id={sortableId}
      className={cn(
        "group relative flex w-full min-w-0 flex-nowrap items-center gap-3 border-b border-border bg-card py-2 pl-1 pr-3 transition-colors duration-100 last:border-b-0 hover:bg-accent/50",
        isDragging && "opacity-30",
        isOver && "bg-malachite-600/5 ring-1 ring-inset ring-malachite-600/40",
        isSaving && "pointer-events-none opacity-70",
        className
      )}
    >
      {/* Drag only from this grip - never the whole row - so tapping a row to
          edit/check it can't accidentally start a drag (which, when the keyboard
          steals the pointer-up, stranded the drag overlay on screen). */}
      <div
        {...(attributes as object)}
        {...(listeners as object)}
        className={cn(
          "flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 transition-opacity duration-150 active:cursor-grabbing hover:text-muted-foreground",
          "opacity-100 md:opacity-0 md:group-hover:opacity-100",
          isDragging && "opacity-100"
        )}
        aria-label={t("checklist:dnd.dragReorderItem")}
      >
        <GripVertical className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      </div>
      {isSaving && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/60 rounded-lg" aria-hidden>
          <Loader2 className="h-5 w-5 animate-spin text-malachite-600" />
        </div>
      )}
      {children}
    </div>
  );
}

/** Wrapper that provides useSortable for a section. */
function SectionSortable({
  id,
  header,
  body,
  collapseBody,
  sectionDragActive,
  itemDragActive,
  disableDrag,
}: {
  id: string;
  header: React.ReactNode;
  body: React.ReactNode;
  collapseBody?: boolean;
  sectionDragActive?: boolean;
  itemDragActive?: boolean;
  disableDrag?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    animateLayoutChanges: defaultAnimateLayoutChanges,
    disabled: disableDrag,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
  };
  return (
    <SortableSection
      isDragging={isDragging}
      setNodeRef={setNodeRef}
      style={style}
      attributes={attributes}
      listeners={listeners}
      header={header}
      collapseBody={collapseBody}
      isOver={isOver}
      sectionDragActive={sectionDragActive}
      itemDragActive={itemDragActive}
    >
      {body}
    </SortableSection>
  );
}

/** Wrapper that provides useSortable for an item row. */
function ItemSortable({
  id,
  children,
  className,
  isSaving,
  isFirstInSection,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  isSaving?: boolean;
  isFirstInSection?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    animateLayoutChanges: defaultAnimateLayoutChanges,
    strategy: verticalListSortingStrategy,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : (transition ?? "transform 200ms ease"),
    opacity: isDragging ? 0.3 : 1,
  };
  return (
    <SortableChecklistRow
      isDragging={isDragging}
      isOver={isOver}
      isSaving={isSaving}
      isFirstInSection={isFirstInSection}
      setNodeRef={setNodeRef}
      style={style}
      attributes={attributes}
      listeners={listeners}
      className={className}
      sortableId={id}
    >
      {children}
    </SortableChecklistRow>
  );
}

/** Mirror displayedCategorizedItems preview logic for drop-time targetIds (Phase 3). */
function buildDisplayedCategorizedItemsFromPreview(
  categorizedItemsSafe: Record<string, ChecklistItem[]>,
  dragPreview: ChecklistDragPreview | null,
  activeItemData: ChecklistItem | null,
): Record<string, ChecklistItem[]> {
  if (!dragPreview || !activeItemData) return categorizedItemsSafe;
  const { fromCategory, toCategory, activeId, overId } = dragPreview;
  const listWithoutActive = (categorizedItemsSafe[toCategory] ?? []).filter(
    (i) => i.id !== activeId,
  );
  const insertItem = { ...activeItemData, category: toCategory };
  let previewList: ChecklistItem[];
  if (overId == null) {
    previewList = [insertItem, ...listWithoutActive];
  } else {
    const idx = listWithoutActive.findIndex((i) => i.id === overId);
    if (idx >= 0) {
      previewList = [
        ...listWithoutActive.slice(0, idx),
        insertItem,
        ...listWithoutActive.slice(idx),
      ];
    } else {
      previewList = [...listWithoutActive, insertItem];
    }
  }
  if (fromCategory === toCategory) {
    return { ...categorizedItemsSafe, [toCategory]: previewList };
  }
  const fromList = (categorizedItemsSafe[fromCategory] ?? []).filter(
    (i) => i.id !== activeId,
  );
  return {
    ...categorizedItemsSafe,
    [fromCategory]: fromList,
    [toCategory]: previewList,
  };
}

function getDroppableRect(
  node: { rect?: unknown } | undefined,
): { top: number; bottom: number; height: number } | null {
  if (!node?.rect) return null;
  const rectSource = node.rect as { current?: { top: number; bottom: number; height: number } };
  const rect = rectSource && "current" in rectSource ? rectSource.current : (node.rect as {
    top: number;
    bottom: number;
    height: number;
  });
  return rect ?? null;
}

/** Section under pointer: containment first (list order wins on shared edge), else nearest by edge distance. */
function getSectionAtPointerY(
  pointerY: number,
  sections: string[],
  containerList: { id: string; rect?: unknown }[],
): string {
  let nearestSection = sections[0] ?? "";
  let nearestDistance = Infinity;

  for (const sectionId of sections) {
    const sectionNode = containerList.find((n) => String(n.id) === sectionId);
    const sectionRect = getDroppableRect(sectionNode);
    if (!sectionRect) continue;

    if (pointerY >= sectionRect.top && pointerY <= sectionRect.bottom) {
      return sectionId;
    }

    const edgeDistance =
      pointerY < sectionRect.top
        ? sectionRect.top - pointerY
        : pointerY > sectionRect.bottom
          ? pointerY - sectionRect.bottom
          : 0;

    if (edgeDistance < nearestDistance) {
      nearestDistance = edgeDistance;
      nearestSection = sectionId;
    }
  }

  return nearestSection;
}

export {
  SortableSection,
  SortableChecklistRow,
  SectionSortable,
  ItemSortable,
  buildDisplayedCategorizedItemsFromPreview,
  getDroppableRect,
  getSectionAtPointerY,
};
