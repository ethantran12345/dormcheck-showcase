import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  CURRENT_TERM,
  useAddUserClass,
  useBuildings,
  useCourseSectionSearch,
  type Building,
  type CourseSection,
} from '@/hooks/useSchedule';
import { CLASS_COLORS, formatTime } from '@/components/schedule/WeeklyGrid';
import { BuildingCombobox } from '@/components/schedule/BuildingCombobox';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { parseRoomCode } from '@/lib/schedule/roomCode';
import { parsePastedSchedule, type ParsedClass } from '@/lib/schedule/parsePastedSchedule';

const DAY_OPTIONS = [
  { key: 'Mo', label: 'Mon' },
  { key: 'Tu', label: 'Tue' },
  { key: 'We', label: 'Wed' },
  { key: 'Th', label: 'Thu' },
  { key: 'Fr', label: 'Fri' },
  { key: 'Sa', label: 'Sat' },
  { key: 'Su', label: 'Sun' },
];

interface AddClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Next color id to assign, round-robin from existing classes. */
  nextColor: string;
  /** Tab to open on; content remounts with the dialog so this applies per open. */
  initialTab?: 'catalog' | 'paste' | 'manual';
}

export function AddClassDialog({ open, onOpenChange, nextColor, initialTab = 'catalog' }: AddClassDialogProps) {
  const { t } = useTranslation();
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent dialogClassName="sm:max-w-lg">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('checklist:schedule.addAClass')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {t('checklist:schedule.addClassDescription')}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <Tabs defaultValue={initialTab} key={open ? initialTab : undefined}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="catalog">{t('checklist:schedule.tabFindMyClass')}</TabsTrigger>
            <TabsTrigger value="paste">{t('checklist:schedule.tabPasteSchedule')}</TabsTrigger>
            <TabsTrigger value="manual">{t('checklist:schedule.tabEnterManually')}</TabsTrigger>
          </TabsList>
          <TabsContent value="catalog">
            <CatalogTab nextColor={nextColor} onDone={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="paste">
            <PasteTab nextColor={nextColor} onDone={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="manual">
            <ManualTab nextColor={nextColor} onDone={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function sectionLabel(s: CourseSection) {
  return `${s.subject} ${s.catalog_number} ${s.component ?? ''}`.trim();
}

function CatalogTab({ nextColor, onDone }: { nextColor: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const { data: results = [], isFetching } = useCourseSectionSearch(query);
  const { data: buildings = [] } = useBuildings();
  const addClass = useAddUserClass();

  const buildingByAbbr = useMemo(
    () => new Map(buildings.map((b) => [b.abbr, b])),
    [buildings],
  );

  const handlePick = async (s: CourseSection) => {
    const building = s.building_abbr ? buildingByAbbr.get(s.building_abbr) : undefined;
    try {
      await addClass.mutateAsync({
        section_id: s.id,
        label: sectionLabel(s),
        days: [...new Set(s.days)],
        start_time: s.start_time,
        end_time: s.end_time,
        building_id: building?.id ?? null,
        room: s.room,
        term: s.term,
        color: nextColor,
      });
      if (s.location_status !== 'located') {
        toast.info(t('checklist:schedule.roomNotPublished'));
      } else {
        toast.success(t('checklist:schedule.addedClass', { name: sectionLabel(s) }));
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:schedule.couldNotAdd'));
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('checklist:schedule.catalogSearchPlaceholder')}
          className="pl-9"
          aria-label={t('checklist:schedule.catalogSearchAria')}
        />
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto" aria-live="polite">
        {isFetching && (
          <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('checklist:schedule.searching')}
          </p>
        )}
        {!isFetching && query.trim().length >= 2 && results.length === 0 && (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            {t('checklist:schedule.noSectionsMatch')}
          </p>
        )}
        {results.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handlePick(s)}
            disabled={addClass.isPending}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-left shadow-raised hover:shadow-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{sectionLabel(s)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                Sec {s.section}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {s.title_display ?? s.title ?? ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {s.days.length > 0 ? [...new Set(s.days)].join(' ') : 'Days TBA'}
              {s.start_time ? ` · ${formatTime(s.start_time)}` : ''}
              {s.end_time ? ` – ${formatTime(s.end_time)}` : ''}
              {s.location_status === 'located' && s.room ? ` · ${s.room}` : ''}
              {s.location_status === 'private' ? ' · Room not published' : ''}
              {s.location_status === 'online_tba' ? ' · Online / TBA' : ''}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Match a parsed location like "Chevron Science Center 150" or "CL0306" to a
 * known building + room. Longest building-name prefix wins; falls back to the
 * abbr-coded room parser.
 */
function resolveLocation(
  location: string | null,
  buildings: Building[],
): { buildingId: string | null; room: string | null } {
  if (!location) return { buildingId: null, room: null };
  const lower = location.toLowerCase();
  let best: Building | null = null;
  for (const b of buildings) {
    if (lower.startsWith(b.name.toLowerCase()) && (!best || b.name.length > best.name.length)) {
      best = b;
    }
  }
  if (best) {
    const room = location.slice(best.name.length).trim();
    return { buildingId: best.id, room: room || null };
  }
  const parsed = parseRoomCode(location.replace(/\s+/g, ''), buildings.map((b) => b.abbr));
  if (parsed) {
    const match = buildings.find((b) => b.abbr === parsed.buildingAbbr);
    if (match) return { buildingId: match.id, room: parsed.room || null };
  }
  return { buildingId: null, room: location };
}

function PasteTab({ nextColor, onDone }: { nextColor: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const { data: buildings = [] } = useBuildings();
  const addClass = useAddUserClass();

  const parsed = useMemo(() => parsePastedSchedule(text), [text]);
  const selected = parsed.filter((_, i) => !excluded.has(i));

  const toggle = (i: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Round-robin colors for the batch, continuing from the page's next color.
  const colorFor = (n: number) => {
    const start = CLASS_COLORS.findIndex((c) => c.id === nextColor);
    return CLASS_COLORS[(Math.max(start, 0) + n) % CLASS_COLORS.length].id;
  };

  const handleImport = async () => {
    try {
      let added = 0;
      for (const cls of selected) {
        const { buildingId, room } = resolveLocation(cls.location, buildings);
        await addClass.mutateAsync({
          label: cls.label,
          days: cls.days,
          start_time: cls.startTime,
          end_time: cls.endTime,
          building_id: buildingId,
          room,
          term: CURRENT_TERM,
          color: colorFor(added),
        });
        added += 1;
      }
      toast.success(t('checklist:schedule.addedClasses', { count: added }));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:schedule.couldNotImport'));
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="paste-schedule">{t('checklist:schedule.pasteFromLabel')}</Label>
        <Textarea
          id="paste-schedule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={t('checklist:schedule.pastePlaceholder')}
          className="max-h-40 font-mono text-xs"
        />
      </div>
      {text.trim().length > 0 && parsed.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('checklist:schedule.couldNotFindClasses')}
        </p>
      )}
      {parsed.length > 0 && (
        <>
          <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Classes found in pasted schedule">
            {parsed.map((cls: ParsedClass, i) => (
              <li
                key={`${cls.label}-${i}`}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2 shadow-raised"
              >
                <Checkbox
                  id={`paste-cls-${i}`}
                  checked={!excluded.has(i)}
                  onCheckedChange={() => toggle(i)}
                  className="mt-0.5"
                />
                <label htmlFor={`paste-cls-${i}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-sm font-semibold">{cls.label}</span>
                  {cls.title && (
                    <span className="block truncate text-xs text-muted-foreground">{cls.title}</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {cls.days.length > 0 ? cls.days.join(' ') : 'Days TBA'}
                    {cls.startTime ? ` · ${formatTime(cls.startTime)}` : ''}
                    {cls.endTime ? ` – ${formatTime(cls.endTime)}` : ''}
                    {cls.location ? ` · ${cls.location}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={handleImport}
            disabled={selected.length === 0 || addClass.isPending}
            className="w-full bg-malachite-800 text-white hover:bg-malachite-900"
          >
            {addClass.isPending
              ? t('checklist:schedule.importing')
              : t('checklist:schedule.addClassesButton', { count: selected.length })}
          </Button>
        </>
      )}
    </div>
  );
}

function ManualTab({ nextColor, onDone }: { nextColor: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [building, setBuilding] = useState<Building | null>(null);
  const [room, setRoom] = useState('');
  const { data: buildings = [] } = useBuildings();
  const addClass = useAddUserClass();

  const toggleDay = (key: string) =>
    setDays((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]));

  // Typing a full room code like CL0306 resolves the building automatically.
  const handleRoomChange = (value: string) => {
    setRoom(value);
    if (!building && value.length >= 4) {
      const parsed = parseRoomCode(value, buildings.map((b) => b.abbr));
      if (parsed) {
        const match = buildings.find((b) => b.abbr === parsed.buildingAbbr);
        if (match) setBuilding(match);
      }
    }
  };

  const canSave = label.trim().length > 0;

  const handleSave = async () => {
    try {
      await addClass.mutateAsync({
        label: label.trim(),
        days,
        start_time: startTime || null,
        end_time: endTime || null,
        building_id: building?.id ?? null,
        room: room.trim() || null,
        term: CURRENT_TERM,
        color: nextColor,
      });
      toast.success(t('checklist:schedule.addedClass', { name: label.trim() }));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('checklist:schedule.couldNotAdd'));
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="class-label">{t('checklist:schedule.className')}</Label>
        <Input
          id="class-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="CHEM 0110 Lecture"
        />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('checklist:schedule.daysHeading')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={days.includes(d.key)}
              onClick={() => toggleDay(d.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                days.includes(d.key)
                  ? 'border-malachite-800 bg-malachite-800 text-white'
                  : 'border-border bg-card text-foreground hover:bg-malachite-50',
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="class-start">{t('checklist:schedule.starts')}</Label>
          <Input
            id="class-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="class-end">{t('checklist:schedule.ends')}</Label>
          <Input
            id="class-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="class-building">{t('checklist:schedule.building')}</Label>
        <BuildingCombobox
          id="class-building"
          value={building}
          onChange={setBuilding}
          label="Class building"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="class-room">{t('checklist:schedule.roomOptional')}</Label>
        <Input
          id="class-room"
          value={room}
          onChange={(e) => handleRoomChange(e.target.value)}
          placeholder="0306 or CL0306"
        />
      </div>
      <Button
        type="button"
        onClick={handleSave}
        disabled={!canSave || addClass.isPending}
        className="w-full bg-malachite-800 text-white hover:bg-malachite-900"
      >
        {addClass.isPending ? t('checklist:schedule.adding') : t('checklist:schedule.addClass')}
      </Button>
    </div>
  );
}

export function nextClassColor(existingColors: (string | null)[]): string {
  const counts = new Map(CLASS_COLORS.map((c) => [c.id, 0]));
  for (const c of existingColors) {
    if (c && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = CLASS_COLORS[0].id;
  let bestCount = Infinity;
  for (const { id } of CLASS_COLORS) {
    const n = counts.get(id) ?? 0;
    if (n < bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}
