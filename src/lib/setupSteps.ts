export type SetupStepId = 'dorm' | 'roommates' | 'checklist' | 'visibility';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  /** Short line under the label for not-done steps. */
  hint: string;
  done: boolean;
  href: string;
}

export interface SetupStepSignals {
  /** profiles.current_dorm is set */
  hasDorm: boolean;
  /** accepted membership in a group_type='roommate' collaboration group */
  hasConfirmedRoommates: boolean;
  /**
   * The user has engaged with the checklist: packed/bought something or added
   * their own item. Mere existence of items doesn't count - every account is
   * seeded with starter items by handle_new_user_checklist().
   */
  hasStartedChecklist: boolean;
  /** profiles.show_in_building */
  showInBuilding: boolean;
}

/**
 * The move-in setup path shown on My Home: set your dorm, confirm your
 * roommates, start your checklist, show up in your building. Derived fresh from
 * profile/group/checklist state on every render; nothing is persisted, so steps
 * un-check themselves if the underlying state is undone.
 */
export function deriveSetupSteps(signals: SetupStepSignals): SetupStep[] {
  return [
    {
      id: 'dorm',
      label: 'Set your dorm',
      hint: 'Tell us where you live so everything else lights up',
      done: signals.hasDorm,
      href: '/my-home?openHousing=true',
    },
    {
      id: 'roommates',
      label: 'Confirm your roommates',
      hint: 'No roommates yet? Find one in Roommates, then share one link',
      done: signals.hasConfirmedRoommates,
      href: '/roommates/us?confirm=1',
    },
    {
      id: 'checklist',
      label: 'Start your checklist',
      hint: 'Plan what to bring and who brings it',
      done: signals.hasStartedChecklist,
      href: '/checklist',
    },
    {
      id: 'visibility',
      label: 'See your building',
      hint: 'Show up to hallmates and see who arrives when',
      done: signals.showInBuilding,
      href: '/my-home/dorm?tab=people',
    },
  ];
}
