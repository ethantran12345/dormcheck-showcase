import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, Loader2, Phone, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeText, sanitizeOptional } from '@/lib/sanitize';
import { ImageRejectedError, uploadAndScreen } from '@/lib/imageModeration';
import { AvatarUpload } from '@/components/profile/AvatarUpload';
import { CommunityCard } from '@/components/my-home/CommunityCard';
import { BasicsFields } from '@/components/profile/BasicsFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { InstagramLogo, SnapchatLogo } from '@/components/roommate/SocialLogos';
import {
  SettingsCardGroup,
  SettingsRow,
  SETTINGS_INLINE_CONTROL_CLASS,
} from '@/components/settings/SettingsSectionShell';
import { cn } from '@/lib/utils';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { toast } from 'sonner';
import {
  RoommateProfileForm,
  type RoommateProfileFormValues,
} from '@/components/roommate/RoommateProfileForm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INTEREST_CATEGORIES, MAX_INTERESTS, interestLabel } from '@/lib/interestOptions';
import {
  ROOMMATE_PROMPT_OPTIONS,
  MAX_PROMPTS,
  roommatePromptLabel,
  type ProfilePrompt,
} from '@/lib/roommatePrompts';

// Internal signal tags (e.g. `onboarding_interest:gaming`) are stored alongside
// user-entered habits in profiles.tags. They must never render as editable Habit
// chips - filtered out for display the same way RoommateCard / RoommateDetailModal
// do, while staying in the saved array so the signal is preserved.
const ONBOARDING_TAG_PREFIX = 'onboarding_interest:';

const defaultRoommateValues: RoommateProfileFormValues = {
  bio: '',
  tags: [],
  instagramUsername: '',
  snapchatUsername: '',
  phoneNumber: '',
  profilePhotos: [],
  cleanliness: null,
  social_level: null,
  study_style: null,
  guests: null,
  sleep: null,
  smoking: null,
  temp: null,
  conflict_style: null,
  dealbreakers: [],
  interests: [],
  prompts: [],
};

/** Collapsible profile section. Radix Trigger is a real <button> - keyboard
 *  operable and exposes aria-expanded, with the chevron following its state. */
function ProfileSection({
  title,
  description,
  open,
  onOpenChange,
  collapsible = true,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When false, drop the accordion entirely (no trigger/chevron/description) and
   *  render the children flat. The Settings Profile (flat/Mercury) uses this - the
   *  child field group supplies its own small-caps label, so the section header
   *  here would be redundant chrome. */
  collapsible?: boolean;
  children: ReactNode;
}) {
  if (!collapsible) {
    return <div className="space-y-3">{children}</div>;
  }
  // Bevel structure: a plain section header (title + description on the page
  // background, NOT a card) with its grouped cards flowing below. The cards live
  // in `children`, so the header is never a card-around-a-card.
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="space-y-3">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

interface ProfileEditFieldsProps {
  /** Called after a successful save (e.g. close the modal). Default: stay in place. */
  onSaved?: () => void;
  /** Overrides the default navigate('/my-home?openHousing=true'). */
  onEditHousing?: () => void;
  /** Called after the roommate profile is cleared. Default: stay in place. */
  onDeletedProfile?: () => void;
  /**
   * Mercury flat layout for the Settings → Profile surface: the Basics identity
   * set renders as a borderless hairline-divided list under a small-caps label
   * (no collapsible accordion, no "essentials" subtitle). Only `SettingsProfile`
   * passes this; the Roommate modal, onboarding, and ProfilePage keep the card +
   * accordion. Defaults false so those surfaces are untouched.
   */
  flat?: boolean;
}

export function ProfileEditFields({ onSaved, onEditHousing, onDeletedProfile, flat = false }: ProfileEditFieldsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { showRoommates } = useFeatureFlags();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [major, setMajor] = useState('');
  const [school, setSchool] = useState('');
  const [gradeLevel, setGradeLevel] = useState<string>('');
  const [graduationYear, setGraduationYear] = useState('');
  const [graduationSemester, setGraduationSemester] = useState<'Spring' | 'Fall'>('Spring');
  const [roommateValues, setRoommateValues] =
    useState<RoommateProfileFormValues>(defaultRoommateValues);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isRoommateSearching, setIsRoommateSearching] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingAvatarPreviewUrl, setPendingAvatarPreviewUrl] = useState<string | null>(null);
  const [venmoUsername, setVenmoUsername] = useState('');
  const [zelleInfo, setZelleInfo] = useState('');
  const [housingInfo, setHousingInfo] = useState<{
    current_dorm: string | null;
    current_floor: string | null;
    current_room: string | null;
    housing_type: string | null;
  }>({ current_dorm: null, current_floor: null, current_room: null, housing_type: null });

  // Section disclosure: Basics is the fast get-on-the-app set (open by default);
  // roommate matching + contact/payments are optional depth (collapsed).
  const [basicsOpen, setBasicsOpen] = useState(true);
  const [roommateOpen, setRoommateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const [habitInput, setHabitInput] = useState('');

  const email = user?.email ?? '';

  useEffect(() => {
    if (!pendingFile) {
      setPendingAvatarPreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(pendingFile);
    setPendingAvatarPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pendingFile]);

  useEffect(() => {
    if (!user?.id) return;

    const fetchProfile = async () => {
      setProfileLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'full_name, avatar_url, pronouns, major, school, grade_level, graduation_year, graduation_semester, bio, tags, instagram_username, snapchat_username, phone_number, venmo_username, zelle_info, profile_photos, cleanliness, social_level, study_style, guests, sleep, smoking, temp, conflict_style, dealbreakers, is_public, is_roommate_searching, current_dorm, current_floor, current_room, housing_type, interests, prompts'
          )
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;
        const r = data as Record<string, unknown> | null;
        if (r) {
          setFullName((r.full_name as string) ?? '');
          setPronouns((r.pronouns as string) ?? '');
          setAvatarUrl((r.avatar_url as string | null) ?? null);
          setMajor((r.major as string) ?? '');
          setSchool((r.school as string) ?? '');
          setGradeLevel((r.grade_level as string) ?? '');
          setGraduationYear((r.graduation_year?.toString() as string) ?? '');
          setGraduationSemester(((r.graduation_semester as string) === 'Fall' ? 'Fall' : 'Spring'));
          setRoommateValues({
            bio: (r.bio as string) ?? '',
            tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
            instagramUsername: (r.instagram_username as string) ?? '',
            snapchatUsername: (r.snapchat_username as string) ?? '',
            phoneNumber: (r.phone_number as string) ?? '',
            profilePhotos: (Array.isArray(r.profile_photos) ? (r.profile_photos as string[]) : []).map((url) => ({ type: 'url' as const, url })),
            cleanliness: (r.cleanliness as string | null) ?? null,
            social_level: (r.social_level as string | null) ?? null,
            study_style: (r.study_style as string | null) ?? null,
            guests: (r.guests as string | null) ?? null,
            sleep: (r.sleep as string | null) ?? null,
            smoking: (r.smoking as string | null) ?? null,
            temp: (r.temp as string | null) ?? null,
            conflict_style: (r.conflict_style as string | null) ?? null,
            dealbreakers: Array.isArray(r.dealbreakers) ? (r.dealbreakers as string[]) : [],
            interests: Array.isArray(r.interests) ? (r.interests as string[]) : [],
            prompts: Array.isArray(r.prompts)
              ? (r.prompts as ProfilePrompt[]).filter(
                  (p) => p && typeof p.prompt === 'string' && typeof p.answer === 'string',
                )
              : [],
          });
          setIsRoommateSearching(Boolean((r.is_roommate_searching ?? r.is_public) ?? false));
          setVenmoUsername((r.venmo_username as string) ?? '');
          setZelleInfo((r.zelle_info as string) ?? '');
          setHousingInfo({
            current_dorm: (r.current_dorm as string | null) ?? null,
            current_floor: (r.current_floor as string | null) ?? null,
            current_room: (r.current_room as string | null) ?? null,
            housing_type: (r.housing_type as string | null) ?? null,
          });
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
        toast.error(t('common:toast.genericError'));
      } finally {
        setProfileLoading(false);
      }
    };

    void fetchProfile();
  }, [user?.id]);

  const handleEditHousing = () => {
    if (onEditHousing) {
      onEditHousing();
      return;
    }
    navigate('/my-home?openHousing=true');
  };

  const invalidateProfileQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile_me'] }),
      queryClient.invalidateQueries({ queryKey: ['profile_identity'] }),
      queryClient.invalidateQueries({ queryKey: ['native_top_bar_profile'] }),
      queryClient.invalidateQueries({ queryKey: ['profile_me_roommate_flag'] }),
      queryClient.invalidateQueries({ queryKey: ['profiles_feed'] }),
      queryClient.invalidateQueries({ queryKey: ['profiles'] }),
      queryClient.invalidateQueries({ queryKey: ['checklist-settlement-context'] }),
    ]);

  // Habits (profiles.tags): internal onboarding_interest: signals stay in the
  // saved array but never surface as editable chips.
  const visibleHabits = roommateValues.tags.filter((tag) => !tag.startsWith(ONBOARDING_TAG_PREFIX));
  const addHabit = () => {
    const trimmed = habitInput.trim();
    if (!trimmed || roommateValues.tags.includes(trimmed)) return;
    setRoommateValues((v) => ({ ...v, tags: [...v.tags, trimmed] }));
    setHabitInput('');
  };
  const removeHabit = (tag: string) => {
    setRoommateValues((v) => ({ ...v, tags: v.tags.filter((x) => x !== tag) }));
  };

  // Interests: capped multi-select from a fixed taxonomy - a SEPARATE dimension
  // from habit tags (never collides with the onboarding_interest: namespace).
  const selectedInterests = roommateValues.interests;
  const toggleInterest = (slug: string) => {
    setRoommateValues((v) => {
      if (v.interests.includes(slug)) {
        return { ...v, interests: v.interests.filter((s) => s !== slug) };
      }
      if (v.interests.length >= MAX_INTERESTS) {
        toast.error(t('roommates:profileForm.interestsCapReached', { max: MAX_INTERESTS }));
        return v;
      }
      return { ...v, interests: [...v.interests, slug] };
    });
  };

  // Prompts: up to MAX_PROMPTS answered { prompt, answer } pairs.
  const usedPrompts = new Set(roommateValues.prompts.map((p) => p.prompt));
  const addPrompt = () => {
    if (roommateValues.prompts.length >= MAX_PROMPTS) return;
    const next = ROOMMATE_PROMPT_OPTIONS.find((p) => !usedPrompts.has(p));
    if (!next) return;
    setRoommateValues((v) => ({ ...v, prompts: [...v.prompts, { prompt: next, answer: '' }] }));
  };
  const updatePromptChoice = (index: number, prompt: string) => {
    setRoommateValues((v) => ({
      ...v,
      prompts: v.prompts.map((p, i) => (i === index ? { ...p, prompt } : p)),
    }));
  };
  const updatePromptAnswer = (index: number, answer: string) => {
    setRoommateValues((v) => ({
      ...v,
      prompts: v.prompts.map((p, i) => (i === index ? { ...p, answer } : p)),
    }));
  };
  const removePrompt = (index: number) => {
    setRoommateValues((v) => ({ ...v, prompts: v.prompts.filter((_, i) => i !== index) }));
  };

  const handleSave = async () => {
    if (!user?.id) return;

    // Trimmed required set: a usable profile needs a name plus at least one of
    // major / school / housing. Everything else is optional.
    if (!fullName.trim()) {
      toast.error(t('profileFields.nameRequired'));
      setBasicsOpen(true);
      return;
    }
    if (!major.trim() && !school.trim() && !housingInfo.current_dorm) {
      toast.error(t('profileFields.identityRequired'));
      setBasicsOpen(true);
      return;
    }

    setSaving(true);
    try {
      let newAvatarUrl: string | null = avatarUrl;

      // Avatar and profile photos are screened BEFORE the profile row is written.
      // An avatar is the single most-likely path for an image of a real person to
      // arrive, and it renders next to this user's name on every surface they
      // touch, so a refusal has to abort the whole save rather than quietly drop
      // the photo: `uploadAndScreen` deletes the object and throws, and the outer
      // catch reports it.
      if (pendingFile) {
        const ext = pendingFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        newAvatarUrl = await uploadAndScreen({
          bucket: 'avatars',
          path: `${user.id}/${Date.now()}.${ext}`,
          file: pendingFile,
          context: 'profile_photo',
          contentId: user.id,
          upload: {
            cacheControl: '3600',
            upsert: false,
            contentType: pendingFile.type || (ext === 'png' ? 'image/png' : 'image/jpeg'),
          },
        });
      }

      const parsedYear = graduationYear.trim() ? parseInt(graduationYear, 10) : NaN;

      // Contact + about-you fields live in Basics / Contact sections and save for
      // every user (not just roommate-seekers).
      const contactPayload: Record<string, unknown> = {
        bio: sanitizeOptional(roommateValues.bio),
        tags:
          roommateValues.tags.length > 0
            ? roommateValues.tags.map(sanitizeText).filter(Boolean)
            : null,
        instagram_username: sanitizeOptional(roommateValues.instagramUsername),
        snapchat_username: sanitizeOptional(roommateValues.snapchatUsername),
        phone_number: sanitizeOptional(roommateValues.phoneNumber),
        interests: roommateValues.interests.length > 0 ? roommateValues.interests : null,
        prompts:
          roommateValues.prompts.filter((p) => p.answer.trim()).length > 0
            ? roommateValues.prompts
                .filter((p) => p.answer.trim())
                .map((p) => ({ prompt: p.prompt, answer: sanitizeText(p.answer) }))
            : null,
      };

      // Roommate-matching fields (photos, compatibility, boundaries, visibility)
      // only save when the roommate section is available.
      let roommatePayload: Record<string, unknown> = {};
      if (showRoommates) {
        const profilePhotosPath = `${user.id}/profile-photos`;
        const finalProfilePhotos: string[] = [];
        for (const item of roommateValues.profilePhotos ?? []) {
          if (item.type === 'url') {
            finalProfilePhotos.push(item.url);
          } else {
            const ext = item.file.name.split('.').pop()?.toLowerCase() || 'jpg';
            // A refusal throws instead of being swallowed the way a plain upload
            // error used to be: silently dropping the photo would save a profile
            // the user believes contains it.
            finalProfilePhotos.push(
              await uploadAndScreen({
                bucket: 'avatars',
                path: `${profilePhotosPath}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
                file: item.file,
                context: 'profile_photo',
                contentId: user.id,
                upload: {
                  cacheControl: '3600',
                  upsert: false,
                  contentType: item.file.type || (ext === 'png' ? 'image/png' : 'image/jpeg'),
                },
              }),
            );
          }
        }
        const profilePhotosToSave = finalProfilePhotos.slice(0, 5);
        roommatePayload = {
          profile_photos: profilePhotosToSave.length > 0 ? profilePhotosToSave : null,
          cleanliness: roommateValues.cleanliness || null,
          social_level: roommateValues.social_level || null,
          study_style: roommateValues.study_style || null,
          guests: roommateValues.guests || null,
          sleep: roommateValues.sleep || null,
          smoking: roommateValues.smoking || null,
          temp: roommateValues.temp || null,
          conflict_style: roommateValues.conflict_style || null,
          dealbreakers:
            roommateValues.dealbreakers.length > 0 ? roommateValues.dealbreakers : null,
          is_public: isRoommateSearching,
          is_roommate_searching: isRoommateSearching,
        };
      }

      const { error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: user.id,
            full_name: sanitizeOptional(fullName),
            pronouns: sanitizeOptional(pronouns),
            avatar_url: newAvatarUrl,
            email: user.email ?? undefined,
            major: sanitizeOptional(major),
            school: sanitizeOptional(school),
            grade_level: sanitizeOptional(gradeLevel),
            graduation_year: !isNaN(parsedYear) ? parsedYear : null,
            graduation_semester: graduationSemester,
            venmo_username: sanitizeOptional(venmoUsername),
            zelle_info: sanitizeOptional(zelleInfo),
            ...contactPayload,
            ...roommatePayload,
          },
          { onConflict: 'id' }
        );

      if (error) throw error;

      setAvatarUrl(newAvatarUrl);
      setPendingFile(null);
      await invalidateProfileQueries();
      toast.success(t('common:toast.saved'));
      onSaved?.();
    } catch (err) {
      console.error('Failed to save profile:', err);
      // A blocked photo needs its own sentence: "couldn't save" would send the
      // user back to press Save on the same rejected image.
      if (err instanceof ImageRejectedError) toast.error(err.message);
      else toast.error(t('common:toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const displayAvatarUrl = pendingAvatarPreviewUrl ?? avatarUrl;

  const handleDeleteProfile = async () => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        bio: null,
        tags: null,
        pronouns: null,
        grade_level: null,
        graduation_year: null,
        graduation_semester: null,
        major: null,
        profile_photos: null,
        instagram_username: null,
        snapchat_username: null,
        phone_number: null,
        cleanliness: null,
        social_level: null,
        study_style: null,
        guests: null,
        sleep: null,
        smoking: null,
        temp: null,
        conflict_style: null,
        dealbreakers: null,
      })
      .eq('id', user.id);
    if (error) {
      console.error('Clear roommate profile failed:', error);
      toast.error(t('common:toast.saveError'));
      return;
    }
    await invalidateProfileQueries();
    toast.success(t('profileFields.profileRemoved'));
    onDeletedProfile?.();
  };

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const photoSlot = (
    <div className="flex flex-col items-center">
      <AvatarUpload
        value={displayAvatarUrl}
        onFileSelect={setPendingFile}
        fallbackName={fullName}
      />
      {email && <p className="text-sm text-muted-foreground mt-3">{email}</p>}
    </div>
  );

  const housingSlot = (
    <div className="space-y-2">
      <SettingsCardGroup label={t('profileFields.housingLabel')} divided={false}>
        {/* Full-bleed settings row, so the Button box is flattened to the row's
            own padding and the base's 16px icon rule down to the 14px chevron. */}
        <Button
          type="button"
          variant="ghost"
          onClick={handleEditHousing}
          className="flex h-auto w-full items-center justify-between gap-3 rounded-none p-4 text-left font-normal transition-colors hover:bg-secondary/40 [&_svg]:size-3.5"
        >
          <div className="min-w-0 flex-1">
            {housingInfo.current_dorm ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {housingInfo.current_dorm}
                  {housingInfo.housing_type === 'on-campus' ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t('profileFields.housingOnCampus')}
                    </span>
                  ) : housingInfo.housing_type === 'off-campus' ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-muted text-foreground px-2 py-0.5 text-xs font-medium">
                      {t('profileFields.housingOffCampus')}
                    </span>
                  ) : null}
                </p>
                {(housingInfo.current_floor || housingInfo.current_room) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[
                      housingInfo.current_floor && t('profileFields.floorDisplay', { floor: housingInfo.current_floor }),
                      housingInfo.current_room && t('profileFields.roomDisplay', { room: housingInfo.current_room }),
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('profileFields.housingNotSet')}</p>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
            {housingInfo.current_dorm ? t('profileFields.editHousing') : t('profileFields.setHousing')}
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Button>
      </SettingsCardGroup>
      {/* Persistent door to the building + floor rooms once a dorm is set. */}
      <CommunityCard />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ===== Section 1: Basics (fast get-on-the-app set) ===== */}
      <ProfileSection
        title={t('profileFields.sections.basicsTitle')}
        description={t('profileFields.sections.basicsDescription')}
        open={basicsOpen}
        onOpenChange={setBasicsOpen}
        collapsible={!flat}
      >
        <div className="space-y-6">
          <BasicsFields
            flat={flat}
            idPrefix="settings-profile"
            fullName={fullName}
            onFullNameChange={setFullName}
            pronouns={pronouns}
            onPronounsChange={setPronouns}
            showPronouns
            major={major}
            onMajorChange={setMajor}
            school={school}
            onSchoolChange={setSchool}
            gradeLevel={gradeLevel}
            onGradeLevelChange={setGradeLevel}
            graduationYear={graduationYear}
            onGraduationYearChange={setGraduationYear}
            graduationSemester={graduationSemester}
            onGraduationSemesterChange={setGraduationSemester}
            showGraduationSemester
            required={{ fullName: true }}
            photoSlot={photoSlot}
            housingSlot={housingSlot}
          />

          {/* About you: bio + habits, kept near the top rather than buried in
              roommate-matching depth. Free-form controls (textarea, chip pickers)
              stay full-width inside one labeled card - only short scalar fields
              become inline rows. */}
          <SettingsCardGroup label={t('profileFields.aboutYouTitle')} divided={false} className="space-y-6 p-4">
            <div className="space-y-2">
              <Label htmlFor="profile-bio">{t('roommates:profileForm.bioLabel')}</Label>
              <Textarea
                id="profile-bio"
                value={roommateValues.bio}
                onChange={(e) => setRoommateValues((v) => ({ ...v, bio: e.target.value }))}
                placeholder={t('roommates:profileForm.bioPlaceholder')}
                rows={4}
                maxLength={500}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-xs text-muted-foreground">{roommateValues.bio.length}/500</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-habits">{t('roommates:profileForm.habitsLabel')}</Label>
              <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-background px-3 py-2 min-h-[42px]">
                {visibleHabits.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-muted text-foreground border border-border"
                  >
                    {tag}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeHabit(tag)}
                      className="h-auto w-auto rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
                      aria-label={t('roommates:profileForm.removeHabitAria', { habit: tag })}
                    >
                      <X />
                    </Button>
                  </span>
                ))}
                <div className="inline-flex items-center gap-2 flex-1 min-w-[120px]">
                  <Input
                    id="profile-habits"
                    value={habitInput}
                    onChange={(e) => setHabitInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addHabit();
                      }
                    }}
                    placeholder={t('roommates:profileForm.habitsPlaceholder')}
                    className="flex-1 min-w-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-8 px-0 text-sm rounded-md bg-transparent"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={addHabit}
                    className="h-8 w-8 shrink-0 rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                    aria-label={t('roommates:profileForm.addHabitAria')}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('roommates:profileForm.habitsHelper')}</p>
            </div>

            {/* Interests: capped, category-grouped preset picker (Phase 2). */}
            <div className="space-y-2">
              <Label>{t('roommates:profileForm.interestsLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('roommates:profileForm.interestsHelper', { max: MAX_INTERESTS })}
              </p>
              <div className="space-y-3">
                {INTEREST_CATEGORIES.map((cat) => (
                  <div key={cat.slug} className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">{t(cat.labelKey)}</p>
                    <div className="flex flex-wrap gap-2">
                      {cat.options.map((slug) => {
                        const on = selectedInterests.includes(slug);
                        return (
                          // Stays an aria-pressed Button rather than a
                          // ToggleGroup: selection is capped at MAX_INTERESTS
                          // inside toggleInterest, and the chips are split
                          // across category rows while the value spans all of
                          // them — so the group's value model isn't the row's.
                          <Button
                            key={slug}
                            type="button"
                            variant="outline"
                            onClick={() => toggleInterest(slug)}
                            aria-pressed={on}
                            className={cn(
                              'h-auto rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                              on
                                ? 'border-malachite-600 bg-malachite-600/[0.08] text-malachite-800 hover:bg-malachite-600/[0.08] hover:text-malachite-800'
                                : 'border-border bg-background text-muted-foreground hover:border-malachite-600/40 hover:bg-background hover:text-muted-foreground',
                            )}
                          >
                            {interestLabel(t, slug)}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Prompts: up to MAX_PROMPTS answered { prompt, answer } pairs (Phase 2). */}
            <div className="space-y-2">
              <Label>{t('roommates:profileForm.promptsLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('roommates:profileForm.promptsHelper', { max: MAX_PROMPTS })}
              </p>
              <div className="space-y-3">
                {roommateValues.prompts.map((p, i) => (
                  <div key={i} className="space-y-2 rounded-xl border border-border bg-background p-3">
                    <div className="flex items-center gap-2">
                      <Select value={p.prompt} onValueChange={(val) => updatePromptChoice(i, val)}>
                        <SelectTrigger
                          className="flex-1 rounded-xl border-border"
                          aria-label={t('roommates:profileForm.promptSelectPlaceholder')}
                        >
                          <SelectValue placeholder={t('roommates:profileForm.promptSelectPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {ROOMMATE_PROMPT_OPTIONS.filter(
                            (opt) => opt === p.prompt || !usedPrompts.has(opt),
                          ).map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {roommatePromptLabel(t, opt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePrompt(i)}
                        className="h-8 w-8 shrink-0 rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t('roommates:profileForm.promptRemoveAria')}
                      >
                        <X />
                      </Button>
                    </div>
                    <Textarea
                      value={p.answer}
                      onChange={(e) => updatePromptAnswer(i, e.target.value)}
                      placeholder={t('roommates:profileForm.promptAnswerPlaceholder')}
                      rows={2}
                      maxLength={140}
                      className="rounded-xl border-border bg-background"
                    />
                  </div>
                ))}
                {roommateValues.prompts.length < MAX_PROMPTS && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={addPrompt}
                    className="h-auto gap-1.5 p-0 text-malachite-800 transition-colors hover:bg-transparent hover:text-malachite-900"
                  >
                    <Plus />
                    {t('roommates:profileForm.promptAddButton')}
                  </Button>
                )}
              </div>
            </div>
          </SettingsCardGroup>
        </div>
      </ProfileSection>

      {/* ===== Section 2: Roommate matching (compatibility + boundaries) ===== */}
      {showRoommates && (
        <ProfileSection
          title={t('profileFields.sections.roommateTitle')}
          description={t('profileFields.sections.roommateDescription')}
          open={roommateOpen}
          onOpenChange={setRoommateOpen}
        >
          <SettingsCardGroup divided={false} className="p-4">
            <RoommateProfileForm
              values={roommateValues}
              onChange={setRoommateValues}
              profileId={user?.id ?? null}
              onDeleteProfile={handleDeleteProfile}
              isRoommateSearching={isRoommateSearching}
              onRoommateSearchingChange={setIsRoommateSearching}
              roommateLivePreview={{
                displayName: fullName,
                major,
                gradeLevel,
                graduationYear,
                graduationSemester,
                fallbackAvatarUrl: pendingAvatarPreviewUrl ?? avatarUrl,
              }}
            />
          </SettingsCardGroup>
        </ProfileSection>
      )}

      {/* ===== Section 3: Contact & payments ===== */}
      <ProfileSection
        title={t('profileFields.sections.contactTitle')}
        description={t('profileFields.sections.contactDescription')}
        open={contactOpen}
        onOpenChange={setContactOpen}
      >
        <p className="px-1 text-xs text-muted-foreground">
          {t('roommates:profileForm.socialsTrustHelper')}
        </p>
        <SettingsCardGroup>
          <SettingsRow
            htmlFor="profile-instagram"
            label={
              <span className="flex items-center gap-2">
                <InstagramLogo className="h-4 w-4" />
                {t('roommates:profileForm.instagramLabel')}
              </span>
            }
          >
            <Input
              id="profile-instagram"
              value={roommateValues.instagramUsername}
              onChange={(e) => setRoommateValues((v) => ({ ...v, instagramUsername: e.target.value }))}
              placeholder={t('roommates:profileForm.instagramPlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </SettingsRow>
          <SettingsRow
            htmlFor="profile-snapchat"
            label={
              <span className="flex items-center gap-2">
                <SnapchatLogo className="h-4 w-4" />
                {t('roommates:profileForm.snapchatLabel')}
              </span>
            }
          >
            <Input
              id="profile-snapchat"
              value={roommateValues.snapchatUsername}
              onChange={(e) => setRoommateValues((v) => ({ ...v, snapchatUsername: e.target.value }))}
              placeholder={t('roommates:profileForm.snapchatPlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </SettingsRow>
          <SettingsRow
            htmlFor="profile-phone"
            label={
              <span className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                {t('roommates:profileForm.phoneLabel')}
              </span>
            }
          >
            <Input
              id="profile-phone"
              value={roommateValues.phoneNumber}
              onChange={(e) => setRoommateValues((v) => ({ ...v, phoneNumber: e.target.value }))}
              placeholder={t('roommates:profileForm.phonePlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
            />
          </SettingsRow>
        </SettingsCardGroup>

        <SettingsCardGroup label={t('profileFields.paymentsLabel')}>
          <SettingsRow htmlFor="venmo_username" label={t('profileFields.venmoLabel')}>
            <Input
              id="venmo_username"
              value={venmoUsername}
              onChange={(e) => setVenmoUsername(e.target.value)}
              placeholder={t('profileFields.venmoPlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
              autoComplete="off"
            />
          </SettingsRow>
          <SettingsRow htmlFor="zelle_info" label={t('profileFields.zelleLabel')}>
            <Input
              id="zelle_info"
              value={zelleInfo}
              onChange={(e) => setZelleInfo(e.target.value)}
              placeholder={t('profileFields.zellePlaceholder')}
              className={SETTINGS_INLINE_CONTROL_CLASS}
              autoComplete="off"
            />
          </SettingsRow>
        </SettingsCardGroup>
        <p className="px-1 text-xs text-muted-foreground">{t('profileFields.paymentsHelper')}</p>
      </ProfileSection>

      <Button
        type="button"
        className="w-full min-h-[44px] bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            {t('common:actions.saving')}
          </>
        ) : (
          t('common:actions.save')
        )}
      </Button>
    </div>
  );
}
