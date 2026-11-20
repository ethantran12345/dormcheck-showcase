import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import {
  fieldErrorId,
  fieldErrorProps,
  firstUnmetRequirement,
  useErrorReveal,
} from '@/lib/formCraft';
import { FieldError, SubmitBlockedReason } from '@/components/ui/field-error';

/**
 * IPP-3 form UX craft. The behaviour worth locking down is the TIMING rule — a
 * regression here is invisible in a screenshot and actively harmful (validating
 * per keystroke is worse than not validating), so it gets a real interaction test
 * rather than a snapshot.
 */

describe('fieldErrorProps', () => {
  it('is inert when there is no error', () => {
    expect(fieldErrorProps('email', null)).toEqual({
      'aria-invalid': undefined,
      'aria-describedby': undefined,
    });
  });

  it('marks invalid and points at the error node', () => {
    expect(fieldErrorProps('email', 'Bad email')).toEqual({
      'aria-invalid': true,
      'aria-describedby': fieldErrorId('email'),
    });
  });

  it('KEEPS a pre-existing describedby instead of clobbering it', () => {
    // Regression guard: Auth's password field already points at its requirements
    // hint. Replacing that with the error id would silently drop the hint.
    const props = fieldErrorProps('pw', 'Too short', 'pw-requirements');
    expect(props['aria-describedby']).toBe('pw-requirements pw-error');
  });

  it('keeps the hint alone when there is no error', () => {
    expect(fieldErrorProps('pw', null, 'pw-requirements')['aria-describedby']).toBe(
      'pw-requirements',
    );
  });
});

describe('firstUnmetRequirement', () => {
  it('returns null when everything is satisfied', () => {
    expect(
      firstUnmetRequirement([
        { met: true, reason: 'a' },
        { met: true, reason: 'b' },
      ]),
    ).toBeNull();
  });

  it('reports ONE reason, the first unmet in listed order', () => {
    expect(
      firstUnmetRequirement([
        { met: true, reason: 'photo' },
        { met: false, reason: 'title' },
        { met: false, reason: 'price' },
      ]),
    ).toBe('title');
  });
});

describe('FieldError', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<FieldError fieldId="x" message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is announced and carries the id the control points at', () => {
    render(<FieldError fieldId="email" message="That doesn't look like an email address." />);
    const node = screen.getByRole('alert');
    expect(node.id).toBe('email-error');
    expect(node).toHaveTextContent("That doesn't look like an email address.");
  });
});

describe('SubmitBlockedReason', () => {
  it('stays mounted as an empty polite region so later changes are announced', () => {
    // An aria-live region must exist BEFORE its content changes; mounting it at the
    // same moment as the text is the classic reason nothing gets spoken.
    const { container } = render(<SubmitBlockedReason id="blocked" reason={null} />);
    const node = container.querySelector('#blocked');
    expect(node).not.toBeNull();
    expect(node).toHaveAttribute('aria-live', 'polite');
    expect(node).toHaveTextContent('');
  });
});

/** Minimal harness: one field whose error is derived from the current value. */
function EmailProbe() {
  const [value, setValue] = useState('');
  const reveal = useErrorReveal();
  const invalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const error = reveal.shouldReveal('email') && invalid ? 'Bad email' : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        reveal.markSubmitAttempted();
      }}
    >
      <input
        aria-label="Email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        {...reveal.blurProps('email')}
        {...fieldErrorProps('email', error)}
      />
      <FieldError fieldId="email" message={error} />
      <button type="submit">Go</button>
    </form>
  );
}

describe('useErrorReveal timing', () => {
  it('says NOTHING while the user is still typing', () => {
    render(<EmailProbe />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jor' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });

  it('reveals on blur', () => {
    render(<EmailProbe />);
    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: 'jor' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toHaveTextContent('Bad email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('reveals on submit even if the field was never touched', () => {
    render(<EmailProbe />);
    fireEvent.submit(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bad email');
  });

  it('clears as soon as the value is fixed, without waiting for another blur', () => {
    // The nuance that makes reveal-on-blur feel right rather than merely correct:
    // reveal is sticky, but the MESSAGE tracks the value, so a user fixing the
    // field is not left staring at a complaint they already addressed.
    render(<EmailProbe />);
    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: 'jor' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'jordan@pitt.edu' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('does not reveal a sibling field just because this one blurred', () => {
    render(<EmailProbe />);
    fireEvent.blur(screen.getByLabelText('Email'));
    // 'password' was never blurred and no submit happened.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
