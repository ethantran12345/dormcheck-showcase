import { useMemo, useState } from 'react';
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
import { useDorms } from '@/hooks/useDorms';

interface DormComboboxProps {
  /** Selected building name (matches the roommate RPC's free-text p_dorm_name). */
  value: string;
  onChange: (name: string) => void;
  /** Accessible name for the trigger button. */
  label: string;
  id?: string;
  placeholder?: string;
}

/**
 * Searchable dorm/building picker for roommate groups. Sources the deduplicated
 * Pitt residence-hall list from `useDorms` (Freshman halls sorted first) and
 * stores the building *name* string, so the roommate RPC's free-text
 * `p_dorm_name` maps through unchanged. A hall not in the registry can still be
 * entered via the "Use ..." custom row, so the picker never traps a user.
 */
export function DormCombobox({
  value,
  onChange,
  label,
  id,
  placeholder = 'Select a dorm or building',
}: DormComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { dorms, isLoading } = useDorms();

  // Deduplicated, order-preserving list of building names.
  const names = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of dorms) {
      const n = d.name?.trim();
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        out.push(n);
      }
    }
    return out;
  }, [dorms]);

  const trimmedQuery = query.trim();
  const hasExactMatch = names.some((n) => n.toLowerCase() === trimmedQuery.toLowerCase());

  const select = (name: string) => {
    onChange(name === value ? '' : name);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || (isLoading ? 'Loading dorms...' : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search dorms..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No dorm found.</CommandEmpty>
            <CommandGroup>
              {names.map((name) => (
                <CommandItem key={name} value={name} onSelect={() => select(name)}>
                  <Check
                    className={cn('mr-2 h-4 w-4', value === name ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{name}</span>
                </CommandItem>
              ))}
              {trimmedQuery && !hasExactMatch ? (
                <CommandItem
                  key="__custom__"
                  value={`__use__${trimmedQuery}`}
                  onSelect={() => select(trimmedQuery)}
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  <span className="truncate">Use &ldquo;{trimmedQuery}&rdquo;</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
