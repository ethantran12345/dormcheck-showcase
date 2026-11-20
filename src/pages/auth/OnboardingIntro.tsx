import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import {
  Loader2,
  Home,
  RefreshCw,
  ShoppingCart,
  Compass,
  Check,
  CheckCircle2,
  Search,
  Users,
  ClipboardList,
  Building2,
  Sparkles,
  MapPin,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { sanitizeOptional, sanitizeText } from '@/lib/sanitize';
import { trackEventImmediate } from '@/lib/analytics';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BasicsFields } from '@/components/profile/BasicsFields';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHousingHalls } from '@/hooks/useHousingHalls';
import { findHallByName, syncHallToHomeLocation } from '@/lib/hallSync';
import { autoJoinCommunityRooms } from '@/lib/communityJoin';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PageContainer } from '@/components/ui/page-container';

const OFF_CAMPUS_DORM_SENTINEL = '__off_campus__';

const TRANSITION_MS = 300;
const ONBOARDING_TAG_PREFIX = 'onboarding_interest:';

/** Vertical scroll inside the step viewport; horizontal overflow hidden for slide transitions. */
const STEP_SCROLL_CLASS =
  'h-full min-h-0 overflow-y-auto overflow-x-hidden pb-[calc(var(--keyboard-height,0px)+env(safe-area-inset-bottom,0px))]';

/** Primary CTA - brand green, full-width, generous tap target. */
const PRIMARY_BTN =
  'h-12 w-full rounded-full bg-malachite-800 text-base font-semibold text-white shadow-raised shadow-malachite-600/20 transition-colors hover:bg-malachite-900 disabled:cursor-not-allowed disabled:opacity-50';

/** Accent tints for option icons - low-opacity over background so they read in light + dark themes. */
const TINT_CLASSES: Record<string, { chip: string; icon: string }> = {
  green: { chip: 'bg-malachite-600/12', icon: 'text-malachite-600' },
  blue: { chip: 'bg-blue-500/12', icon: 'text-blue-600 dark:text-blue-400' },
  amber: { chip: 'bg-amber-500/15', icon: 'text-amber-600 dark:text-amber-400' },
  violet: { chip: 'bg-violet-500/12', icon: 'text-violet-600 dark:text-violet-400' },
};

type Tint = keyof typeof TINT_CLASSES;

function dismissKeyboard() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  if (Capacitor.isNativePlatform()) {
    void import('@capacitor/keyboard').then(({ Keyboard }) => Keyboard.hide().catch(() => {}));
  }
}

function getUserIntentOptions() {
  return [
    {
      id: 'incoming_freshman',
      icon: Home,
      tint: 'green' as Tint,
      titleKey: 'onboarding:intro.userIntent.incomingFreshman.title',
      descKey: 'onboarding:intro.userIntent.incomingFreshman.desc',
    },
    {
      id: 'current_student',
      icon: RefreshCw,
      tint: 'blue' as Tint,
      titleKey: 'onboarding:intro.userIntent.currentStudent.title',
      descKey: 'onboarding:intro.userIntent.currentStudent.desc',
    },
    {
      id: 'buy_sell',
      icon: ShoppingCart,
      tint: 'amber' as Tint,
      titleKey: 'onboarding:intro.userIntent.buySell.title',
      descKey: 'onboarding:intro.userIntent.buySell.desc',
    },
    {
      id: 'exploring',
      icon: Compass,
      tint: 'violet' as Tint,
      titleKey: 'onboarding:intro.userIntent.exploring.title',
      descKey: 'onboarding:intro.userIntent.exploring.desc',
    },
  ] as const;
}

function getNeedOptions() {
  return [
    {
      id: 'exploring-dorms',
      icon: Search,
      tint: 'blue' as Tint,
      titleKey: 'onboarding:intro.need.exploring.title',
      descKey: 'onboarding:intro.need.exploring.desc',
    },
    {
      id: 'roommate',
      icon: Users,
      tint: 'violet' as Tint,
      titleKey: 'onboarding:intro.need.roommate.title',
      descKey: 'onboarding:intro.need.roommate.desc',
    },
    {
      id: 'checklist',
      icon: ClipboardList,
      tint: 'green' as Tint,
      titleKey: 'onboarding:intro.need.checklist.title',
      descKey: 'onboarding:intro.need.checklist.desc',
    },
    {
      id: 'marketplace',
      icon: ShoppingCart,
      tint: 'amber' as Tint,
      titleKey: 'onboarding:intro.need.marketplace.title',
      descKey: 'onboarding:intro.need.marketplace.desc',
    },
  ] as const;
}

function getActionLinks() {
  return {
    'exploring-dorms': {
      href: '/campus',
      icon: Building2,
      tint: 'blue' as Tint,
      titleKey: 'onboarding:intro.actionLink.browseHousing.title',
      descKey: 'onboarding:intro.actionLink.browseHousing.desc',
    },
    roommate: {
      href: '/roommates',
      icon: Users,
      tint: 'violet' as Tint,
      titleKey: 'onboarding:intro.actionLink.findRoommates.title',
      descKey: 'onboarding:intro.actionLink.findRoommates.desc',
    },
    checklist: {
      href: '/checklist',
      icon: ClipboardList,
      tint: 'green' as Tint,
      titleKey: 'onboarding:intro.actionLink.startChecklist.title',
      descKey: 'onboarding:intro.actionLink.startChecklist.desc',
    },
    marketplace: {
      href: '/marketplace',
      icon: ShoppingCart,
      tint: 'amber' as Tint,
      titleKey: 'onboarding:intro.actionLink.browseMarketplace.title',
      descKey: 'onboarding:intro.actionLink.browseMarketplace.desc',
    },
  };
}

function userIntentOptionsVisible(flags: {
  showHousing: boolean;
  showRoommates: boolean;
}) {
  return getUserIntentOptions().filter(
    (opt) => opt.id !== 'current_student' || flags.showHousing || flags.showRoommates,
  );
}

function needOptionsVisible(flags: { showHousing: boolean; showRoommates: boolean }) {
  return getNeedOptions().filter((opt) => {
    if (opt.id === 'exploring-dorms') return flags.showHousing;
    if (opt.id === 'roommate') return flags.showRoommates;
    return true;
  });
}

function actionLinkIdsVisible(flags: {
  showHousing: boolean;
  showRoommates: boolean;
}): string[] {
  const links = getActionLinks();
  return Object.keys(links).filter((id) => {
    if (id === 'exploring-dorms') return flags.showHousing;
    if (id === 'roommate') return flags.showRoommates;
    return true;
  });
}

const TOTAL_STEPS = 5;

function progressPercent(step: number): number {
  return Math.round((step / TOTAL_STEPS) * 100);
}

/** Staggered entrance for option cards - subtle, respects the 300ms step slide. */
function staggerStyle(index: number): React.CSSProperties {
  return { animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' };
}

/** Soft tinted square that holds an option/feature icon - the main source of color in the flow. */
function IconChip({
  tint,
  icon: Icon,
  className,
}: {
  tint: Tint;
  icon: typeof Home;
  className?: string;
}) {
  const t = TINT_CLASSES[tint];
  // T3.6: the tint lives on the WRAPPER, not on the <Icon>, so the glyph picks it
  // up through currentColor. The cards these chips sit in are now <Button> /
  // <ToggleGroupItem>, whose cva base carries `[&_svg]:text-current` — a
  // descendant rule that outranks a colour class on the svg itself, but is a
  // no-op against an inherited one.
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
        t.chip,
        t.icon,
        className,
      )}
    >
      <Icon className="h-6 w-6" />
    </div>
  );
}

/**
 * T3.6: the same selectable-card shell, expressed for a `ToggleGroupItem`. The
 * selected/unselected split moves out of a JS branch into `data-[state=on]` so
 * Radix owns the selection — which is what buys the radio/checkbox semantics and
 * the roving tabindex the raw card buttons never had. The leading classes
 * deliberately override toggleVariants' h-10 / px-3 / rounded-md / justify-center
 * box (className is merged last, so tailwind-merge resolves them).
 *
 * `[&_svg]:size-6` replaces the base's `[&_svg]:size-4`: these cards carry a 24px
 * IconChip glyph and a 24px state indicator, not a 16px leaf-button icon. Any
 * inner icon that must stay smaller marks itself `!`-important, since the base's
 * descendant selector outranks a plain size class on the svg.
 */
const selectableCardToggleClass = cn(
  'flex h-auto w-full items-center justify-start gap-4 rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.99] [&_svg]:size-6',
  'border-border bg-card hover:border-malachite-600/40 hover:bg-card hover:shadow-overlay',
  'data-[state=on]:border-malachite-600 data-[state=on]:bg-malachite-600/[0.06] data-[state=on]:shadow-raised',
);

/** Step header: friendly title + subtitle with strong hierarchy. */
function StepHeading({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight text-foreground">
        {title}
      </h1>
      {subtitle && <p className="mt-2 text-[15px] leading-snug text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

type UserIntent = ReturnType<typeof getUserIntentOptions>[number]['id'] | '';
type HousingPath = 'have_assignment' | 'not_yet' | '';

type TransitionState = { from: number; to: number; dir: 'forward' | 'back' } | null;

const OnboardingIntro = () => {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const { university } = useUniversity();
  const { flagsResolved, showHousing, showRoommates } = useFeatureFlags();
  const onboardingFlags = useMemo(
    () => ({ showHousing, showRoommates }),
    [showHousing, showRoommates],
  );
  const onboardingDefaultPath = showHousing ? '/campus' : '/checklist';
  const visibleUserIntentOptions = useMemo(
    () => userIntentOptionsVisible(onboardingFlags),
    [onboardingFlags],
  );
  const visibleNeedOptions = useMemo(
    () => needOptionsVisible(onboardingFlags),
    [onboardingFlags],
  );
  const visibleActionLinkIds = useMemo(
    () => actionLinkIdsVisible(onboardingFlags),
    [onboardingFlags],
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  /**
   * After persisting `has_completed_onboarding`, push the new value into any cached
   * consumers (My Home reads `['my-home-profile', userId]`). Setting it optimistically
   * kills the redirect race - without it, My Home serves the stale cached `false`
   * synchronously and bounces the user straight back into onboarding.
   */
  const markOnboardingCompleteInCache = useCallback(() => {
    if (!user?.id) return;
    const key = ['my-home-profile', user.id];
    queryClient.setQueryData(key, (old: Record<string, unknown> | null | undefined) =>
      old ? { ...old, has_completed_onboarding: true } : old,
    );
    void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, user?.id]);

  const [step, setStep] = useState(1);
  const [transition, setTransition] = useState<TransitionState>(null);
  const transitionLock = useRef(false);

  const [userIntent, setUserIntent] = useState<UserIntent>('');
  const [fullName, setFullName] = useState('');
  const [major, setMajor] = useState('');
  const [school, setSchool] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [graduationYear, setGraduationYear] = useState('');

  const [housingPath, setHousingPath] = useState<HousingPath>('');
  const [currentDorm, setCurrentDorm] = useState('');
  const [currentFloor, setCurrentFloor] = useState('');
  const [currentRoom, setCurrentRoom] = useState('');
  const [isOffCampusCurrent, setIsOffCampusCurrent] = useState(false);
  const [moveInDate, setMoveInDate] = useState('');

  const {
    data: housingHalls,
    isLoading: isDormOptionsLoading,
    isError: dormOptionsFailed,
  } = useHousingHalls();
  const dormOptions = useMemo(() => (housingHalls ?? []).map((h) => h.name), [housingHalls]);
  const dormOptionsError = dormOptionsFailed ? 'Failed to load buildings' : null;

  const [selectedNeeds, setSelectedNeeds] = useState<string[]>([]);

  const [sleepSchedule, setSleepSchedule] = useState('');
  const [cleanliness, setCleanliness] = useState('');
  const [socialLevel, setSocialLevel] = useState('');
  const [studyStyle, setStudyStyle] = useState('');
  const [showProfileToRoommates, setShowProfileToRoommates] = useState(true);

  const [saving, setSaving] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  /** Values loaded from DB for Step 2 - save only sends fields the user changed vs this baseline. */
  const step2BaselineRef = useRef<{
    fullName: string;
    major: string;
    school: string;
    gradeLevel: string;
    graduationYear: string;
  } | null>(null);

  const wantsRoommate = selectedNeeds.includes('roommate');

  const firstName = useMemo(() => {
    const n = (fullName || (user?.user_metadata?.full_name as string | undefined) || '').trim();
    return n ? n.split(/\s+/)[0] : '';
  }, [fullName, user?.user_metadata?.full_name]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, major, school, grade_level, graduation_year')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled || !data) {
        if (!cancelled) setProfileLoaded(true);
        return;
      }
      const metaName = user.user_metadata?.full_name as string | undefined;
      const full = (data.full_name || metaName || '').trim();
      const maj = (data.major ?? '').trim();
      const sch = (data.school ?? '').trim();
      const gl = (data.grade_level ?? '').trim();
      const gy = data.graduation_year != null ? String(data.graduation_year) : '';
      setFullName(full);
      setMajor(maj);
      setSchool(sch);
      setGradeLevel(gl);
      setGraduationYear(gy);
      step2BaselineRef.current = {
        fullName: full,
        major: maj,
        school: sch,
        gradeLevel: gl,
        graduationYear: gy,
      };
      setProfileLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.user_metadata?.full_name]);

  const runStepTransition = useCallback((to: number, dir: 'forward' | 'back') => {
    if (transitionLock.current) return;
    dismissKeyboard();
    transitionLock.current = true;
    setTransition({ from: step, to, dir });
    window.setTimeout(() => {
      setStep(to);
      setTransition(null);
      transitionLock.current = false;
    }, TRANSITION_MS);
  }, [step]);

  const saveStep2 = async (): Promise<boolean> => {
    if (!user?.id) return false;
    const yearStr = graduationYear.trim();
    const y = parseInt(yearStr, 10);
    if (!fullName.trim() || !major.trim() || !gradeLevel || !yearStr || Number.isNaN(y) || y < 2024 || y > 2035) {
      toast.error(t('onboarding:intro.step2.errorFillAllFields'));
      return false;
    }
    setSaving(true);
    try {
      const fn = sanitizeText(fullName);
      const mj = sanitizeText(major);
      const schoolTrim = school.trim();
      const sc = sanitizeOptional(school);
      const baseline = step2BaselineRef.current;

      if (!baseline) {
        const { error } = await supabase.from('profiles').upsert(
          {
            id: user.id,
            email: user.email || null,
            full_name: fn,
            major: mj,
            school: sc,
            grade_level: gradeLevel,
            graduation_year: y,
          },
          { onConflict: 'id' },
        );
        if (error) throw error;
      } else {
        const updates: TablesUpdate<'profiles'> = {};
        if (fn !== baseline.fullName) updates.full_name = fn;
        if (mj !== baseline.major) updates.major = mj;
        if (schoolTrim !== baseline.school) updates.school = sc;
        if (gradeLevel !== baseline.gradeLevel) updates.grade_level = gradeLevel;
        if (String(y) !== baseline.graduationYear) updates.graduation_year = y;

        if (Object.keys(updates).length > 0) {
          if (user.email) updates.email = user.email;
          const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
          if (error) throw error;
        }
      }

      step2BaselineRef.current = {
        fullName: fn,
        major: mj,
        school: schoolTrim,
        gradeLevel,
        graduationYear: String(y),
      };
      return true;
    } catch (err) {
      console.error('Step 2 save failed:', err);
      toast.error(t('onboarding:intro.step2.errorUnableToSave'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveStep3 = async (): Promise<boolean> => {
    if (!user?.id) return false;
    if (!housingPath) {
      toast.error(t('onboarding:intro.step3.errorChooseOption'));
      return false;
    }
    if (housingPath === 'have_assignment' && !sanitizeText(currentDorm)) {
      toast.error(
        isOffCampusCurrent
          ? t('onboarding:intro.step3.errorEnterBuildingOrAddress')
          : t('onboarding:intro.step3.errorSelectBuilding'),
      );
      return false;
    }
    setSaving(true);
    try {
      const payload =
        housingPath === 'have_assignment'
          ? {
              id: user.id,
              current_dorm: sanitizeOptional(currentDorm),
              current_floor: sanitizeOptional(currentFloor),
              current_room: sanitizeOptional(currentRoom),
              housing_type: isOffCampusCurrent ? 'off-campus' : 'on-campus',
              move_in_date: !isOffCampusCurrent && moveInDate ? moveInDate : null,
            }
          : {
              id: user.id,
              current_dorm: null,
              current_floor: null,
              current_room: null,
              housing_type: null,
              move_in_date: null,
            };
      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      // Halls only: mirror into the schedule's home location so "where you
      // live" is asked once. Best-effort - never blocks onboarding.
      if (housingPath === 'have_assignment' && !isOffCampusCurrent) {
        const hall = findHallByName(housingHalls, currentDorm);
        if (hall) {
          try {
            await syncHallToHomeLocation(user.id, hall);
            void queryClient.invalidateQueries({ queryKey: ['home-location'] });
          } catch (syncErr) {
            console.error('Home location sync failed (non-blocking):', syncErr);
          }
        }
        // Auto-join the building + floor Community rooms; the toast is the
        // privacy disclosure (display name becomes visible to neighbors).
        void autoJoinCommunityRooms().then((joined) => {
          if (joined) toast.info(t('messaging:community.autoJoinDisclosure'));
        });
      }
      return true;
    } catch (err) {
      console.error('Step 3 save failed:', err);
      toast.error(t('onboarding:intro.step3.errorUnableToSave'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveStep4 = async (): Promise<boolean> => {
    if (!user?.id) return false;
    setSaving(true);
    try {
      const { data: row } = await supabase.from('profiles').select('tags').eq('id', user.id).maybeSingle();
      const existing = (row?.tags as string[] | null) ?? [];
      const filtered = existing.filter(
        (t): t is string =>
          typeof t === 'string' && Boolean(t.trim()) && !t.startsWith(ONBOARDING_TAG_PREFIX),
      );
      const interestTags = selectedNeeds.map((n) => `${ONBOARDING_TAG_PREFIX}${n}`);
      const merged = [...filtered, ...interestTags];
      const { error } = await supabase.from('profiles').update({ tags: merged }).eq('id', user.id);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Step 4 save failed:', err);
      toast.error(t('onboarding:intro.step4.errorUnableToSave'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Roommate-vibe prefs now live inline on the interests step and are fully
   * optional - save whatever the user answered, never block on blanks.
   */
  const saveRoommatePrefs = async (): Promise<boolean> => {
    if (!user?.id) return false;
    const payload: TablesInsert<'profiles'> = { id: user.id };
    if (sleepSchedule) payload.sleep = sleepSchedule;
    if (cleanliness) payload.cleanliness = cleanliness;
    if (socialLevel) payload.social_level = socialLevel;
    if (studyStyle) payload.study_style = studyStyle;
    payload.is_roommate_searching = showProfileToRoommates;
    payload.is_public = showProfileToRoommates;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Roommate prefs save failed:', err);
      toast.error(t('onboarding:intro.step5.errorUnableToSave'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const completeOnboarding = async (path: string = onboardingDefaultPath) => {
    if (!user?.id) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, has_completed_onboarding: true }, { onConflict: 'id' });
      if (error) throw error;
      // Awaited (not debounced): navigate() unmounts this page immediately,
      // which would drop a debounced useAnalytics timer.
      await trackEventImmediate(user.id, isAdmin, 'onboarding_completed', { source: 'finish' });
      markOnboardingCompleteInCache();
      try {
        if (localStorage.getItem('dormcheck_tour_completed') !== '1') {
          localStorage.setItem('dormcheck_tour_pending', '1');
        }
      } catch { /* private mode / disabled storage */ }
      navigate(path, { replace: true });
    } catch (err) {
      console.error('Complete onboarding failed:', err);
      toast.error(t('common:toast.genericError'));
    } finally {
      setSaving(false);
    }
  };

  const step3Heading = () => {
    if (userIntent === 'incoming_freshman') return t('onboarding:intro.step3.headingFreshman');
    if (userIntent === 'current_student') return t('onboarding:intro.step3.headingCurrentStudent');
    return t('onboarding:intro.step3.headingDefault');
  };

  const step3CardA = () => {
    if (userIntent === 'incoming_freshman')
      return {
        title: t('onboarding:intro.step3.cardA.titleFreshman'),
        sub: t('onboarding:intro.step3.cardA.subFreshman'),
      };
    return {
      title: t('onboarding:intro.step3.cardA.titleDefault'),
      sub: t('onboarding:intro.step3.cardA.subDefault'),
    };
  };

  const step3CardB = () => {
    if (userIntent === 'incoming_freshman')
      return {
        title: t('onboarding:intro.step3.cardB.titleFreshman'),
        sub: t('onboarding:intro.step3.cardB.subFreshman'),
      };
    return {
      title: t('onboarding:intro.step3.cardB.titleDefault'),
      sub: t('onboarding:intro.step3.cardB.subDefault'),
    };
  };

  const handleContinue1 = () => {
    if (!userIntent) return;
    runStepTransition(2, 'forward');
  };

  const handleContinue2 = async () => {
    const ok = await saveStep2();
    if (ok) runStepTransition(3, 'forward');
  };

  const handleContinue3 = async () => {
    const ok = await saveStep3();
    if (ok) runStepTransition(4, 'forward');
  };

  // Interests + (optional) roommate vibe share step 4 - one save pass each.
  const handleContinue4 = async () => {
    const ok = await saveStep4();
    if (!ok) return;
    if (wantsRoommate) {
      const prefsOk = await saveRoommatePrefs();
      if (!prefsOk) return;
    }
    runStepTransition(5, 'forward');
  };

  // The interests step stays skippable ("you can change this later").
  const handleSkip4 = () => {
    setSelectedNeeds([]);
    runStepTransition(5, 'forward');
  };

  const handleBack2 = () => runStepTransition(1, 'back');
  const handleBack3 = () => runStepTransition(2, 'back');
  const handleBack4 = () => runStepTransition(3, 'back');
  const handleBack5 = () => runStepTransition(4, 'back');

  // Required minimum per the lean spec: name + class year (grade + grad year).
  // Major is optional (trimmed 2026-07-14) so students get onto the app faster.
  const step2Valid =
    fullName.trim() &&
    gradeLevel &&
    graduationYear.trim() &&
    !Number.isNaN(parseInt(graduationYear, 10)) &&
    (() => {
      const y = parseInt(graduationYear, 10);
      return y >= 2024 && y <= 2035;
    })();

  const BackButton = ({ onClick }: { onClick: () => void }) => (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="mx-auto h-auto p-0 font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground"
    >
      {t('common:actions.back')}
    </Button>
  );

  const SkipLink = ({ onClick }: { onClick: () => void }) => (
    <Button
      type="button"
      variant="link"
      onClick={onClick}
      className="mx-auto h-auto p-0 text-muted-foreground hover:text-foreground"
    >
      {t('onboarding:intro.skipForNow')}
    </Button>
  );

  /**
   * Step-5 preference rows are single-select segmented controls, so they compose
   * ToggleGroup (T3.5 precedent) rather than raw buttons: Radix supplies the
   * radio-group semantics and roving tabindex the raw pills had no equivalent of.
   * `v && setVal(v)` keeps the current behaviour of re-tapping the active pill
   * being a no-op, where ToggleGroup would otherwise clear the selection.
   */
  const renderPillRow = (
    labelKey: string,
    value: string,
    setVal: (v: string) => void,
    options: string[]
  ) => (
    <div className="space-y-2.5">
      <p className="text-sm font-semibold text-foreground">{t(labelKey)}</p>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && setVal(v)}
        aria-label={t(labelKey)}
        className="grid grid-cols-3 gap-2"
      >
        {options.map((opt) => (
          <ToggleGroupItem
            key={opt}
            value={opt}
            className={cn(
              'h-auto min-w-0 rounded-xl border-2 px-2 py-2.5 text-center text-xs font-semibold transition-all sm:text-sm',
              'border-border bg-card text-muted-foreground hover:border-malachite-600/40 hover:bg-card',
              'data-[state=on]:border-malachite-600 data-[state=on]:bg-malachite-600/[0.08] data-[state=on]:text-malachite-600'
            )}
          >
            {t(opt)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  const renderStepBody = (s: number) => {
    switch (s) {
      case 1:
        return (
          <>
            <StepHeading
              title={
                <Trans
                  i18nKey={firstName ? 'onboarding:intro.step1.titleWithName' : 'onboarding:intro.step1.title'}
                  values={{ name: firstName }}
                  components={{
                    wave: <span className="inline-block">👋</span>,
                  }}
                />
              }
              subtitle={t('onboarding:intro.step1.subtitle', { school: university.shortName })}
            />
            <ToggleGroup
              type="single"
              value={userIntent ?? ''}
              onValueChange={(v) => v && setUserIntent(v as typeof userIntent)}
              aria-label={t('onboarding:intro.step1.subtitle', { school: university.shortName })}
              className="flex flex-col items-stretch justify-start gap-3"
            >
              {visibleUserIntentOptions.map((opt, i) => {
                const selected = userIntent === opt.id;
                return (
                  <ToggleGroupItem
                    key={opt.id}
                    value={opt.id}
                    className={cn(selectableCardToggleClass, 'animate-fade-in')}
                    style={staggerStyle(i)}
                  >
                    <IconChip tint={opt.tint} icon={opt.icon} />
                    <div className="min-w-0 flex-1">
                      <span className="block font-bold text-foreground">{t(opt.titleKey)}</span>
                      <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                        {t(opt.descKey)}
                      </span>
                    </div>
                    {selected ? (
                      <CheckCircle2 className="h-6 w-6 shrink-0 text-malachite-600" />
                    ) : (
                      <div className="h-6 w-6 shrink-0 rounded-full border-2 border-border" />
                    )}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <Button type="button" data-testid="onboarding-continue-button" onClick={handleContinue1} disabled={!userIntent} className={cn(PRIMARY_BTN, 'mt-8')}>
              {t('common:actions.continue')}
              <ArrowRight className="ml-1.5 h-5 w-5" />
            </Button>
          </>
        );
      case 2:
        return (
          <>
            <StepHeading
              title={t('onboarding:intro.step2.title')}
              subtitle={t('onboarding:intro.step2.subtitle')}
            />
            {/* Shared with Settings -> Profile (Basics) via BasicsFields, so the
                identity field set + grade options never drift between the two. */}
            <BasicsFields
              variant="onboarding"
              idPrefix="ob"
              fullName={fullName}
              onFullNameChange={setFullName}
              major={major}
              onMajorChange={setMajor}
              school={school}
              onSchoolChange={setSchool}
              gradeLevel={gradeLevel}
              onGradeLevelChange={setGradeLevel}
              graduationYear={graduationYear}
              onGraduationYearChange={setGraduationYear}
              required={{ fullName: true, gradeLevel: true, graduationYear: true }}
            />
            <div className="mt-8 flex flex-col gap-3">
              <Button
                type="button"
                onClick={() => void handleContinue2()}
                disabled={!step2Valid || saving || !profileLoaded}
                className={PRIMARY_BTN}
              >
                {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : t('common:actions.continue')}
              </Button>
              <BackButton onClick={handleBack2} />
            </div>
          </>
        );
      case 3: {
        const a = step3CardA();
        const b = step3CardB();
        return (
          <>
            <StepHeading
              title={step3Heading()}
              subtitle={t('onboarding:intro.step3.subtitle')}
            />
            {/* Picking "not yet" also CLEARS the assignment fields, so the side
                effect lives in onValueChange rather than per-card onClick. */}
            <ToggleGroup
              type="single"
              value={housingPath ?? ''}
              onValueChange={(v) => {
                if (v === 'have_assignment') setHousingPath('have_assignment');
                if (v === 'not_yet') {
                  setHousingPath('not_yet');
                  setCurrentDorm('');
                  setCurrentFloor('');
                  setCurrentRoom('');
                  setIsOffCampusCurrent(false);
                  setMoveInDate('');
                }
              }}
              aria-label={t('onboarding:intro.step3.subtitle')}
              className="flex flex-col items-stretch justify-start gap-3"
            >
              <ToggleGroupItem value="have_assignment" className={selectableCardToggleClass}>
                <IconChip tint="green" icon={MapPin} />
                <div className="min-w-0 flex-1">
                  <span className="block font-bold text-foreground">{a.title}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{a.sub}</span>
                </div>
                {housingPath === 'have_assignment' ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-malachite-600" />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded-full border-2 border-border" />
                )}
              </ToggleGroupItem>
              <ToggleGroupItem value="not_yet" className={selectableCardToggleClass}>
                <IconChip tint="violet" icon={Compass} />
                <div className="min-w-0 flex-1">
                  <span className="block font-bold text-foreground">{b.title}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{b.sub}</span>
                </div>
                {housingPath === 'not_yet' ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-malachite-600" />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded-full border-2 border-border" />
                )}
              </ToggleGroupItem>
            </ToggleGroup>
            {housingPath === 'have_assignment' && (
              <div className="mt-5 space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
                <div>
                  <label htmlFor="ob-building" className="mb-1.5 block text-sm font-semibold text-foreground">
                    {t('onboarding:intro.step3.buildingLabel')} <span className="text-red-500">*</span>
                  </label>
                  {isDormOptionsLoading && dormOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('onboarding:intro.step3.loadingBuildings')}</p>
                  ) : dormOptionsError ? (
                    <p className="text-sm text-red-500">{dormOptionsError}</p>
                  ) : (
                    <Select
                      value={
                        isOffCampusCurrent
                          ? OFF_CAMPUS_DORM_SENTINEL
                          : currentDorm && dormOptions.includes(currentDorm)
                            ? currentDorm
                            : undefined
                      }
                      onValueChange={(v) => {
                        if (v === OFF_CAMPUS_DORM_SENTINEL) {
                          setIsOffCampusCurrent(true);
                          setCurrentDorm('');
                          setMoveInDate('');
                        } else {
                          setIsOffCampusCurrent(false);
                          setCurrentDorm(v);
                        }
                      }}
                    >
                      <SelectTrigger id="ob-building" data-testid="onboarding-building-select" className="h-12 rounded-xl border-border bg-card">
                        <SelectValue placeholder={t('onboarding:intro.step3.buildingPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 bg-popover border-border">
                        {dormOptions.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                        <SelectItem value={OFF_CAMPUS_DORM_SENTINEL}>
                          {t('onboarding:intro.step3.offCampus')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {isOffCampusCurrent && (
                    <Input
                      id="ob-building-fallback"
                      value={currentDorm}
                      onChange={(e) => setCurrentDorm(e.target.value)}
                      placeholder={t('onboarding:intro.step3.offCampusPlaceholder')}
                      className="mt-2 h-12 rounded-xl border-border bg-card"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ob-floor" className="mb-1.5 block text-sm font-semibold text-foreground">
                      {t('onboarding:intro.step3.floorLabel')} <span className="font-normal text-muted-foreground">{t('onboarding:intro.step3.optional')}</span>
                    </label>
                    <Input
                      id="ob-floor"
                      value={currentFloor}
                      onChange={(e) => setCurrentFloor(e.target.value)}
                      placeholder={t('onboarding:intro.step3.floorPlaceholder')}
                      className="h-12 rounded-xl border-border bg-card"
                    />
                  </div>
                  <div>
                    <label htmlFor="ob-room" className="mb-1.5 block text-sm font-semibold text-foreground">
                      {t('onboarding:intro.step3.roomLabel')} <span className="font-normal text-muted-foreground">{t('onboarding:intro.step3.optional')}</span>
                    </label>
                    <Input
                      id="ob-room"
                      value={currentRoom}
                      onChange={(e) => setCurrentRoom(e.target.value)}
                      placeholder={t('onboarding:intro.step3.roomPlaceholder')}
                      className="h-12 rounded-xl border-border bg-card"
                    />
                  </div>
                </div>
                {!isOffCampusCurrent && currentDorm.trim() !== '' && (
                  <div>
                    <label htmlFor="ob-move-in" className="mb-1.5 block text-sm font-semibold text-foreground">
                      {t('onboarding:intro.step3.moveInDateLabel')} <span className="font-normal text-muted-foreground">{t('onboarding:intro.step3.optional')}</span>
                    </label>
                    <Input
                      id="ob-move-in"
                      data-testid="onboarding-move-in-date-input"
                      type="date"
                      value={moveInDate}
                      onChange={(e) => setMoveInDate(e.target.value)}
                      className="h-12 rounded-xl border-border bg-card"
                    />
                  </div>
                )}
              </div>
            )}
            <div className="mt-8 flex flex-col gap-3">
              <Button
                type="button"
                onClick={() => void handleContinue3()}
                disabled={!housingPath || saving || (housingPath === 'have_assignment' && !currentDorm.trim())}
                className={PRIMARY_BTN}
              >
                {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : t('common:actions.continue')}
              </Button>
              <BackButton onClick={handleBack3} />
            </div>
          </>
        );
      }
      case 4:
        return (
          <>
            <StepHeading
              title={t('onboarding:intro.step4.title')}
              subtitle={t('onboarding:intro.step4.subtitle')}
            />
            {/* Multi-select, so `type="multiple"` — Radix hands back the whole
                next selection, which replaces the per-card toggleNeed() flip. */}
            <ToggleGroup
              type="multiple"
              value={selectedNeeds}
              onValueChange={setSelectedNeeds}
              aria-label={t('onboarding:intro.step4.subtitle')}
              className="flex flex-col items-stretch justify-start gap-3"
            >
              {visibleNeedOptions.map((opt, i) => {
                const on = selectedNeeds.includes(opt.id);
                return (
                  <ToggleGroupItem
                    key={opt.id}
                    value={opt.id}
                    className={cn(selectableCardToggleClass, 'animate-fade-in')}
                    style={staggerStyle(i)}
                  >
                    <IconChip tint={opt.tint} icon={opt.icon} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-foreground">{t(opt.titleKey)}</p>
                      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{t(opt.descKey)}</p>
                    </div>
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                        on ? 'border-malachite-600 bg-malachite-800 text-white' : 'border-border bg-card'
                      )}
                    >
                      {on && <Check className="!h-4 !w-4" strokeWidth={3} />}
                    </div>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            {wantsRoommate && (
              <div className="mt-5 animate-fade-in space-y-5 rounded-2xl border border-border bg-muted/40 p-4">
                <p className="text-sm font-bold text-foreground">
                  {t('onboarding:intro.step5.title')}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('onboarding:intro.step3.optional')}
                  </span>
                </p>
                {renderPillRow('onboarding:intro.step5.sleepScheduleLabel', sleepSchedule, setSleepSchedule, [
                  'onboarding:intro.step5.sleepSchedule.earlyBird',
                  'onboarding:intro.step5.sleepSchedule.nightOwl',
                  'onboarding:intro.step5.sleepSchedule.flexible',
                ])}
                {renderPillRow('onboarding:intro.step5.cleanlinessLabel', cleanliness, setCleanliness, [
                  'onboarding:intro.step5.cleanliness.veryTidy',
                  'onboarding:intro.step5.cleanliness.moderate',
                  'onboarding:intro.step5.cleanliness.relaxed',
                ])}
                {renderPillRow('onboarding:intro.step5.socialLevelLabel', socialLevel, setSocialLevel, [
                  'onboarding:intro.step5.socialLevel.homebody',
                  'onboarding:intro.step5.socialLevel.balanced',
                  'onboarding:intro.step5.socialLevel.verySocial',
                ])}
                {renderPillRow('onboarding:intro.step5.studyStyleLabel', studyStyle, setStudyStyle, [
                  'onboarding:intro.step5.studyStyle.library',
                  'onboarding:intro.step5.studyStyle.inMyRoom',
                  'onboarding:intro.step5.studyStyle.anywhere',
                ])}
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                  {/* Was a hand-rolled role="switch" button + thumb span; Switch
                      is the same 6x11 track, with the checked state owned by
                      Radix. Only the unchecked track colour is pinned to the
                      previous value. */}
                  <Switch
                    aria-label={t('onboarding:intro.step5.showProfileAriaLabel')}
                    checked={showProfileToRoommates}
                    onCheckedChange={setShowProfileToRoommates}
                    className="mt-0.5 data-[state=unchecked]:bg-muted-foreground/30"
                  />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t('onboarding:intro.step5.showProfileLabel')}</p>
                    <p className="text-xs text-muted-foreground">{t('onboarding:intro.step5.showProfileHint')}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-8 flex flex-col gap-3">
              <Button
                type="button"
                onClick={() => void handleContinue4()}
                disabled={saving}
                className={PRIMARY_BTN}
              >
                {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : t('common:actions.continue')}
              </Button>
              <SkipLink onClick={handleSkip4} />
              <BackButton onClick={handleBack4} />
            </div>
          </>
        );
      case 5: {
        const availableActionIds = visibleActionLinkIds;
        // Surface every feature so users discover the app - interests they picked come first.
        const selectedAvailable = selectedNeeds.filter((id) => availableActionIds.includes(id));
        const cardsToShow = [
          ...selectedAvailable,
          ...availableActionIds.filter((id) => !selectedAvailable.includes(id)),
        ];
        const intentLabel = getUserIntentOptions().find((o) => o.id === userIntent)?.titleKey
          ? t(getUserIntentOptions().find((o) => o.id === userIntent)?.titleKey ?? '')
          : t('onboarding:intro.step6.defaultIntentLabel');
        const housingLabel =
          housingPath === 'have_assignment' && currentDorm.trim()
            ? `${currentDorm}${currentFloor ? `, fl ${currentFloor}` : ''}${currentRoom ? `, rm ${currentRoom}` : ''}`
            : housingPath === 'not_yet'
              ? t('onboarding:intro.step6.stillDeciding')
              : '-';
        const interestLabel = selectedNeeds.length
          ? visibleNeedOptions
              .filter((n) => selectedNeeds.includes(n.id))
              .map((n) => t(n.titleKey))
              .join(', ')
          : t('onboarding:intro.step6.exploringEverything');
        return (
          <>
            <div className="mb-6 animate-fade-in text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 animate-scale-in items-center justify-center rounded-2xl bg-malachite-600/12">
                <span className="text-3xl">🎉</span>
              </div>
              <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight text-foreground">
                <Trans
                  i18nKey={firstName ? 'onboarding:intro.step6.titleWithName' : 'onboarding:intro.step6.title'}
                  values={{ name: firstName }}
                />
              </h1>
              <p className="mt-2 text-[15px] leading-snug text-muted-foreground">
                {t('onboarding:intro.step6.subtitle')}
              </p>
            </div>

            {/* Personalized setup summary - branded, not grey */}
            <div className="rounded-2xl border border-malachite-600/20 bg-malachite-600/[0.06] p-4">
              <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <Sparkles className="h-4 w-4 text-malachite-600" />
                {t('onboarding:intro.step6.yourSetupLabel')}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t('onboarding:intro.step6.goalLabel')}</span>
                  <span className="text-right font-semibold text-foreground">{intentLabel}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t('onboarding:intro.step6.housingLabel')}</span>
                  <span className="text-right font-semibold text-foreground">{housingLabel}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t('onboarding:intro.step6.interestsLabel')}</span>
                  <span className="text-right font-semibold text-foreground">{interestLabel}</span>
                </div>
              </div>
            </div>

            <p className="mb-3 mt-6 text-sm font-bold text-foreground">{t('onboarding:intro.step6.jumpInLabel')}</p>
            <div className="flex flex-col gap-3">
              {cardsToShow.map((id) => {
                const links = getActionLinks();
                const cfg = links[id as keyof typeof links];
                if (!cfg) return null;
                const recommended = selectedAvailable.includes(id);
                return (
                  <Button
                    key={id}
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void completeOnboarding(cfg.href)}
                    className="flex h-auto w-full items-center justify-start gap-4 rounded-2xl border-2 border-border bg-card p-4 text-left font-normal transition-all hover:border-malachite-600/40 hover:bg-card hover:shadow-overlay active:scale-[0.99] disabled:opacity-50 [&_svg]:size-6"
                  >
                    <IconChip tint={cfg.tint} icon={cfg.icon} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-bold text-foreground">
                        {t(cfg.titleKey)}
                        {recommended && (
                          <span className="rounded-full bg-malachite-600/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-malachite-800">
                            {t('onboarding:intro.step6.forYouBadge')}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{t(cfg.descKey)}</p>
                    </div>
                    <ArrowRight className="!h-5 !w-5 shrink-0 !text-muted-foreground" />
                  </Button>
                );
              })}
            </div>
            <div className="mt-8 flex flex-col gap-3">
              <Button
                type="button"
                onClick={() => void completeOnboarding()}
                disabled={saving}
                className={PRIMARY_BTN}
              >
                {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : t('onboarding:intro.step6.enterDormCheck')}
              </Button>
              <BackButton onClick={handleBack5} />
            </div>
          </>
        );
      }
      default:
        return null;
    }
  };

  // The profile name and tenant feature flags both affect Step 1's copy and
  // option count. Painting before either is resolved makes the heading rewrap
  // and inserts/removes a full option card after first paint (CLS ~0.17). Keep
  // the full-screen canvas stable until the first meaningful onboarding frame
  // can be rendered once with its final geometry.
  if (!flagsResolved || !profileLoaded) {
    return (
      <div
        aria-busy="true"
        className="h-[100dvh] w-full overflow-hidden bg-background"
      >
        <span className="sr-only">{t('common:state.loading')}</span>
      </div>
    );
  }

  const displayStep = transition ? transition.from : step;
  const progressStep = transition ? transition.from : step;

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background pt-[max(3rem,env(safe-area-inset-top))]">
      <div className="fixed left-0 right-0 top-[max(3rem,env(safe-area-inset-top))] z-[101] h-1.5 bg-muted">
        <div
          className="h-full rounded-r-full bg-malachite-600 transition-all duration-500 ease-out"
          style={{ width: `${progressPercent(progressStep)}%` }}
        />
      </div>

      <PageContainer width="narrow" className="relative flex min-h-0 flex-1 flex-col px-6 pt-4">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-malachite-600/12">
              <img src="/logo-dormcheck-brand.png" alt="DormCheck" className="h-6 w-6 object-contain" />
            </div>
            <span className="brand-wordmark text-base">DormCheck</span>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            <Trans
              i18nKey="onboarding:intro.stepIndicator"
              values={{ current: progressStep, total: TOTAL_STEPS }}
            />
          </span>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {transition ? (
            <>
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 z-0 w-full',
                  STEP_SCROLL_CLASS,
                  transition.dir === 'forward' ? 'animate-slide-out-left' : 'animate-slide-out-right'
                )}
              >
                {renderStepBody(transition.from)}
              </div>
              <div
                className={cn(
                  'absolute inset-0 z-10 w-full',
                  STEP_SCROLL_CLASS,
                  transition.dir === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'
                )}
              >
                {renderStepBody(transition.to)}
              </div>
            </>
          ) : (
            <div className={STEP_SCROLL_CLASS}>{renderStepBody(displayStep)}</div>
          )}
        </div>
      </PageContainer>
    </div>
  );
};

export default OnboardingIntro;
