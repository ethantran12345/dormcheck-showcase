import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * DormCheck's spot-illustration set (Product Identity Spec P4), hand-authored
 * inline SVG. Motif rules, recorded in docs/DECISIONS.md so the set can grow
 * without drifting:
 *
 *  1. Flat FRONT ELEVATIONS of school-agnostic dorm-life objects, drawn the way a
 *     room is drawn on a housing plan. No perspective, no people, no faces, no
 *     buildings, no school marks, no text.
 *  2. One line: 2px on the 80-unit grid, round caps and joins, 3-unit corners.
 *     Line colour is `currentColor`, set to `text-muted-foreground`.
 *  3. Planes are tokens only: `fill-card` for the object, `fill-muted` for the
 *     inside or back plane, `fill-border` for a print-offset shadow shifted
 *     +4/+4 with no stroke. Light and dark come from the tokens for free.
 *  4. Exactly ONE malachite accent per object (tape, bulb, lanyard, magnet,
 *     pin, handle), `malachite-600` light / `malachite-500` dark.
 *  5. Standing objects sit on a ground line at y=68; wall objects hang from a
 *     nail or a strap. Hand marks (tape scribble, note squiggle) are the only
 *     loose strokes.
 *
 * Decorative by default (`aria-hidden`). Pass `title` only where the drawing
 * carries meaning the surrounding text does not.
 */

const ACCENT_FILL = 'fill-malachite-600 dark:fill-malachite-500';
const ACCENT_STROKE = 'stroke-malachite-600 dark:stroke-malachite-500';

export interface DormIllustrationProps {
  className?: string;
  /** Accessible name. Omit for decorative use (the default). */
  title?: string;
}

function Frame({ className, title, children }: DormIllustrationProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-20 w-20 shrink-0 text-muted-foreground', className)}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false })}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Print-offset shadow: the silhouette, shifted +4/+4, no stroke. */
function Offset({ children }: { children: ReactNode }) {
  return (
    <g className="fill-border" stroke="none" transform="translate(4 4)">
      {children}
    </g>
  );
}

const Ground = () => <path d="M8 68H72" />;

/** Open moving box with a strip of tape. Marketplace: move-out is where supply comes from. */
export function MovingBoxIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <Offset>
        <rect x="18" y="36" width="44" height="32" rx="3" />
      </Offset>
      <path className="fill-muted" d="M18 36 10 27H36L40 36Z" />
      <path className="fill-muted" d="M62 36 70 27H44L40 36Z" />
      <rect className="fill-card" x="18" y="36" width="44" height="32" rx="3" />
      <rect className={ACCENT_FILL} stroke="none" x="37" y="37" width="6" height="12" rx="1" />
      <g transform="rotate(-3 31 57)">
        <rect className="fill-muted" x="23" y="52" width="16" height="10" rx="2" />
        <path d="M26 57.5q2-2 4 0t4 0 3-1" />
      </g>
      <rect x="47" y="44" width="10" height="4" rx="2" />
      <Ground />
    </Frame>
  );
}

/** Articulated desk lamp, bulb lit. */
export function DeskLampIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <Offset>
        <rect x="20" y="62" width="24" height="6" rx="3" />
        <path d="M38 28 56 18 64 34Z" />
      </Offset>
      <rect className="fill-card" x="20" y="62" width="24" height="6" rx="3" />
      <path d="M32 62 26 44 42 30" />
      <path className="fill-card" d="M38 28 56 18 64 34Z" />
      <circle className={ACCENT_FILL} stroke="none" cx="55" cy="33" r="3" />
      <circle className="fill-card" cx="26" cy="44" r="2.5" />
      <circle className="fill-card" cx="42" cy="30" r="2.5" />
      <Ground />
    </Frame>
  );
}

/** Room key on a lanyard. Subleases: the thing that actually changes hands. */
export function KeyLanyardIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <path className={ACCENT_STROKE} strokeWidth={3} d="M37 30 31 13Q30 7 37 6H47Q54 7 53 13L47 30" />
      <Offset>
        <circle cx="42" cy="52" r="8" />
      </Offset>
      <rect className="fill-card" x="35" y="28" width="14" height="7" rx="2" />
      <path d="M42 35V38" />
      <circle cx="42" cy="42" r="4" />
      <path className="fill-card" d="M40 58V73H44V70H47V67H44V58" />
      <circle className="fill-card" cx="42" cy="52" r="8" />
      <circle cx="42" cy="52" r="2.5" />
    </Frame>
  );
}

/** Drawstring laundry bag. */
export function LaundryBagIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <Offset>
        <path d="M33 30Q16 40 18 60Q19 68 28 68H52Q61 68 62 60Q64 40 47 30Z" />
      </Offset>
      <path className="fill-muted" d="M33 30 29 20Q40 15 51 20L47 30" />
      <path className="fill-card" d="M33 30Q16 40 18 60Q19 68 28 68H52Q61 68 62 60Q64 40 47 30Z" />
      <path d="M33 30Q40 33 47 30" />
      <path d="M38 32Q30 44 36 50M44 32Q52 44 46 50" />
      <rect className={ACCENT_FILL} stroke="none" x="38" y="47" width="6" height="8" rx="2" />
      <path d="M24 61Q40 64 56 61" />
      <Ground />
    </Frame>
  );
}

/** Mini fridge with a note held by a magnet. */
export function MiniFridgeIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <Offset>
        <rect x="22" y="20" width="36" height="48" rx="3" />
      </Offset>
      <rect className="fill-card" x="22" y="20" width="36" height="48" rx="3" />
      <path d="M22 34H58M52 24V30M52 39V49" />
      <g transform="rotate(-6 34.5 49.5)">
        <rect className="fill-muted" x="28" y="43" width="13" height="13" rx="1.5" />
        <path d="M31 50q1.5-1.5 3 0t3 0" />
      </g>
      <circle className={ACCENT_FILL} stroke="none" cx="34" cy="43.5" r="2.5" />
      <Ground />
    </Frame>
  );
}

/** Corkboard with a pinned note. Messages: the note left for someone. */
export function CorkboardIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <path d="M26 14 40 6 54 14" />
      <circle className="fill-card" cx="40" cy="6" r="1.5" />
      <Offset>
        <rect x="12" y="14" width="56" height="42" rx="3" />
      </Offset>
      <rect className="fill-card" x="12" y="14" width="56" height="42" rx="3" />
      <rect className="fill-muted" stroke="none" x="17" y="19" width="46" height="32" rx="1.5" />
      <g transform="rotate(-5 35 33)">
        <rect className="fill-card" x="26" y="24" width="18" height="18" rx="1.5" />
        <path d="M30 31q2-1.5 4 0t4 0 2-.5M30 36q2-1.5 4 0t3 0" />
      </g>
      <rect className="fill-card" x="48" y="28" width="11" height="14" rx="1.5" transform="rotate(5 53.5 35)" />
      <circle className={ACCENT_FILL} stroke="none" cx="35" cy="25" r="2.5" />
    </Frame>
  );
}

/** Room door with a blank number plate. Saved: places you mean to come back to. */
export function RoomDoorIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <Offset>
        <path d="M18 68V11Q18 8 21 8H59Q62 8 62 11V68Z" />
      </Offset>
      <path className="fill-muted" d="M18 68V11Q18 8 21 8H59Q62 8 62 11V68" />
      <path className="fill-card" d="M23 68V15Q23 13 25 13H55Q57 13 57 15V68" />
      <rect className="fill-muted" x="33" y="22" width="14" height="8" rx="2" />
      <circle cx="40" cy="37" r="1" />
      <path d="M50 46H54" />
      <circle className={ACCENT_FILL} stroke="none" cx="50" cy="46" r="2.5" />
      <Ground />
    </Frame>
  );
}

/** Folded bedding with a pillow on top. Checklist: what gets packed first. */
export function FoldedBeddingIllustration(props: DormIllustrationProps) {
  return (
    <Frame {...props}>
      <Offset>
        <rect x="16" y="56" width="48" height="12" rx="3" />
        <rect x="18" y="46" width="44" height="10" rx="3" />
        <rect x="17" y="37" width="46" height="9" rx="3" />
      </Offset>
      <rect className="fill-card" x="16" y="56" width="48" height="12" rx="3" />
      <rect className="fill-muted" x="18" y="46" width="44" height="10" rx="3" />
      <rect className={ACCENT_FILL} stroke="none" x="19" y="50" width="42" height="2.5" />
      <rect className="fill-card" x="17" y="37" width="46" height="9" rx="3" />
      <rect className="fill-card" x="24" y="26" width="32" height="11" rx="5.5" />
      <path d="M58 61H61M56 41H59" />
      <Ground />
    </Frame>
  );
}
