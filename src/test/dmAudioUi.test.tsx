import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DmPollCard } from '@/components/chat/DmPollCard';

const poll = { type: 'poll' as const, question: 'When should we meet?', options: ['5:00', '6:00'] };

describe('DmPollCard', () => {
  it('renders live counts, marks my selection, and changes the selected option', () => {
    const onVote = vi.fn();
    render(
      <DmPollCard
        poll={poll}
        currentUserId="me"
        votes={[
          { messageId: 1, conversationId: 'thread', userId: 'me', optionIndex: 0 },
          { messageId: 1, conversationId: 'thread', userId: 'other', optionIndex: 1 },
        ]}
        onVote={onVote}
      />,
    );

    expect(screen.getByText('2 votes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5:00/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /6:00/i }));
    expect(onVote).toHaveBeenCalledWith(1);
  });

  it('does not expose interactive voting for an optimistic message', () => {
    render(<DmPollCard poll={poll} currentUserId="me" votes={[]} onVote={() => {}} disabled />);
    expect(screen.getByRole('button', { name: /5:00/i })).toBeDisabled();
  });
});
