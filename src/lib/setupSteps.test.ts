import { describe, it, expect } from 'vitest';
import { deriveSetupSteps, type SetupStepSignals } from '@/lib/setupSteps';

const none: SetupStepSignals = {
  hasDorm: false,
  hasConfirmedRoommates: false,
  hasStartedChecklist: false,
  showInBuilding: false,
};

describe('deriveSetupSteps', () => {
  it('returns all four steps undone for a fresh user', () => {
    const steps = deriveSetupSteps(none);
    expect(steps.map((s) => s.id)).toEqual(['dorm', 'roommates', 'checklist', 'visibility']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it('marks each step done from its own signal only', () => {
    (
      [
        ['hasDorm', 'dorm'],
        ['hasConfirmedRoommates', 'roommates'],
        ['hasStartedChecklist', 'checklist'],
        ['showInBuilding', 'visibility'],
      ] as const
    ).forEach(([signal, stepId]) => {
      const steps = deriveSetupSteps({ ...none, [signal]: true });
      expect(steps.find((s) => s.id === stepId)?.done).toBe(true);
      expect(steps.filter((s) => s.done)).toHaveLength(1);
    });
  });

  it('marks everything done when all signals are true', () => {
    const steps = deriveSetupSteps({
      hasDorm: true,
      hasConfirmedRoommates: true,
      hasStartedChecklist: true,
      showInBuilding: true,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('gives every step a deep-link href', () => {
    for (const step of deriveSetupSteps(none)) {
      expect(step.href.startsWith('/')).toBe(true);
    }
  });
});
