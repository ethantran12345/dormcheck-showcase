import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

describe('button motion contract', () => {
  it('gives every button immediate press feedback with reduced-motion guards', () => {
    const classes = buttonVariants();

    expect(classes).toContain('duration-150');
    expect(classes).toContain('ease-ios');
    expect(classes).toContain('active:scale-[0.97]');
    expect(classes).toContain('motion-reduce:transform-none');
  });

  it('lifts elevated action variants but keeps link buttons spatially still', () => {
    expect(buttonVariants({ variant: 'default' })).toContain('hover:-translate-y-px');
    expect(buttonVariants({ variant: 'secondary' })).toContain('hover:shadow-raised');
    expect(buttonVariants({ variant: 'link' })).toContain('active:scale-100');
  });

  it('keeps disabled buttons from looking interactive', () => {
    const classes = buttonVariants();

    expect(classes).toContain('disabled:translate-y-0');
    expect(classes).toContain('disabled:scale-100');
    expect(classes).toContain('disabled:shadow-none');
  });
});
