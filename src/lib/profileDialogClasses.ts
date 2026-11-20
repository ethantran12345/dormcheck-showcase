/** Shared keyboard-aware full-screen dialog shell (mobile) with centered card on sm+. */

export const FULL_SCREEN_DIALOG_CONTENT_CLASS =
  '!fixed !left-0 !top-0 !right-0 !bottom-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-auto max-h-[100dvh] !rounded-none !border-0 !p-0 !pb-[var(--keyboard-height,0px)] !gap-0 flex flex-col overflow-hidden bg-card !shadow-none transition-[padding-bottom] duration-200 ease-ios sm:!inset-auto sm:!left-1/2 sm:!top-1/2 sm:!bottom-auto sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:!w-full sm:!max-w-[500px] sm:!h-auto sm:!max-h-[85vh] sm:!rounded-lg sm:!border sm:!border-border sm:!bg-card sm:!p-6 sm:!gap-4';

export const FULL_SCREEN_DIALOG_HEADER_CLASS =
  'shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))] pr-14 pb-2 sm:px-0 sm:pt-0 sm:pr-0';

// Bottom padding is safe-area only - NOT keyboard height. The CONTENT shell
// already reserves `pb-[var(--keyboard-height)]`, which lifts the entire dialog
// (header + this scrollable body + footer) above the keyboard. Re-adding the
// keyboard height here double-counts it: the body's min content then exceeds the
// available `100dvh − keyboard`, and the CONTENT's `overflow-hidden` clips the
// footer's lower button behind the keyboard. Content reservation is the single
// source of truth (see the 2026-06-29 footer fix).
export const FULL_SCREEN_DIALOG_BODY_CLASS =
  'flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-0 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]';

export const FULL_SCREEN_DIALOG_FOOTER_CLASS =
  'shrink-0 px-5 sm:px-0 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]';

/** @deprecated Use FULL_SCREEN_DIALOG_* exports; kept for existing profile dialog call sites. */
export const PROFILE_DIALOG_CONTENT_CLASS = FULL_SCREEN_DIALOG_CONTENT_CLASS;

/** Section header bar for profile settings cards (General, Legal, Danger Zone). */
export const PROFILE_SECTION_HEADER_CLASS =
  'px-4 py-3 rounded-t-xl bg-muted border-b border-border';

export const PROFILE_SECTION_TITLE_CLASS =
  'font-display font-bold text-foreground flex items-center gap-2';

export const PROFILE_SECTION_ICON_CLASS = 'w-4 h-4 text-muted-foreground shrink-0';

/** Green-tinted icon chip for standard profile setting rows. */
export const PROFILE_ROW_ICON_CHIP_CLASS =
  'w-10 h-10 rounded-full bg-malachite-600/10 flex items-center justify-center shrink-0';

export const PROFILE_ROW_ICON_CLASS = 'w-5 h-5 text-malachite-600';

/** Neutral muted chip for Sign Out (not green, not destructive). */
export const PROFILE_SIGN_OUT_ICON_CHIP_CLASS =
  'w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0';

export const PROFILE_SIGN_OUT_ICON_CLASS = 'w-5 h-5 text-muted-foreground';

/** @deprecated Use FULL_SCREEN_DIALOG_HEADER_CLASS */
export const PROFILE_DIALOG_HEADER_CLASS = FULL_SCREEN_DIALOG_HEADER_CLASS;

/** @deprecated Use FULL_SCREEN_DIALOG_BODY_CLASS */
export const PROFILE_DIALOG_BODY_CLASS = FULL_SCREEN_DIALOG_BODY_CLASS;

/** @deprecated Use FULL_SCREEN_DIALOG_FOOTER_CLASS */
export const PROFILE_DIALOG_FOOTER_CLASS = FULL_SCREEN_DIALOG_FOOTER_CLASS;
