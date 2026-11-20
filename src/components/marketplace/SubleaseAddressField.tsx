import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { fieldErrorProps } from '@/lib/formCraft';
import { useSubleaseBuildings, type SubleaseBuilding } from '@/hooks/useSubleaseBuildings';

/**
 * Where the sublease is — a free-text ADDRESS with the building registry offered
 * as autocomplete behind it.
 *
 * This replaces `BuildingCombobox` (Phase 1, 2026-08-17), and the reversal is the
 * point. That picker made a curated `public.buildings` row the only way to say
 * where a sublease was, so a building nobody had seeded yet meant a student could
 * not post at all — a seeding gap charged to the student — and the escape hatch
 * added later produced a listing that was deliberately never pinned. Both halves
 * were wrong. What a student has is an address; the product promise is that
 * photos plus an address get you on the map, always.
 *
 * So the registry is demoted to what it is actually good at: SUGGESTION. Typing
 * "Skyvue" offers Skyvue's street address, which spares the student looking it up
 * and makes two listers at one building far more likely to type the same string.
 * Picking one fills the address and records `building_id` as enrichment. Typing
 * something the registry has never heard of is a completely valid, fully pinned
 * post — there is no "not listed" branch here because there is nothing to be not
 * listed in.
 *
 * WHAT KEEPS A WRONG PIN OFF THE MAP is not this component. It is the geocoder's
 * `MAX_CAMPUS_DISTANCE_KM` guard at submit (src/lib/geocode.ts), which refuses a
 * match an implausible distance from the listing's campus — the check that would
 * have caught the Pittsburgh address that once resolved to Lancashire, England.
 * That is the right place for it: it rejects the COORDINATE rather than the
 * student, and it works for every address, seeded or not.
 *
 * Built as an input with a listbox rather than as a `Command` popover on purpose.
 * cmdk owns its own input and treats the typed string as a filter over a closed
 * set; here the typed string IS the value, and the list is an optional
 * convenience layered on top. Inverting that is what made the old component a
 * gate.
 */
export function SubleaseAddressField({
  universityId,
  value,
  onChange,
  onPick,
  id,
  onBlur,
  ...ariaProps
}: {
  /** The LISTING's university — see the note on `useSubleaseBuildings`. */
  universityId: string | undefined;
  /** The address text. This is `building_name` on the row. */
  value: string;
  /** Free typing. The caller drops any `building_id` enrichment on this path. */
  onChange: (address: string) => void;
  /** A registry suggestion was chosen: address text plus the row behind it. */
  onPick: (address: string, building: SubleaseBuilding) => void;
  id: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
} & ReturnType<typeof fieldErrorProps>) {
  const { t } = useTranslation();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Errors and an empty registry are both simply "no suggestions". Unlike the old
  // picker there is nothing to explain to the student: the field works either
  // way, so an empty-registry notice would announce a problem they do not have.
  const { buildings } = useSubleaseBuildings(universityId);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    const matches = buildings.filter(
      (b) =>
        b.name.toLowerCase().includes(q) || (b.address ?? '').toLowerCase().includes(q),
    );
    // Capped because this hangs under a form field on a phone, not because the
    // registry is large. Past a handful the list stops being a shortcut.
    return matches.slice(0, 6);
  }, [buildings, value]);

  /**
   * What a pick writes into the address box. The street address is the whole
   * point of the suggestion — a lister who knew the address would have typed it —
   * so a row with none falls back to its name, which at least geocodes as a
   * campus landmark.
   */
  const addressFor = (b: SubleaseBuilding) => (b.address ?? '').trim() || b.name;

  const showList = open && suggestions.length > 0;

  const commit = (b: SubleaseBuilding) => {
    onPick(addressFor(b), b);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        setOpen(true);
        setActiveIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      // Only swallows Enter when a suggestion is actually highlighted, so the
      // key still submits the form for someone who typed an address and never
      // looked at the list.
      e.preventDefault();
      commit(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Closing on blur would fire before a click on a suggestion lands, so
          // the list closes on `mousedown` inside it instead (see below) and this
          // only handles leaving the field entirely.
          setOpen(false);
          setActiveIndex(-1);
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('marketplace:sublease.addressPlaceholder')}
        className={cn('mt-1', 'focus-visible:ring-malachite-600 focus-visible:ring-offset-2')}
        {...ariaProps}
      />

      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('marketplace:sublease.addressSuggestions')}
          // `shadow-overlay` is the elevation tier for a floating menu, not a
          // bare `shadow-md` — see .claude/rules/design-system.md. Radius is
          // `rounded-card`, matching every other popover surface.
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-card border border-border bg-popover shadow-overlay"
          // Keeps the input's blur from tearing the list down before the click's
          // own handler runs.
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((b, i) => (
            <li
              key={b.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => commit(b)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3 py-2 text-sm',
                i === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground',
              )}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-medium">{b.name}</span>
                {b.address ? (
                  <span className="block truncate text-xs text-muted-foreground">{b.address}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
