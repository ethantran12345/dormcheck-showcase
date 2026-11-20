import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useBuildings, useClassBuildingAbbrs, type Building } from '@/hooks/useSchedule';

interface BuildingComboboxProps {
  value: Building | null;
  onChange: (building: Building | null) => void;
  placeholder?: string;
  /** Accessible name for the trigger button. */
  label: string;
  id?: string;
}

/** Searchable picker over the seeded Pitt buildings table. */
export function BuildingCombobox({
  value,
  onChange,
  label,
  id,
}: BuildingComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: buildings = [], isLoading } = useBuildings();
  const { data: classAbbrs } = useClassBuildingAbbrs();
  const defaultPlaceholder = t('checklist:schedule.pickABuilding');

  // Split into buildings that actually host classes this term ("academic") and
  // the rest of the campus registry. When the catalog is unavailable, treat
  // every building as ungrouped so the picker never comes up empty.
  const { academic, other } = useMemo(() => {
    if (!classAbbrs || classAbbrs.size === 0) {
      return { academic: [] as Building[], other: buildings };
    }
    const academic: Building[] = [];
    const other: Building[] = [];
    for (const b of buildings) {
      (classAbbrs.has(b.abbr) ? academic : other).push(b);
    }
    return { academic, other };
  }, [buildings, classAbbrs]);

  const renderItem = (b: Building) => (
    <CommandItem
      key={b.id}
      value={`${b.name} ${b.abbr}`}
      onSelect={() => {
        onChange(b.id === value?.id ? null : b);
        setOpen(false);
      }}
    >
      <Check
        className={cn('mr-2 h-4 w-4', value?.id === b.id ? 'opacity-100' : 'opacity-0')}
      />
      <span className="truncate">{b.name}</span>
      <span className="ml-auto pl-2 text-xs text-muted-foreground">{b.abbr}</span>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? value.name : isLoading ? t('checklist:schedule.loadingBuildings') : defaultPlaceholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('checklist:schedule.searchBuildings')} />
          <CommandList>
            <CommandEmpty>{t('checklist:schedule.noBuildingFound')}</CommandEmpty>
            {academic.length > 0 ? (
              <>
                <CommandGroup heading={t('checklist:schedule.classBuildingsHeading')}>
                  {academic.map(renderItem)}
                </CommandGroup>
                <CommandGroup heading={t('checklist:schedule.otherBuildingsHeading')}>
                  {other.map(renderItem)}
                </CommandGroup>
              </>
            ) : (
              <CommandGroup>{other.map(renderItem)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
