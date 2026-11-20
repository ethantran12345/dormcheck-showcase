import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Boxes, Eye, EyeOff, Lock, MoveHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AUTO_MANAGED_MY_HOME_WIDGET_IDS,
  ESSENTIAL_MY_HOME_WIDGET_IDS,
  HIDEABLE_MY_HOME_WIDGET_IDS,
  RESIZABLE_MY_HOME_WIDGET_IDS,
  MY_HOME_USER_SIZE_SPAN_CLASS,
  MY_HOME_CARD_DESKTOP_HEIGHT,
  MY_HOME_WIDGET_LABELS,
  effectiveUserSize,
  type MyHomeSizeMap,
  type MyHomeUserSize,
  type MyHomeWidgetId,
} from '@/lib/myHomeLayout';
import { MY_HOME_WIDGET_ICON } from './widgetMeta';

/** Minimal shape the canvas needs from the page's widget registry. */
export interface CustomizeWidget {
  id: MyHomeWidgetId;
  essential: boolean;
  canRender?: () => boolean;
  render: () => ReactNode;
}

interface MyHomeCustomizeCanvasProps {
  order: MyHomeWidgetId[];
  hidden: MyHomeWidgetId[];
  sizes: MyHomeSizeMap;
  /** id → live widget entry (render fn + flags), from MyHomePage's registry. */
  widgets: Partial<Record<MyHomeWidgetId, CustomizeWidget>>;
  /** Desktop only: allow wide/small per card. Mobile is always full-width rows. */
  allowResize: boolean;
  onOrderChange: (order: MyHomeWidgetId[]) => void;
  onHiddenChange: (hidden: MyHomeWidgetId[]) => void;
  onSizeChange: (id: MyHomeWidgetId, size: MyHomeUserSize) => void;
}

/** Pixels of horizontal drag before the card snaps to the next/prev size. */
const RESIZE_SNAP_PX = 64;

/**
 * Apple-style corner resize grip (bottom-right). Drag it horizontally to snap
 * the card wider (`large`) or narrower (`small`); a plain click or arrow keys
 * also toggle it, so it stays keyboard-operable.
 */
function ResizeHandle({
  size,
  label,
  onChange,
}: {
  size: MyHomeUserSize;
  label: string;
  onChange: (size: MyHomeUserSize) => void;
}) {
  // Live target during a drag (state lags a render behind, so we track it here).
  const drag = useRef<{ x: number; size: MyHomeUserSize; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation(); // don't let the card's drag layer see this
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, size, moved: false };
    setActive(true);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    if (dx >= RESIZE_SNAP_PX && d.size === 'small') {
      d.size = 'large';
      d.x = e.clientX;
      onChange('large');
    } else if (dx <= -RESIZE_SNAP_PX && d.size === 'large') {
      d.size = 'small';
      d.x = e.clientX;
      onChange('small');
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // A tap (no real drag) just toggles, so the grip is also click-operable.
    if (d && !d.moved) onChange(size === 'large' ? 'small' : 'large');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange('large');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange('small');
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChange(size === 'large' ? 'small' : 'large');
    }
  };

  return (
    <button
      type="button"
      aria-label={`Resize ${label}. Currently ${size === 'large' ? 'wide' : 'small'}. Drag, or use left and right arrows.`}
      title="Drag to resize wide or small"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        // A clean, small circular handle tucked into the corner: subtle at rest,
        // brand-filled while grabbed. Reads clearly as "drag to resize".
        'absolute bottom-2 right-2 z-10 flex h-7 w-7 cursor-ew-resize touch-none items-center justify-center rounded-full',
        'bg-card/90 text-muted-foreground shadow-raised ring-1 ring-border/70 backdrop-blur-sm',
        'transition-all duration-150 hover:scale-110 hover:text-primary hover:ring-primary/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active && 'scale-110 bg-primary text-primary-foreground ring-primary shadow-raised',
      )}
    >
      <MoveHorizontal className="h-4 w-4" strokeWidth={2.25} aria-hidden />
    </button>
  );
}

/** Shown for a widget that has no content right now, so it's still orderable. */
function EmptyWidgetPlaceholder({ id }: { id: MyHomeWidgetId }) {
  const label = MY_HOME_WIDGET_LABELS[id];
  const Icon = MY_HOME_WIDGET_ICON[id] ?? Boxes;
  return (
    <div className="flex h-full min-h-[7rem] flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-6 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">Shows up here once there's something to see</span>
    </div>
  );
}

/**
 * One live widget in edit mode: the real card, made non-interactive, wrapped in
 * a drag layer (grab anywhere - Apple Control-Center style) with hide / lock /
 * resize chrome floating over it.
 */
function SortableLiveCard({
  entry,
  isHidden,
  size,
  allowResize,
  reduceMotion,
  onToggleHidden,
  onSizeChange,
}: {
  entry: CustomizeWidget;
  isHidden: boolean;
  size: MyHomeUserSize;
  allowResize: boolean;
  reduceMotion: boolean;
  onToggleHidden: (id: MyHomeWidgetId) => void;
  onSizeChange: (id: MyHomeWidgetId, size: MyHomeUserSize) => void;
}) {
  const { id } = entry;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });
  const label = MY_HOME_WIDGET_LABELS[id];
  const isEssential = ESSENTIAL_MY_HOME_WIDGET_IDS.has(id);
  const isHideable = HIDEABLE_MY_HOME_WIDGET_IDS.has(id);
  const isAutoManaged = AUTO_MANAGED_MY_HOME_WIDGET_IDS.has(id);
  const isResizable = allowResize && RESIZABLE_MY_HOME_WIDGET_IDS.has(id);
  const dimmed = isHidden && isHideable;
  const canShow = !entry.canRender || entry.canRender();
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <motion.div
      ref={setNodeRef}
      // Framer's `layout` spring is only for the DESKTOP resize (a card changing
      // width span); on mobile it would double-animate against dnd-kit's own
      // transform and stutter, so it's off there. Sibling cards slide via dnd-kit's
      // `transition` (canonical pattern) - the active card follows the pointer.
      layout={allowResize && !isDragging && !reduceMotion}
      transition={
        reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 38, mass: 0.7 }
      }
      style={{
        transform: CSS.Transform.toString(transform),
        transition: allowResize ? (isDragging ? transition : undefined) : transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn(
        'min-w-0',
        allowResize && MY_HOME_USER_SIZE_SPAN_CLASS[size],
        // Match the live grid's uniform card height on desktop so editing looks
        // exactly like the result.
        allowResize && MY_HOME_CARD_DESKTOP_HEIGHT,
      )}
    >
      <div className={cn('relative h-full', allowResize && 'md:overflow-hidden')}>
        {/* Live card, made inert so drags/clicks hit the edit layer, not the widget.
            Its own `layout` lets framer counter-scale it so content doesn't stretch
            while the outer box springs to a new width. */}
        <motion.div
          layout={allowResize && !isDragging && !reduceMotion}
          transition={
            reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 38, mass: 0.7 }
          }
          className={cn('pointer-events-none h-full select-none [&>*]:h-full', dimmed && 'opacity-40')}
        >
          {canShow ? entry.render() : <EmptyWidgetPlaceholder id={id} />}
        </motion.div>

        {/* Drag layer: long-press anywhere on the card to grab it (Apple-style),
            but `touch-pan-y` keeps the browser free to scroll vertically until the
            press engages - so a normal finger-drag scrolls the list instead of
            snatching a card. */}
        <div
          {...attributes}
          {...listeners}
          aria-label={`Drag ${label} to reorder`}
          className={cn(
            'absolute inset-0 cursor-grab touch-pan-y rounded-2xl ring-1 ring-inset ring-border/70 transition-shadow',
            'bg-gradient-to-b from-background/0 to-background/0 hover:ring-primary/40',
            isDragging && 'cursor-grabbing touch-none ring-2 ring-primary/60 shadow-overlay',
          )}
        />

        {/* Hide / lock / auto (top-right). */}
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {isEssential && (
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-card/90 text-muted-foreground/60 shadow-raised ring-1 ring-border/70"
              title="Always shown"
              aria-label="Always shown"
            >
              <Lock className="h-4 w-4" aria-hidden />
            </span>
          )}
          {isAutoManaged && (
            <span className="inline-flex h-7 items-center rounded-lg bg-card/90 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shadow-raised ring-1 ring-border/70">
              Auto
            </span>
          )}
          {isHideable && (
            <button
              type="button"
              onPointerDown={stop}
              onClick={() => onToggleHidden(id)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-card/90 text-muted-foreground shadow-raised ring-1 ring-border/70 transition-colors hover:text-foreground"
              aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
              aria-pressed={isHidden}
            >
              {isHidden ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>

        {/* Corner resize grip (desktop, bottom-right) - drag to snap wide/small. */}
        {isResizable && !dimmed && (
          <ResizeHandle size={size} label={label} onChange={(next) => onSizeChange(id, next)} />
        )}
      </div>
    </motion.div>
  );
}

/**
 * Apple-style live customize surface: drag the actual widget cards into place.
 * Desktop is a 2-column bento with wide/small resize; mobile is full-width rows
 * (reorder + hide only). One component drives both.
 */
export function MyHomeCustomizeCanvas({
  order,
  hidden,
  sizes,
  widgets,
  allowResize,
  onOrderChange,
  onHiddenChange,
  onSizeChange,
}: MyHomeCustomizeCanvasProps) {
  const hiddenSet = new Set(hidden);
  const items = order.filter((id) => widgets[id]);
  const reduceMotion = useReducedMotion() ?? false;

  const sensors = useSensors(
    // Mouse (not Pointer): pointer events also fire for touch, so a PointerSensor
    // would grab any 8px finger move as a drag and kill scrolling. MouseSensor
    // leaves touch entirely to the delay-based TouchSensor below - so on a phone
    // a finger-drag scrolls the page, and a long-press (250ms held still) starts
    // a reorder. Tolerance aborts the press the moment a scroll gesture moves,
    // so scrolling always wins over an accidental grab.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = order.indexOf(active.id as MyHomeWidgetId);
      const newIndex = order.indexOf(over.id as MyHomeWidgetId);
      if (oldIndex === -1 || newIndex === -1) return;
      onOrderChange(arrayMove(order, oldIndex, newIndex));
    },
    [order, onOrderChange],
  );

  const handleToggleHidden = useCallback(
    (id: MyHomeWidgetId) => {
      if (!HIDEABLE_MY_HOME_WIDGET_IDS.has(id)) return;
      onHiddenChange(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
    },
    [hidden, onHiddenChange],
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {allowResize
          ? 'Drag a card to move it, drag its bottom-right ↔ corner to resize, and hide what you do not need.'
          : 'Press and hold a card to move it, and hide what you do not need. Scroll freely to see them all.'}
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={rectSortingStrategy}>
          <div
            className={cn(
              'grid grid-cols-1 gap-4',
              allowResize && 'md:grid-flow-row-dense md:grid-cols-2 md:items-stretch md:gap-6',
            )}
          >
            {items.map((id) => (
              <SortableLiveCard
                key={id}
                entry={widgets[id] as CustomizeWidget}
                isHidden={hiddenSet.has(id)}
                size={effectiveUserSize(id, sizes)}
                allowResize={allowResize}
                reduceMotion={reduceMotion}
                onToggleHidden={handleToggleHidden}
                onSizeChange={onSizeChange}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
