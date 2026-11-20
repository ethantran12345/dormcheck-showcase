import { PITT_UNIVERSITY_ID, CMU_UNIVERSITY_ID, CARLOW_UNIVERSITY_ID } from '@/config/universities';

/**
 * Campus-specific safety contacts for the Safety Center (P1.11).
 * Extension-not-replacement: these point students AT their campus services.
 * Numbers are the publicly listed non-emergency lines; verify when adding a
 * school.
 */
export interface CampusSafetyResource {
  label: string;
  detail: string;
  /** tel: or https: link */
  href: string;
}

export const CAMPUS_SAFETY_RESOURCES: Record<string, CampusSafetyResource[]> = {
  [PITT_UNIVERSITY_ID]: [
    {
      label: 'Pitt Police (non-emergency)',
      detail: '412-624-2121 - 24/7 campus police line',
      href: 'tel:+14126242121',
    },
    {
      label: 'Pitt Off-Campus Living',
      detail: 'University resources for renting around Oakland',
      href: 'https://www.ocl.pitt.edu',
    },
    {
      label: 'SafeRider / campus escort',
      detail: 'Late-night rides through Panther Central resources',
      href: 'https://www.studentaffairs.pitt.edu',
    },
  ],
  [CMU_UNIVERSITY_ID]: [
    {
      label: 'CMU Police (non-emergency)',
      detail: '412-268-2323 - 24/7 university police line',
      href: 'tel:+14122682323',
    },
    {
      label: 'CMU Housing Services',
      detail: 'University guidance for on- and off-campus housing',
      href: 'https://www.cmu.edu/housing',
    },
  ],
  // Verified 2026-08-11 against carlow.edu/student-life/campus-safety/contact-campus-police/
  // (emergency is 412-578-6007; the non-emergency line is the one we list).
  // Carlow publishes no escort/safe-walk service, so none is listed here -
  // a safety contact that does not exist is worse than a shorter list.
  [CARLOW_UNIVERSITY_ID]: [
    {
      label: 'Carlow Campus Police (non-emergency)',
      detail: '412-578-6005 - 24/7 campus police line',
      href: 'tel:+14125786005',
    },
    {
      label: 'Carlow Campus Safety',
      detail: 'University safety services and reporting',
      href: 'https://www.carlow.edu/student-life/campus-safety/',
    },
  ],
};
