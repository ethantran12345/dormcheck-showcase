import confetti from 'canvas-confetti';

/**
 * Shared celebration bursts for My Home setup milestones. All shots pass
 * `disableForReducedMotion` so prefers-reduced-motion users get none of it;
 * the canvas canvas-confetti creates is purely decorative (pointer-events
 * none, no text), so no aria wiring is needed.
 */

// Brand green (= malachite-600) plus the prototype's celebration accents.
const CELEBRATION_COLORS = ['#03C03C', '#0AE24D', '#FFCE7A', '#7C5CFF', '#FF7A59', '#FFFFFF'];

const BASE = {
  colors: CELEBRATION_COLORS,
  disableForReducedMotion: true,
  zIndex: 80,
} as const;

/** Small localized burst centered on an element (e.g. a completed step card). */
export function burstAtElement(el: HTMLElement | null): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  confetti({
    ...BASE,
    particleCount: 30,
    spread: 75,
    startVelocity: 24,
    scalar: 0.9,
    ticks: 120,
    origin: {
      x: (r.left + r.width / 2) / window.innerWidth,
      y: (r.top + r.height / 2) / window.innerHeight,
    },
  });
}

/** Full-width rain + a few bursts for the all-four-steps-done finale. */
export function finaleCelebration(): void {
  confetti({
    ...BASE,
    particleCount: 60,
    spread: 100,
    startVelocity: 34,
    origin: { x: 0.5, y: 0.35 },
  });
  confetti({
    ...BASE,
    particleCount: 150,
    spread: 160,
    startVelocity: 14,
    gravity: 0.8,
    ticks: 250,
    origin: { x: 0.5, y: -0.1 },
  });
  setTimeout(() => {
    confetti({ ...BASE, particleCount: 40, spread: 80, startVelocity: 28, origin: { x: 0.28, y: 0.4 } });
    confetti({ ...BASE, particleCount: 40, spread: 80, startVelocity: 28, origin: { x: 0.72, y: 0.4 } });
  }, 220);
}
