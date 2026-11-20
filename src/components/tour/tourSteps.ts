import { useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Building2,
  ClipboardList,
  Home,
  ShoppingBag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

/**
 * Post-onboarding feature tour step definitions.
 *
 * Each step targets a DOM element via `data-tour-id` so the tour stays decoupled
 * from the nav components. The SAME ids are tagged on the native BottomNav /
 * NativeTopBar and the desktop sidebar, so the tour automatically highlights
 * whichever nav is actually on screen; per-platform copy comes from
 * `description` (mobile/native) vs `descriptionDesktop`.
 */
export interface TourStep {
  /** Matches the `data-tour-id` attribute on the target element */
  targetId: string;
  /** Short heading inside the tooltip */
  title: string;
  /** One-liner description (mobile / native app copy) */
  description: string;
  /** Desktop-web copy; falls back to `description` when omitted */
  descriptionDesktop?: string;
  /** Illustration icon shown in the tooltip */
  icon: LucideIcon;
}

const ALL_TOUR_STEPS: TourStep[] = [
  {
    targetId: 'nav-my-home',
    title: 'My Home',
    description: 'Your home base: move-in countdown, your dorm, and roommates at a glance.',
    descriptionDesktop: 'Your dashboard: move-in countdown, your dorm, and roommates at a glance.',
    icon: Home,
  },
  {
    targetId: 'nav-housing',
    title: 'Housing',
    description: 'Browse every Pitt dorm with real photos and reviews.',
    icon: Building2,
  },
  {
    targetId: 'nav-roommates',
    title: 'Roommates',
    description: 'Find students with compatible lifestyles.',
    icon: Users,
  },
  {
    targetId: 'nav-checklist',
    title: 'Get Ready',
    description: 'Tap here to plan what to bring, shop essentials, and track move-in.',
    descriptionDesktop: 'Plan what to bring, shop essentials, and track your move-in from the sidebar.',
    icon: ClipboardList,
  },
  {
    targetId: 'nav-marketplace',
    title: 'Marketplace',
    description: 'Buy and sell dorm essentials from other students.',
    icon: ShoppingBag,
  },
  {
    targetId: 'nav-profile',
    title: 'Profile',
    description: 'Tap your avatar to edit your info and settings anytime.',
    descriptionDesktop: 'Click your avatar in the top right to edit your info and settings anytime.',
    icon: UserRound,
  },
];

/** Resolve per-platform copy for a step (native app vs desktop web). */
export function stepDescription(step: TourStep): string {
  if (Capacitor.isNativePlatform()) return step.description;
  return step.descriptionDesktop ?? step.description;
}

/** Derive the tour target id for a nav route ("/checklist?tab=x" → "nav-checklist"). */
export function navTourId(to: string): string | undefined {
  const seg = to.split('?')[0].split('/')[1];
  return seg && ['my-home', 'checklist', 'marketplace', 'housing', 'roommates'].includes(seg)
    ? `nav-${seg}`
    : undefined;
}

function isTourStepEnabled(
  step: TourStep,
  flags: { showHousing: boolean; showRoommates: boolean },
): boolean {
  if (step.targetId === 'nav-housing') return flags.showHousing;
  if (step.targetId === 'nav-roommates') return flags.showRoommates;
  return true;
}

/** Active steps after runtime feature flags; indices and totals derive from this list. */
export function useTourSteps(): TourStep[] {
  const { showHousing, showRoommates } = useFeatureFlags();
  return useMemo(
    () =>
      ALL_TOUR_STEPS.filter((step) =>
        isTourStepEnabled(step, { showHousing, showRoommates }),
      ),
    [showHousing, showRoommates],
  );
}

export const TOUR_PENDING_KEY = 'dormcheck_tour_pending';
export const TOUR_COMPLETED_KEY = 'dormcheck_tour_completed';
