import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { fieldErrorProps, type ErrorReveal } from '@/lib/formCraft';
import { FieldError } from '@/components/ui/field-error';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  selectableServiceCategories,
  serviceCategoryNeedsIntegrityTerms,
  serviceCategoryScope,
  type ServiceCategory,
} from '@/lib/postTypes';
import {
  SERVICE_DURATION_OPTIONS,
  SERVICE_NOTES_MAX,
  todayIso,
} from '@/lib/servicePosts';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { ServiceIntegrityNotice } from '@/components/marketplace/ServiceIntegrityNotice';
import type { ListingForm } from '@/hooks/useMyListings';

const FOCUS_RING = 'focus-visible:ring-malachite-600 focus-visible:ring-offset-2';

/**
 * The structured half of a service post (request help / offer help).
 *
 * Typed columns rather than prose, for the same reason the sublease block is:
 * a task another student can act on is one they can size up at a glance — what
 * kind of help, when, roughly how long, and where. The note at the bottom is the
 * only free text and is explicitly optional.
 *
 * There is NO rate, hourly figure, deposit or amount field, and there will not
 * be one. A price field here would make the post a transaction and make
 * DormCheck a party to it; the row stores price 0 and the create flow hides the
 * price input entirely (PostListingComposer gates it on `schema.requiresPrice`).
 */
export function ServiceFields({
  form,
  setForm,
  reveal,
  categoryError,
  notesError,
  integrityError = null,
}: {
  form: ListingForm;
  setForm: Dispatch<SetStateAction<ListingForm>>;
  reveal: ErrorReveal;
  categoryError: string | null;
  notesError: string | null;
  /** Set once the poster tries to submit a tutoring post unacknowledged. */
  integrityError?: string | null;
}) {
  const { t } = useTranslation();
  const { showRemoteServices } = useFeatureFlags();
  const notes = form.service_notes ?? '';

  // The picker follows the legal gate, not the enum. While remote services are
  // closed a REMOTE post would only ever be readable inside the poster's own
  // marketplace group, which is a post that looks live and reaches nobody it was
  // written for — worse than not offering the category.
  const categories = selectableServiceCategories(showRemoteServices);
  const localCategories = categories.filter((c) => serviceCategoryScope(c) === 'local');
  const remoteCategories = categories.filter((c) => serviceCategoryScope(c) === 'remote');

  const picked = form.service_category as ServiceCategory | null | undefined;
  const scopeHint =
    picked && categories.includes(picked)
      ? t(`marketplace:service.scope.${serviceCategoryScope(picked)}Hint`)
      : null;

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="mp-service-category">
          {t('marketplace:service.category')} <span className="text-destructive">*</span>
        </Label>
        <Select
          // '' not undefined: an undefined value makes this an UNCONTROLLED
          // Select until the first pick, and React logs "changing from
          // uncontrolled to controlled" into the console the moment a student
          // chooses a category. Empty string still shows the placeholder.
          value={form.service_category ?? ''}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, service_category: v as ServiceCategory }))
          }
        >
          <SelectTrigger
            id="mp-service-category"
            className={cn('mt-1', FOCUS_RING)}
            {...fieldErrorProps('mp-service-category', categoryError)}
          >
            <SelectValue placeholder={t('marketplace:service.categoryPlaceholder')} />
          </SelectTrigger>
          {/* Grouped by reach rather than listed flat: "who will actually see
              this" is the one thing a poster cannot infer from the label, and
              it is the difference between a task someone can turn up for and
              one they cannot. The group headers disappear on their own when
              only one scope is selectable. */}
          <SelectContent>
            {localCategories.length > 0 && (
              <SelectGroup>
                {remoteCategories.length > 0 && (
                  <SelectLabel>{t('marketplace:service.scope.local')}</SelectLabel>
                )}
                {localCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`marketplace:service.categories.${c}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {remoteCategories.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t('marketplace:service.scope.remote')}</SelectLabel>
                {remoteCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`marketplace:service.categories.${c}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <FieldError fieldId="mp-service-category" message={categoryError} className="mt-1" />
        {scopeHint && !categoryError && (
          <p className="mt-1 text-xs text-muted-foreground">{scopeHint}</p>
        )}
      </div>

      {/* Tutoring states the academic-integrity line here, not only in Terms:
          the moment the category is picked is the moment it is worth reading. */}
      {serviceCategoryNeedsIntegrityTerms(picked) && (
        <ServiceIntegrityNotice
          interactive
          acknowledged={form.service_integrity_ack ?? false}
          onAcknowledgedChange={(next) =>
            setForm((f) => ({ ...f, service_integrity_ack: next }))
          }
          error={integrityError}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="mp-service-date">
            {t('marketplace:service.date')} ({t('common:form.optional')})
          </Label>
          <Input
            id="mp-service-date"
            type="date"
            // A task in the past cannot be claimed, so the picker refuses it
            // rather than letting the post land dead.
            min={todayIso()}
            value={form.service_date ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, service_date: e.target.value }))}
            {...reveal.blurProps('service_date')}
            className={cn('mt-1', FOCUS_RING)}
          />
        </div>

        <div>
          <Label htmlFor="mp-service-duration">
            {t('marketplace:service.duration')} ({t('common:form.optional')})
          </Label>
          <Select
            value={form.service_duration_minutes ? String(form.service_duration_minutes) : ''}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, service_duration_minutes: Number(v) }))
            }
          >
            <SelectTrigger id="mp-service-duration" className={cn('mt-1', FOCUS_RING)}>
              <SelectValue placeholder={t('marketplace:service.durationPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_DURATION_OPTIONS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {t(`marketplace:service.durations.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="mp-service-location">
          {t('marketplace:service.location')} ({t('common:form.optional')})
        </Label>
        <Input
          id="mp-service-location"
          value={form.service_location ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, service_location: e.target.value }))}
          placeholder={t('marketplace:service.locationPlaceholder')}
          className={cn('mt-1', FOCUS_RING)}
        />
      </div>

      <div>
        <Label htmlFor="mp-service-notes">
          {t('marketplace:service.notes')} ({t('common:form.optional')})
        </Label>
        <Textarea
          id="mp-service-notes"
          value={notes}
          onChange={(e) => setForm((f) => ({ ...f, service_notes: e.target.value }))}
          placeholder={t('marketplace:service.notesPlaceholder')}
          rows={3}
          maxLength={SERVICE_NOTES_MAX}
          {...reveal.blurProps('service_notes')}
          {...fieldErrorProps('mp-service-notes', notesError)}
          className={cn('mt-1', FOCUS_RING)}
        />
        <FieldError fieldId="mp-service-notes" message={notesError} className="mt-1" />
        <p className="mt-1 text-xs text-muted-foreground">
          {t('marketplace:service.notesHint', {
            remaining: SERVICE_NOTES_MAX - notes.length,
          })}
        </p>
      </div>
    </div>
  );
}
