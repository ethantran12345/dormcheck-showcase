import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { fieldErrorProps, type ErrorReveal } from '@/lib/formCraft';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GENDER_PREFERENCES,
  INCLUDED_UTILITIES,
  type IncludedUtility,
} from '@/lib/subleases';
import { SubleaseAddressField } from '@/components/marketplace/SubleaseAddressField';
import type { ListingForm } from '@/hooks/useMyListings';

const FOCUS_RING = 'focus-visible:ring-malachite-600 focus-visible:ring-offset-2';

/**
 * The structured half of a sublease post.
 *
 * Every field here is a typed column, and that is the point rather than a
 * convenience: a sublease is the highest scam-value post on the platform, and
 * free prose is where a scam hides. `house_rules` and `additional_rules` at the
 * bottom are the only free text on the whole post, they are explicitly optional,
 * and they are last in the form for the same reason they are last on the card.
 *
 * There is no title field. A sublease's title IS its address
 * (`subleaseTitle()`), so the headline a student reads first cannot be prose.
 */
export function SubleaseFields({
  form,
  setForm,
  reveal,
  buildingError,
  datesError,
  listingUniversityId,
}: {
  form: ListingForm;
  setForm: Dispatch<SetStateAction<ListingForm>>;
  reveal: ErrorReveal;
  buildingError: string | null;
  datesError: string | null;
  /**
   * The LISTING's university, which scopes the building registry. Passed in
   * rather than read from `UniversityContext` here for the reason
   * `MeetupLocationMap` documents: everything spatial on a listing resolves
   * against the listing's school, not the viewer's. At create time the composer
   * hands us the poster's, which is the same thing — until it isn't.
   */
  listingUniversityId: string | undefined;
}) {
  const { t } = useTranslation();
  const utilities = form.included_utilities ?? [];

  const toggleUtility = (u: IncludedUtility) =>
    setForm((f) => {
      const current = f.included_utilities ?? [];
      return {
        ...f,
        included_utilities: current.includes(u)
          ? current.filter((x) => x !== u)
          : [...current, u],
      };
    });

  return (
    <div className="space-y-5">
      {/* ADDRESS, and it is the only way to say where — there is no picker to
          fail and no "not listed" branch to fall into. The registry survives as
          autocomplete inside this field (`SubleaseAddressField`): it offers a
          known building's street address so two listers are likelier to type the
          same string, and records `building_id` when one is taken. Neither is
          required, and neither decides whether the listing pins. What the address
          buys is a geocode at submit; what keeps a wrong pin off the map is the
          geocoder's campus-radius guard, not this field. */}
      <div>
        <Label htmlFor="mp-sublease-address">
          {t('marketplace:sublease.address')} <span className="text-destructive">*</span>
        </Label>

        <SubleaseAddressField
          id="mp-sublease-address"
          universityId={listingUniversityId}
          value={form.building_name ?? ''}
          {...reveal.blurProps('building_name')}
          {...fieldErrorProps('mp-sublease-address', buildingError)}
          onChange={(building_name) =>
            // Typing away from a suggestion drops the enrichment with it: a
            // `building_id` left behind would point at a building the address no
            // longer names. Coordinates are NOT cleared here — they are rewritten
            // wholesale by the geocode at submit, which is the only thing allowed
            // to set them.
            setForm((f) => ({ ...f, building_name, building_id: null }))
          }
          onPick={(building_name, building) =>
            setForm((f) => ({ ...f, building_name, building_id: building.id }))
          }
        />

        {/* States what the address is FOR, before it is used, because it is about
            to be published on a map. Muted rather than a warning: this is the
            feature working, and the Privacy Policy says the same thing. */}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('marketplace:sublease.addressNote')}
        </p>

        <FieldError fieldId="mp-sublease-address" message={buildingError} className="mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="mp-sublease-start">
            {t('marketplace:sublease.start')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="mp-sublease-start"
            type="date"
            value={form.sublease_start ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, sublease_start: e.target.value }))}
            {...reveal.blurProps('sublease_dates')}
            className={cn('mt-1', FOCUS_RING)}
          />
        </div>
        <div>
          <Label htmlFor="mp-sublease-end">
            {t('marketplace:sublease.end')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="mp-sublease-end"
            type="date"
            value={form.sublease_end ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, sublease_end: e.target.value }))}
            {...reveal.blurProps('sublease_dates')}
            {...fieldErrorProps('mp-sublease-end', datesError)}
            className={cn('mt-1', FOCUS_RING)}
          />
        </div>
      </div>
      <FieldError fieldId="mp-sublease-end" message={datesError} className="-mt-3" />

      <fieldset>
        <legend className="text-sm font-medium text-foreground">
          {t('marketplace:sublease.utilities')}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {INCLUDED_UTILITIES.map((u) => {
            const on = utilities.includes(u);
            return (
              <Button
                key={u}
                type="button"
                variant="outline"
                size="sm"
                haptic="selection"
                aria-pressed={on}
                onClick={() => toggleUtility(u)}
                className={cn(
                  'h-8 shrink-0 rounded-pill px-3 text-xs font-medium',
                  on
                    ? 'border-foreground bg-muted text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {t(`marketplace:sublease.utility.${u}`)}
              </Button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between">
        <Label htmlFor="mp-sublease-furnished">{t('marketplace:sublease.furnished')}</Label>
        <Switch
          id="mp-sublease-furnished"
          checked={!!form.is_furnished}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, is_furnished: checked }))}
          className="data-[state=checked]:bg-malachite-600 dark:data-[state=checked]:bg-malachite-500"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="mp-sublease-parking">{t('marketplace:sublease.parking')}</Label>
        <Switch
          id="mp-sublease-parking"
          checked={!!form.has_parking}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, has_parking: checked }))}
          className="data-[state=checked]:bg-malachite-600 dark:data-[state=checked]:bg-malachite-500"
        />
      </div>

      <div>
        <Label htmlFor="mp-sublease-gender">{t('marketplace:sublease.genderPreference')}</Label>
        <Select
          value={form.gender_preference ?? 'any'}
          onValueChange={(v) => setForm((f) => ({ ...f, gender_preference: v }))}
        >
          <SelectTrigger id="mp-sublease-gender" className={cn('mt-1', FOCUS_RING)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GENDER_PREFERENCES.map((g) => (
              <SelectItem key={g} value={g}>
                {t(`marketplace:sublease.gender.${g}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Last in the form, last on the card, and the only free text on either.
          Labelled optional so nothing pushes a lister to fill prose into the
          slot the structured fields above are meant to answer. */}
      <div className="border-t border-border pt-4">
        <Label htmlFor="mp-sublease-house-rules">
          {t('marketplace:sublease.houseRules')} ({t('common:form.optional')})
        </Label>
        <Textarea
          id="mp-sublease-house-rules"
          value={form.house_rules ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, house_rules: e.target.value }))}
          placeholder={t('marketplace:sublease.houseRulesPlaceholder')}
          rows={3}
          className={cn('mt-1', FOCUS_RING)}
        />
      </div>

      <div>
        <Label htmlFor="mp-sublease-additional-rules">
          {t('marketplace:sublease.additionalRules')} ({t('common:form.optional')})
        </Label>
        <Textarea
          id="mp-sublease-additional-rules"
          value={form.additional_rules ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, additional_rules: e.target.value }))}
          placeholder={t('marketplace:sublease.additionalRulesPlaceholder')}
          rows={2}
          className={cn('mt-1', FOCUS_RING)}
        />
      </div>
    </div>
  );
}
