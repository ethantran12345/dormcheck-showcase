/**
 * Guided mini-flow definitions for three move-in onboarding steps (Panther Card,
 * campus accounts, dining plan). Each flow turns a static step into a short,
 * checkable walk-through that routes the student INTO Pitt's real systems
 * (Panther Central, my.pitt.edu, Pitt Eats) - an extension, never a replacement.
 *
 * Copy is intentionally English constants, matching the rest of the move-in step
 * data layer (`moveInSteps.ts` titles/notes render raw, not through t()), so a
 * card never reads half-translated. Keyed by the move-in step id the flow
 * attaches to.
 */
export type GuidedSubStep = {
  key: string;
  label: string;
  detail?: string;
  href?: string;
  hrefLabel?: string;
};

export const MOVE_IN_GUIDED_FLOWS: Record<string, GuidedSubStep[]> = {
  'default-panther-card': [
    {
      key: 'photo',
      label: 'Submit your ID photo to Panther Central',
      detail: "Upload a photo that meets Pitt's requirements so your card is printed before move-in.",
      href: 'https://www.pc.pitt.edu',
      hrefLabel: 'Open Panther Central',
    },
    {
      key: 'pickup',
      label: 'Pick up your Panther Card',
      detail:
        'Collect it at Panther Central on the 1st floor of Litchfield Towers - bring a government photo ID.',
    },
  ],
  'campus-ready-pitt-email': [
    {
      key: 'activate',
      label: 'Activate your Pitt account',
      detail: 'Claim your @pitt.edu username and set your password.',
      href: 'https://my.pitt.edu',
      hrefLabel: 'Open my.pitt.edu',
    },
    {
      key: 'email',
      label: 'Sign into your Pitt email',
      detail: 'Your @pitt.edu inbox is where class and housing notices land - check it early.',
      href: 'https://my.pitt.edu',
      hrefLabel: 'Open my.pitt.edu',
    },
    {
      key: 'office',
      label: 'Open Microsoft 365',
      detail: 'Word, Excel, and Teams are free with your Pitt login.',
      href: 'https://my.pitt.edu',
      hrefLabel: 'Open my.pitt.edu',
    },
  ],
  'campus-ready-dining': [
    {
      key: 'confirm',
      label: 'Confirm your dining plan',
      detail: "On-campus students are usually enrolled automatically - check which plan you're on.",
      href: 'https://my.pitt.edu',
      hrefLabel: 'Open my.pitt.edu',
    },
    {
      key: 'adjust',
      label: 'Adjust it if you need to',
      detail: "Change your plan through Pitt Eats before the term's deadline.",
      href: 'https://pitt.campusdish.com',
      hrefLabel: 'Open Pitt Eats',
    },
  ],
};

/** All step ids that carry a guided flow (their parent checkbox is derived). */
export const GUIDED_STEP_IDS = new Set(Object.keys(MOVE_IN_GUIDED_FLOWS));
