import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, ShieldCheck, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { DEFAULT_UNIVERSITY, getUniversityById } from '@/config/universities';
import { supabase } from '@/integrations/supabase/client';
import {
  useDormEdits,
  logDormEdit,
  type DormEditWithEditor,
} from '@/hooks/useDormEdits';
import type { Json, Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { PhotoUpload } from '@/components/admin/PhotoUpload';
import { MapPicker } from '@/components/admin/MapPicker';
import { DormStudentPreview } from '@/components/admin/DormStudentPreview';
import { PageContainer } from '@/components/ui/page-container';

type MasterHousingRow = Tables<'master_housing'>;

type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'photo' | 'coords' | 'date';

const FIELD_ORDER: (keyof MasterHousingRow)[] = [
  'id',
  'residence_hall',
  'accomodation',
  'housing_type',
  'who_lives_here',
  'community_type',
  'building_llc',
  'address',
  'mailing_address',
  'mailing_services',
  'latitude',
  'longitude',
  'capacity',
  'floors',
  'rate_per_term',
  'rent_period',
  'terms',
  'important_dates',
  'meal_plan_options',
  'heat_and_air_conditioning',
  'wifi_and_cable',
  'window_coverings',
  'laundry',
  'building_amenities',
  'inroom_amenities',
  'details',
  'resident_director',
  'move_in_date',
  'move_in_parking_lot',
  'move_in_time_window',
  'move_in_entrance',
  'move_in_cart_location',
  'move_in_notes',
  'floorplan',
  'image_url',
];

const FIELD_TYPES: Record<string, FieldType> = {
  residence_hall: 'text',
  accomodation: 'text',
  address: 'text',
  rate_per_term: 'text',
  capacity: 'text',
  who_lives_here: 'text',
  resident_director: 'text',
  mailing_address: 'text',
  laundry: 'text',
  rent_period: 'text',
  details: 'textarea',
  building_amenities: 'textarea',
  inroom_amenities: 'textarea',
  important_dates: 'textarea',
  terms: 'textarea',
  floors: 'number',
  latitude: 'coords',
  longitude: 'coords',
  heat_and_air_conditioning: 'boolean',
  wifi_and_cable: 'boolean',
  meal_plan_options: 'boolean',
  window_coverings: 'boolean',
  housing_type: 'select',
  community_type: 'select',
  image_url: 'photo',
  floorplan: 'photo',
  move_in_date: 'date',
  move_in_parking_lot: 'text',
  move_in_time_window: 'text',
  move_in_entrance: 'text',
  move_in_cart_location: 'text',
  move_in_notes: 'textarea',
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DISPLAY_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** Pretty-print a YYYY-MM-DD string for read-only display (audit log still stores raw ISO). */
function formatDateValue(v: unknown): string {
  if (typeof v !== 'string' || !ISO_DATE_REGEX.test(v.trim())) return formatValue(v);
  const [y, m, d] = v.trim().split('-').map(Number);
  const local = new Date(y, m - 1, d);
  if (Number.isNaN(local.getTime())) return v;
  return DISPLAY_DATE_FMT.format(local);
}

const ENUM_OPTIONS: Record<string, string[]> = {
  housing_type: [
    'On-Campus Housing',
    'Leased Apartments, Apartment Style Housing',
  ],
  community_type: [
    'Single Gender or Gender Inclusive Housing based on room',
    'Single Gender by Floor/Wing or Gender Inclusive Housing by room',
    'Single Gender or Gender Inclusive Housing by Suite',
    'Single Gender or Gender Inclusive Housing',
    'Single gender by apartment and gender inclusive by room',
    'Single Gender by Floor or Gender Inclusive Housing by room',
    'Single Gender or Gender Inclusive Housing based on Floor/Wing',
    'Single Gender or Gender Inclusive Housing by Room/Wing',
    'Single gender by room and gender inclusive by room',
  ],
};

const REQUIRED_FIELDS: ReadonlySet<string> = new Set<string>(['residence_hall']);

const HTTPS_REGEX = /^https:\/\/\S+$/i;

const EDITS_PREVIEW_COUNT = 20;
const CHANGE_TRUNCATE = 80;
const RECENT_RELATIVE_MS = 7 * 24 * 60 * 60 * 1000;

const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function humanize(snake: string): string {
  return snake
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const age = Date.now() - d.getTime();
  if (age > RECENT_RELATIVE_MS) return dateTimeFmt.format(d);
  return formatDistanceToNow(d, { addSuffix: true });
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return ' - ';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v.length > 0 ? v : ' - ';
  if (typeof v === 'number') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatChangeValue(raw: unknown, fieldName: string): string {
  if (FIELD_TYPES[fieldName] === 'boolean') {
    if (raw === true) return 'Yes';
    if (raw === false) return 'No';
    return ' - ';
  }
  return formatValue(raw);
}

function toDraftString(v: unknown, type: FieldType | null): string {
  if (type === 'boolean') {
    if (v === true) return 'true';
    if (v === false) return 'false';
    return '';
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type ParseResult =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; error: string };

function parseDraft(draft: string, type: FieldType): ParseResult {
  const trimmed = draft.trim();
  if (type === 'boolean') {
    if (trimmed === 'true') return { ok: true, value: true };
    if (trimmed === 'false') return { ok: true, value: false };
    return { ok: true, value: null };
  }
  if (type === 'number') {
    if (!trimmed) return { ok: true, value: null };
    const n = parseInt(trimmed, 10);
    if (Number.isNaN(n)) return { ok: false, error: 'must be a whole number' };
    return { ok: true, value: n };
  }
  if (type === 'date') {
    if (!trimmed) return { ok: true, value: null };
    if (!ISO_DATE_REGEX.test(trimmed)) {
      return { ok: false, error: 'must be a valid date (YYYY-MM-DD)' };
    }
    const [y, m, d] = trimmed.split('-').map(Number);
    const local = new Date(y, m - 1, d);
    if (
      Number.isNaN(local.getTime()) ||
      local.getFullYear() !== y ||
      local.getMonth() !== m - 1 ||
      local.getDate() !== d
    ) {
      return { ok: false, error: 'must be a valid date (YYYY-MM-DD)' };
    }
    return { ok: true, value: trimmed };
  }
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

function truncate(raw: string, max = CHANGE_TRUNCATE): string {
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…`;
}

async function fetchDorm(id: number, siloFilter: string | null): Promise<MasterHousingRow | null> {
  // Superadmin silo: a dorm outside the picked school resolves to null (the
  // "No dorm found" state), mirroring what tenant RLS already does for a
  // university_admin hitting another school's id.
  let query = supabase.from('master_housing').select('*').eq('id', id);
  if (siloFilter) query = query.eq('university_id', siloFilter);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

function BooleanBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-green-700">
        <Check className="h-4 w-4" />
        Yes
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <X className="h-4 w-4" />
        No
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground"> - </span>;
}

const BOOLEAN_OPTIONS: { label: string; value: string }[] = [
  { label: 'Yes', value: 'true' },
  { label: 'No', value: 'false' },
  { label: ' - ', value: '' },
];

// The "unknown" option carries value '' — the same string Radix ToggleGroup emits
// when the pressed item is clicked again (deselect). A sentinel keeps the two
// distinguishable so we preserve the original radiogroup semantics: always exactly
// one option selected, never toggled off.
const UNKNOWN_VALUE = '__unknown__';
const toGroupValue = (v: string) => (v === '' ? UNKNOWN_VALUE : v);
const fromGroupValue = (v: string) => (v === UNKNOWN_VALUE ? '' : v);

function BooleanToggle({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      value={toGroupValue(value)}
      onValueChange={(v) => {
        // Ignore Radix's empty-string deselect so the control can't be left with
        // nothing chosen — matches the old radios, which could not be unset.
        if (!v) return;
        onChange(fromGroupValue(v));
      }}
      variant="brand"
      disabled={disabled}
      aria-label="Yes, No, or Unknown"
      className="inline-flex justify-start gap-0 overflow-hidden rounded-md border border-border"
    >
      {BOOLEAN_OPTIONS.map((opt, i) => (
        <ToggleGroupItem
          key={opt.value}
          value={toGroupValue(opt.value)}
          className={cn(
            'h-auto min-w-[3rem] rounded-none px-3 py-1.5 font-medium',
            i > 0 && 'border-l border-border',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function UrlCell({ value, fieldName }: { value: unknown; fieldName: string }) {
  const [imgBroken, setImgBroken] = useState(false);
  if (typeof value !== 'string' || !value || !HTTPS_REGEX.test(value)) {
    return <>{formatValue(value)}</>;
  }
  const showThumbnail =
    (fieldName === 'image_url' || fieldName === 'floorplan') && !imgBroken;
  return (
    <span className="inline-flex items-center gap-3 flex-wrap">
      {showThumbnail && (
        <img
          src={value}
          alt=""
          loading="lazy"
          onError={() => setImgBroken(true)}
          className="rounded object-cover border border-border"
          style={{ maxHeight: 80, maxWidth: 120 }}
        />
      )}
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-malachite-800 hover:underline break-all"
      >
        View image →
      </a>
    </span>
  );
}

function EditHistoryRow({ edit }: { edit: DormEditWithEditor }) {
  const oldFull = formatChangeValue(edit.old_value, edit.field_name);
  const newFull = formatChangeValue(edit.new_value, edit.field_name);
  return (
    <TableRow>
      <TableCell
        className="px-4 py-3 text-muted-foreground whitespace-nowrap align-top"
        title={dateTimeFmt.format(new Date(edit.created_at))}
      >
        {formatRelative(edit.created_at)}
      </TableCell>
      <TableCell className="px-4 py-3 text-foreground align-top truncate max-w-[200px]">
        {edit.editor_full_name?.trim() || edit.edited_by || '(deleted user)'}
      </TableCell>
      <TableCell className="px-4 py-3 text-foreground align-top">
        {humanize(edit.field_name)}
      </TableCell>
      <TableCell className="px-4 py-3 text-foreground align-top">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground break-words" title={oldFull}>
            {truncate(oldFull)}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="text-foreground break-words" title={newFull}>
            {truncate(newFull)}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function DormEditPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isAdmin, isSuperAdmin, isLoading: authLoading, profileLoaded } = useAuth();
  const { siloUniversityId } = useAdminUniversitySilo();
  const queryClient = useQueryClient();
  const siloFilter = isSuperAdmin ? siloUniversityId : null;

  const dormId = id ? parseInt(id, 10) : NaN;
  const dormIdValid = Number.isFinite(dormId);

  const dormQuery = useQuery({
    queryKey: ['admin-dorm', dormId, siloUniversityId],
    queryFn: () => fetchDorm(dormId, siloFilter),
    enabled:
      dormIdValid &&
      !authLoading &&
      !!user &&
      isAdmin === true &&
      (!isSuperAdmin || !!siloUniversityId),
    staleTime: 30_000,
  });

  const { edits, isLoading: editsLoading } = useDormEdits(dormIdValid ? dormId : null);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [otherMode, setOtherMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAllEdits, setShowAllEdits] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>(null);

  const dorm = dormQuery.data ?? null;

  // Where the coordinate picker opens for a dorm that has none yet. Taken from
  // the row's OWN school, not from whoever is logged in: a superadmin editing a
  // CMU dorm must not start over Oakland.
  const pickerCenter =
    (dorm?.university_id ? getUniversityById(dorm.university_id) : undefined)?.campusCenter ??
    DEFAULT_UNIVERSITY.campusCenter;

  // Live student preview: the row as it would look if the in-progress edit
  // were saved. Unsaved draft values feed the preview; invalid drafts fall
  // back to the stored value so the preview never renders garbage.
  const previewRow = useMemo(() => {
    if (!dorm) return null;
    if (!editingField) return dorm;
    const type = FIELD_TYPES[editingField];
    if (!type) return dorm;
    const parsed = parseDraft(draft, type);
    if (!parsed.ok) return dorm;
    return { ...dorm, [editingField]: parsed.value } as MasterHousingRow;
  }, [dorm, editingField, draft]);

  const isDirty = useMemo(() => {
    if (editingField == null || dorm == null) return false;
    const type = FIELD_TYPES[editingField] ?? null;
    const current = toDraftString(
      dorm[editingField as keyof MasterHousingRow],
      type,
    ).trim();
    return draft.trim() !== current;
  }, [editingField, draft, dorm]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    if (editingField) {
      editInputRef.current?.focus();
    }
  }, [editingField]);

  const beginEdit = (field: string, value: unknown) => {
    const type = FIELD_TYPES[field] ?? null;
    setEditingField(field);
    setDraft(toDraftString(value, type));
    if (type === 'select') {
      const strVal = typeof value === 'string' ? value : '';
      const opts = ENUM_OPTIONS[field] ?? [];
      setOtherMode(strVal !== '' && !opts.includes(strVal));
    } else {
      setOtherMode(false);
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setDraft('');
    setOtherMode(false);
  };

  const save = async (field: string) => {
    if (!dorm) return;
    const type = FIELD_TYPES[field];
    if (!type) return;

    const currentValue = dorm[field as keyof MasterHousingRow];
    const trimmedDraft = draft.trim();
    const currentTrimmed = toDraftString(currentValue, type).trim();

    if (REQUIRED_FIELDS.has(field) && !trimmedDraft) {
      toast.error(`${humanize(field)} cannot be empty.`);
      return;
    }

    if (trimmedDraft === currentTrimmed) {
      toast('No changes');
      cancelEdit();
      return;
    }

    const parsed = parseDraft(draft, type);
    // strictNullChecks off → !parsed.ok doesn't narrow; key off the error member.
    if ('error' in parsed) {
      toast.error(`${humanize(field)} ${parsed.error}.`);
      return;
    }
    const newValue = parsed.value;

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('master_housing')
        .update({ [field]: newValue } as Partial<MasterHousingRow>)
        .eq('id', dormId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Update blocked - 0 rows affected. Check admin RLS.');
      }

      let auditOk = true;
      try {
        await logDormEdit(
          dormId,
          field,
          (currentValue ?? null) as Json,
          (newValue ?? null) as Json,
        );
      } catch (auditErr) {
        auditOk = false;
        console.error('[DormEditPage] audit log insert failed after save', auditErr);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dorms'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorm', dormId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorms-list'] }),
        queryClient.invalidateQueries({ queryKey: ['dorm-edits', dormId] }),
      ]);

      cancelEdit();
      if (auditOk) {
        toast.success('Saved');
      } else {
        toast.error('Saved, but audit log failed.');
      }
    } catch (err) {
      console.error('[DormEditPage] save failed', err);
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const savePhoto = async (
    field: 'image_url' | 'floorplan',
    newUrl: string | null,
  ) => {
    if (!dorm) return;
    const currentValue = (dorm[field] ?? null) as string | null;
    if ((newUrl ?? null) === currentValue) {
      toast('No changes');
      cancelEdit();
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('master_housing')
        .update({ [field]: newUrl } as Partial<MasterHousingRow>)
        .eq('id', dormId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Update blocked - 0 rows affected. Check admin RLS.');
      }

      let auditOk = true;
      try {
        await logDormEdit(
          dormId,
          field,
          (currentValue ?? null) as Json,
          (newUrl ?? null) as Json,
        );
      } catch (auditErr) {
        auditOk = false;
        console.error('[DormEditPage] audit log insert failed after photo save', auditErr);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dorms'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorm', dormId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorms-list'] }),
        queryClient.invalidateQueries({ queryKey: ['dorm-edits', dormId] }),
      ]);

      cancelEdit();
      if (auditOk) {
        toast.success('Saved');
      } else {
        toast.error('Saved, but audit log failed.');
      }
    } catch (err) {
      console.error('[DormEditPage] photo save failed', err);
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveCoords = async (lat: number, lng: number) => {
    if (!dorm) return;
    if (lat < -90 || lat > 90) {
      toast.error('Latitude must be between -90 and 90');
      return;
    }
    if (lng < -180 || lng > 180) {
      toast.error('Longitude must be between -180 and 180');
      return;
    }

    const oldLat = (dorm.latitude ?? null) as number | null;
    const oldLng = (dorm.longitude ?? null) as number | null;
    const latChanged = oldLat !== lat;
    const lngChanged = oldLng !== lng;

    if (!latChanged && !lngChanged) {
      toast('No changes');
      cancelEdit();
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('master_housing')
        .update({ latitude: lat, longitude: lng } as Partial<MasterHousingRow>)
        .eq('id', dormId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Update blocked - 0 rows affected. Check admin RLS.');
      }

      let auditOk = true;
      try {
        if (latChanged) {
          await logDormEdit(dormId, 'latitude', oldLat as Json, lat as Json);
        }
        if (lngChanged) {
          await logDormEdit(dormId, 'longitude', oldLng as Json, lng as Json);
        }
      } catch (auditErr) {
        auditOk = false;
        console.error('[DormEditPage] audit log insert failed after coords save', auditErr);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dorms'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorm', dormId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dorms-list'] }),
        queryClient.invalidateQueries({ queryKey: ['dorm-edits', dormId] }),
      ]);

      cancelEdit();
      if (auditOk) {
        toast.success('Saved');
      } else {
        toast.error('Saved, but audit log failed.');
      }
    } catch (err) {
      console.error('[DormEditPage] coords save failed', err);
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (!dormIdValid) {
    return <Navigate to="/admin/dorms" replace />;
  }

  const visibleEdits = showAllEdits ? edits : edits.slice(0, EDITS_PREVIEW_COUNT);
  const hasMoreEdits = edits.length > EDITS_PREVIEW_COUNT && !showAllEdits;

  const renderEditor = (field: string, type: FieldType) => {
    const inputClasses =
      'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-malachite-600 focus:outline-none focus:ring-1 focus:ring-malachite-600 disabled:opacity-60';

    const onInputKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void save(field);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    };

    const onTextareaKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    };

    if (type === 'textarea') {
      return (
        <Textarea
          ref={editInputRef as React.Ref<HTMLTextAreaElement>}
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          disabled={saving}
          className={inputClasses}
          aria-label={`Edit ${humanize(field)}`}
        />
      );
    }
    if (type === 'number') {
      return (
        <Input
          ref={editInputRef as React.Ref<HTMLInputElement>}
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
          disabled={saving}
          className={inputClasses}
          aria-label={`Edit ${humanize(field)}`}
        />
      );
    }
    if (type === 'date') {
      return (
        <Input
          ref={editInputRef as React.Ref<HTMLInputElement>}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
          disabled={saving}
          className={inputClasses}
          aria-label={`Edit ${humanize(field)}`}
        />
      );
    }
    if (type === 'boolean') {
      return <BooleanToggle value={draft} onChange={setDraft} disabled={saving} />;
    }
    if (type === 'select') {
      if (otherMode) {
        return (
          <div className="space-y-1.5">
            <Input
              ref={editInputRef as React.Ref<HTMLInputElement>}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
              disabled={saving}
              className={inputClasses}
              aria-label={`Enter custom value for ${humanize(field)}`}
            />
            <Button
              variant="ghost"
              type="button"
              onClick={() => setOtherMode(false)}
              disabled={saving}
              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
            >
              Use dropdown instead
            </Button>
          </div>
        );
      }
      const baseOpts = ENUM_OPTIONS[field] ?? [];
      const mergedOpts =
        draft && !baseOpts.includes(draft) ? [...baseOpts, draft] : baseOpts;
      return (
        <div className="space-y-1.5">
          <select
            ref={editInputRef as React.Ref<HTMLSelectElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            disabled={saving}
            className={inputClasses}
            aria-label={`Select ${humanize(field)}`}
          >
            <option value=""> - (none)</option>
            {mergedOpts.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setOtherMode(true)}
            disabled={saving}
            className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
          >
            Enter custom value
          </Button>
        </div>
      );
    }
    return (
      <Input
        ref={editInputRef as React.Ref<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onInputKeyDown}
        disabled={saving}
        className={inputClasses}
        aria-label={`Edit ${humanize(field)}`}
      />
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <PageContainer width="wide" className="px-4 sm:px-6 py-6 pb-16 space-y-6">
        <Link
          to="/admin/dorms"
          className="text-sm font-medium text-malachite-800 hover:underline"
        >
          ← Back to Dorms
        </Link>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-malachite-600/15 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-malachite-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {dorm?.residence_hall ?? 'Dorm'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Hover any editable field and click the pencil to edit. All changes are audited below.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div className="space-y-6 min-w-0">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Fields</h2>
          {dormQuery.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : dormQuery.isError ? (
            <div className="rounded-xl border border-border bg-card shadow-raised p-6 text-sm text-foreground">
              Couldn't load this dorm.
            </div>
          ) : !dorm ? (
            <div className="rounded-xl border border-border bg-card shadow-raised p-6 text-sm text-foreground">
              No dorm found with id {dormId}.
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
              <dl className="divide-y divide-border">
                {FIELD_ORDER.map((field) => {
                  const type = FIELD_TYPES[field] ?? null;
                  const editable = type != null;
                  const editing = editingField === field;
                  const value = dorm[field];
                  return (
                    <div
                      key={field}
                      className="group grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-3 hover:bg-accent"
                    >
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground font-mono">
                        {field}
                      </dt>
                      {editing && editable && type ? (
                        <dd className="sm:col-span-2 space-y-2">
                          {type === 'photo' &&
                          (field === 'image_url' || field === 'floorplan') ? (
                            <PhotoUpload
                              currentUrl={(value as string | null) ?? null}
                              onUpload={(newUrl) => savePhoto(field, newUrl)}
                              onRemove={() => savePhoto(field, null)}
                              onCancel={cancelEdit}
                              dormId={dormId}
                              fieldName={field}
                              disabled={saving}
                            />
                          ) : type === 'coords' ? (
                            <MapPicker
                              currentLat={(dorm.latitude ?? null) as number | null}
                              currentLng={(dorm.longitude ?? null) as number | null}
                              center={pickerCenter}
                              onSave={saveCoords}
                              onCancel={cancelEdit}
                              disabled={saving}
                            />
                          ) : (
                            <>
                              {renderEditor(field, type)}
                              <div className="flex items-center gap-3">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void save(field)}
                                  disabled={saving}
                                  className="bg-malachite-800 text-white hover:bg-malachite-900"
                                >
                                  {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    'Save'
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </>
                          )}
                        </dd>
                      ) : (
                        <dd className="sm:col-span-2 flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1 text-sm text-foreground break-words whitespace-pre-wrap">
                            {type === 'boolean' ? (
                              <BooleanBadge value={value as boolean | null | undefined} />
                            ) : type === 'photo' ? (
                              <UrlCell value={value} fieldName={field} />
                            ) : type === 'date' ? (
                              formatDateValue(value)
                            ) : (
                              formatValue(value)
                            )}
                          </span>
                          {editable && (
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => beginEdit(field, value)}
                              aria-label={`Edit ${humanize(field)}`}
                              className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-malachite-600/40"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </dd>
                      )}
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Edit History</h2>
          <div className="rounded-xl border border-border bg-card shadow-raised overflow-hidden">
            {editsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : edits.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No edits yet. Make a change above and it will appear here.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table className="w-full text-sm">
                    <TableHeader className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <TableRow>
                        <TableHead className="px-4 py-3 font-medium">When</TableHead>
                        <TableHead className="px-4 py-3 font-medium">Editor</TableHead>
                        <TableHead className="px-4 py-3 font-medium">Field</TableHead>
                        <TableHead className="px-4 py-3 font-medium">Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border">
                      {visibleEdits.map((edit) => (
                        <EditHistoryRow key={edit.id} edit={edit} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {hasMoreEdits && (
                  <div className="border-t border-border px-4 py-3 text-center">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setShowAllEdits(true)}
                      className="text-sm font-medium text-malachite-800 hover:underline"
                    >
                      Show all {edits.length} edits
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
          </div>

          <div className="xl:sticky xl:top-6 min-w-0">
            {previewRow && <DormStudentPreview row={previewRow} />}
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
