import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SubleaseAddressField } from '@/components/marketplace/SubleaseAddressField';
import type { SubleaseBuilding } from '@/hooks/useSubleaseBuildings';

/**
 * The address field is the whole reversal in one component, so what is asserted
 * here is mostly what it REFUSES to do: it never blocks, never demands a match,
 * and never treats a typed address as second-class.
 *
 * The registry hook is stubbed rather than run against a database — this is a
 * test about what the field does with suggestions, not about how they are
 * fetched (`useSubleaseBuildings` scoping is covered by the RLS probe).
 */
const REGISTRY: SubleaseBuilding[] = [
  { id: 'bld-sky', name: 'Skyvue Apartments', address: '3428 Forbes Ave', lat: 40.44, lng: -79.95 },
  { id: 'bld-bridge', name: 'The Bridge on Forbes', address: '3423 Forbes Ave', lat: 40.44, lng: -79.96 },
  { id: 'bld-noaddr', name: 'Semple House', address: null, lat: 40.43, lng: -79.95 },
];

vi.mock('@/hooks/useSubleaseBuildings', () => ({
  useSubleaseBuildings: () => ({ buildings: REGISTRY, isLoading: false, error: null }),
}));

function renderField(value = '', handlers: Partial<{ onChange: (v: string) => void; onPick: (v: string, b: SubleaseBuilding) => void }> = {}) {
  const onChange = handlers.onChange ?? vi.fn();
  const onPick = handlers.onPick ?? vi.fn();
  render(
    <SubleaseAddressField
      id="addr"
      universityId="uni-1"
      value={value}
      onChange={onChange}
      onPick={onPick}
    />,
  );
  return { onChange, onPick, input: screen.getByRole('combobox') as HTMLInputElement };
}

describe('SubleaseAddressField', () => {
  beforeEach(cleanup);

  it('is a plain text input, with no list open before anything is typed', () => {
    const { input } = renderField();
    expect(input.value).toBe('');
    // No listbox: the field is usable with the registry entirely ignored, which is
    // the state a student at an unseeded school is permanently in.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('reports free typing verbatim and offers no obstacle when nothing matches', () => {
    const { onChange, input } = renderField();
    fireEvent.change(input, { target: { value: '428 Semple St' } });
    expect(onChange).toHaveBeenCalledWith('428 Semple St');
    // Nothing in the registry matches, and that is a complete, valid answer —
    // there is no "not listed" branch to enter and nothing is disabled.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('suggests a known building by name and by street', () => {
    cleanup();
    renderField('Skyvue');
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Skyvue Apartments3428 Forbes Ave',
    ]);

    cleanup();
    renderField('Forbes');
    fireEvent.focus(screen.getByRole('combobox'));
    // Matched on the ADDRESS, which is the point: a student who knows the street
    // but not the building's name still gets the suggestion.
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('fills the ADDRESS, not the name, when a suggestion is taken', () => {
    const { onPick } = renderField('Skyvue');
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option'));
    // `building_name` is the address column now, and it is also the card headline.
    // Writing "Skyvue Apartments" here would put a name where the geocoder expects
    // a street.
    expect(onPick).toHaveBeenCalledWith('3428 Forbes Ave', REGISTRY[0]);
  });

  it('falls back to the building name when the registry row has no address', () => {
    const { onPick } = renderField('Semple House');
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option'));
    expect(onPick).toHaveBeenCalledWith('Semple House', REGISTRY[2]);
  });

  it('is keyboard operable, and leaves Enter alone until an option is highlighted', () => {
    const { onPick, input } = renderField('Forbes');
    fireEvent.focus(input);
    // Enter with nothing highlighted must NOT pick — a student who typed an
    // address and never looked at the list is submitting, not choosing.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('closes the list on Escape without changing the typed value', () => {
    const { onChange, input } = renderField('Forbes');
    fireEvent.focus(input);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
