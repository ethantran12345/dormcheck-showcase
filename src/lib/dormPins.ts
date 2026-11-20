import type { Dorm } from '@/types';

/**
 * Map pin encoding shared by MapView markers and the explore map legend.
 * Raw hex is required here (SVG fills on Mapbox HTML markers, outside Tailwind);
 * 'first-year' is the brand green (= malachite-600 token).
 */
export const PIN_COLORS = {
  'first-year': '#03C03C',
  upperclass: '#7C3AED',
} as const;

export const PIN_LABELS: Record<PinCategory, string> = {
  'first-year': 'First-year',
  upperclass: 'Upperclass',
};

export type PinCategory = keyof typeof PIN_COLORS;

export function getDormPinCategory(dorm: Dorm): PinCategory {
  return dorm.audienceType === 'Freshman' ? 'first-year' : 'upperclass';
}
