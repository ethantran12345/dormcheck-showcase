import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SettingsCardGroup,
  SettingsRow,
  SETTINGS_INLINE_CONTROL_CLASS,
} from '@/components/settings/SettingsSectionShell';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/**
 * Spring/Fall is a two-option segmented control, so it composes ToggleGroup
 * (T3.6) — the raw button pair had no group semantics at all. The item shell
 * flattens toggleVariants' h-10/min-w-10/rounded-md box so the pair still reads
 * as one seamless pill inside the shared border, and states the selected fill
 * through `data-[state=on]`.
 */
const semesterItemClass =
  'h-auto min-w-0 rounded-none bg-muted/50 font-medium text-muted-foreground hover:bg-muted ' +
  'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground';

/**
 * Shared "Basics" identity field set - the single source of truth for the fast
 * get-on-the-app fields (name, major, school, grade, graduation) rendered both
 * in Settings -> Profile (via `ProfileEditFields`, inside its Basics collapsible)
 * and in the first-time `OnboardingIntro` Step 2. Keeping one component means the
 * field set, ordering, grade options, and copy never drift between the two.
 *
 * Presentational + fully controlled: it owns no fetch/save. Each caller passes
 * values, change handlers, which optional fields to show, and a `variant` that
 * tunes input sizing/label weight to match its surface (compact Settings vs the
 * taller onboarding wizard). Copy comes from the `profileFields.*` default
 * namespace so both surfaces read identical labels.
 */

export const GRADE_LEVELS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'] as const;

export type BasicsFieldKey =
  | 'fullName'
  | 'pronouns'
  | 'major'
  | 'school'
  | 'gradeLevel'
  | 'graduationYear';

interface BasicsFieldsProps {
  fullName: string;
  onFullNameChange: (value: string) => void;
  major: string;
  onMajorChange: (value: string) => void;
  school: string;
  onSchoolChange: (value: string) => void;
  gradeLevel: string;
  onGradeLevelChange: (value: string) => void;
  graduationYear: string;
  onGraduationYearChange: (value: string) => void;

  /** Optional identity fields, shown only when their `show*` flag is set. */
  pronouns?: string;
  onPronounsChange?: (value: string) => void;
  graduationSemester?: 'Spring' | 'Fall';
  onGraduationSemesterChange?: (value: 'Spring' | 'Fall') => void;

  showPronouns?: boolean;
  showGraduationSemester?: boolean;
  /** Rendered above the name field (Settings passes the avatar uploader here). */
  photoSlot?: ReactNode;
  /** Rendered between School and Grade (Settings passes the housing widget here). */
  housingSlot?: ReactNode;

  /** Which fields render a required (*) marker. */
  required?: Partial<Record<BasicsFieldKey, boolean>>;
  /** `default` = compact Settings styling; `onboarding` = taller wizard inputs. */
  variant?: 'default' | 'onboarding';
  /**
   * Mercury flat idiom for the Settings → Profile surface: render the identity
   * rows as a borderless hairline-divided list under a small-caps label instead
   * of a floating card. Only the desktop/mobile Settings Profile passes this;
   * onboarding and the Roommate modal keep the card. No effect on `onboarding`.
   */
  flat?: boolean;
  /** Keeps input ids unique across surfaces. */
  idPrefix?: string;
}

export function BasicsFields({
  fullName,
  onFullNameChange,
  major,
  onMajorChange,
  school,
  onSchoolChange,
  gradeLevel,
  onGradeLevelChange,
  graduationYear,
  onGraduationYearChange,
  pronouns = '',
  onPronounsChange,
  graduationSemester = 'Spring',
  onGraduationSemesterChange,
  showPronouns = false,
  showGraduationSemester = false,
  photoSlot,
  housingSlot,
  required,
  variant = 'default',
  flat = false,
  idPrefix = 'basics',
}: BasicsFieldsProps) {
  const { t } = useTranslation();
  const isOnboarding = variant === 'onboarding';

  const inputClass = cn(
    'rounded-xl border-border',
    isOnboarding && 'h-12 focus-visible:ring-malachite-600/30',
  );
  const labelClass = cn('flex items-center', isOnboarding && 'font-semibold');
  const RequiredMark = () => <span className="text-red-500 ml-0.5">*</span>;

  const id = (field: string) => `${idPrefix}-${field}`;

  // Settings (default variant): Bevel-style grouped list - each identity field is
  // an inline row (label left, right-aligned inline control), all in one shadowed
  // card. The onboarding wizard keeps the taller stacked layout below.
  if (!isOnboarding) {
    return (
      <div className="space-y-6">
        {photoSlot}
        <SettingsCardGroup flat={flat} label={flat ? t('profileFields.sections.basicsTitle') : undefined}>
          <SettingsRow label={t('profileFields.nameLabel')} htmlFor={id('full-name')} required={required?.fullName}>
            <Input
              id={id('full-name')}
              value={fullName}
              onChange={(e) => onFullNameChange(e.target.value)}
              placeholder={t('profileFields.namePlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </SettingsRow>

          {showPronouns && (
            <SettingsRow label={t('profileFields.pronounsLabel')} htmlFor={id('pronouns')} required={required?.pronouns}>
              <Input
                id={id('pronouns')}
                value={pronouns}
                onChange={(e) => onPronounsChange?.(e.target.value)}
                placeholder={t('profileFields.pronounsPlaceholder')}
                className={SETTINGS_INLINE_CONTROL_CLASS}
              />
            </SettingsRow>
          )}

          <SettingsRow label={t('profileFields.majorLabel')} htmlFor={id('major')} required={required?.major}>
            <Input
              id={id('major')}
              value={major}
              onChange={(e) => onMajorChange(e.target.value)}
              placeholder={t('profileFields.majorPlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </SettingsRow>

          <SettingsRow label={t('profileFields.schoolLabel')} htmlFor={id('school')} required={required?.school}>
            <Input
              id={id('school')}
              value={school}
              onChange={(e) => onSchoolChange(e.target.value)}
              placeholder={t('profileFields.schoolPlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </SettingsRow>

          <SettingsRow label={t('profileFields.gradeLevelLabel')} htmlFor={id('grade-level')} required={required?.gradeLevel}>
            <Select value={gradeLevel || undefined} onValueChange={onGradeLevelChange}>
              <SelectTrigger
                id={id('grade-level')}
                aria-label={t('profileFields.gradeLevelLabel')}
                className={cn(
                  SETTINGS_INLINE_CONTROL_CLASS,
                  'justify-end gap-1 [&>svg]:shrink-0 [&>svg]:opacity-50 data-[placeholder]:text-muted-foreground',
                )}
              >
                <SelectValue placeholder={t('profileFields.gradeLevelPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {GRADE_LEVELS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {t(`profileFields.grade.${g.toLowerCase()}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow label={t('profileFields.graduationYearLabel')} htmlFor={id('graduation-year')} required={required?.graduationYear}>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Input
                id={id('graduation-year')}
                type="number"
                min={2024}
                max={2035}
                inputMode="numeric"
                value={graduationYear}
                onChange={(e) => onGraduationYearChange(e.target.value)}
                placeholder={t('profileFields.graduationYearPlaceholder')}
                className={cn(SETTINGS_INLINE_CONTROL_CLASS, 'w-16')}
              />
              {showGraduationSemester && (
                <ToggleGroup
                  type="single"
                  value={graduationSemester ?? ''}
                  onValueChange={(v) => v && onGraduationSemesterChange?.(v as 'Spring' | 'Fall')}
                  aria-label={t('profileFields.graduationYearLabel')}
                  className="flex shrink-0 gap-0 overflow-hidden rounded-lg border border-border"
                >
                  <ToggleGroupItem value="Spring" className={cn(semesterItemClass, 'px-2.5 py-1 text-xs')}>
                    {t('profileFields.semester.spring')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="Fall" className={cn(semesterItemClass, 'px-2.5 py-1 text-xs')}>
                    {t('profileFields.semester.fall')}
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
          </SettingsRow>
        </SettingsCardGroup>

        {housingSlot}
      </div>
    );
  }

  return (
    <div className={cn(isOnboarding ? 'space-y-4' : 'space-y-6')}>
      {photoSlot}

      <div className="space-y-2">
        <Label htmlFor={id('full-name')} className={labelClass}>
          {t('profileFields.nameLabel')}
          {required?.fullName && <RequiredMark />}
        </Label>
        <Input
          id={id('full-name')}
          value={fullName}
          onChange={(e) => onFullNameChange(e.target.value)}
          placeholder={t('profileFields.namePlaceholder')}
          className={inputClass}
        />
      </div>

      {showPronouns && (
        <div className="space-y-2">
          <Label htmlFor={id('pronouns')} className={labelClass}>
            {t('profileFields.pronounsLabel')}
            {required?.pronouns && <RequiredMark />}
          </Label>
          <Input
            id={id('pronouns')}
            value={pronouns}
            onChange={(e) => onPronounsChange?.(e.target.value)}
            placeholder={t('profileFields.pronounsPlaceholder')}
            className={inputClass}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={id('major')} className={labelClass}>
          {t('profileFields.majorLabel')}
          {required?.major && <RequiredMark />}
        </Label>
        <Input
          id={id('major')}
          value={major}
          onChange={(e) => onMajorChange(e.target.value)}
          placeholder={t('profileFields.majorPlaceholder')}
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={id('school')} className={labelClass}>
          {t('profileFields.schoolLabel')}
          {required?.school && <RequiredMark />}
        </Label>
        <Input
          id={id('school')}
          value={school}
          onChange={(e) => onSchoolChange(e.target.value)}
          placeholder={t('profileFields.schoolPlaceholder')}
          className={inputClass}
        />
      </div>

      {housingSlot}

      <div className="space-y-2">
        <Label htmlFor={id('grade-level')} className={labelClass}>
          {t('profileFields.gradeLevelLabel')}
          {required?.gradeLevel && <RequiredMark />}
        </Label>
        <Select value={gradeLevel || undefined} onValueChange={onGradeLevelChange}>
          <SelectTrigger id={id('grade-level')} className={inputClass}>
            <SelectValue placeholder={t('profileFields.gradeLevelPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {GRADE_LEVELS.map((g) => (
              <SelectItem key={g} value={g}>
                {t(`profileFields.grade.${g.toLowerCase()}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={id('graduation-year')} className={labelClass}>
          {t('profileFields.graduationYearLabel')}
          {required?.graduationYear && <RequiredMark />}
        </Label>
        <div className="flex gap-2 items-center">
          <Input
            id={id('graduation-year')}
            type="number"
            min={2024}
            max={2035}
            value={graduationYear}
            onChange={(e) => onGraduationYearChange(e.target.value)}
            placeholder={t('profileFields.graduationYearPlaceholder')}
            className={cn(inputClass, 'flex-1')}
          />
          {showGraduationSemester && (
            <ToggleGroup
              type="single"
              value={graduationSemester ?? ''}
              onValueChange={(v) => v && onGraduationSemesterChange?.(v as 'Spring' | 'Fall')}
              aria-label={t('profileFields.graduationYearLabel')}
              className="flex shrink-0 gap-0 overflow-hidden rounded-xl border border-border"
            >
              <ToggleGroupItem value="Spring" className={cn(semesterItemClass, 'px-3 py-2 text-sm')}>
                {t('profileFields.semester.spring')}
              </ToggleGroupItem>
              <ToggleGroupItem value="Fall" className={cn(semesterItemClass, 'px-3 py-2 text-sm')}>
                {t('profileFields.semester.fall')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>
    </div>
  );
}
