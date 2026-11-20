import type { DmPollMessageMetadata } from '@/types/dmMessageMeta';
import type { DmPollVoteRow } from '@/hooks/useDmPollVotes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DmPollCard({
  poll,
  votes,
  currentUserId,
  onVote,
  disabled = false,
}: {
  poll: DmPollMessageMetadata;
  votes: DmPollVoteRow[];
  currentUserId: string | null;
  onVote: (optionIndex: number) => void;
  disabled?: boolean;
}) {
  const total = votes.length;
  const mine = votes.find((vote) => vote.userId === currentUserId)?.optionIndex;
  return (
    <section className="min-w-[220px] space-y-2" aria-label={`Poll: ${poll.question}`}>
      <div>
        <p className="text-sm font-semibold leading-snug">{poll.question}</p>
        <p className="mt-0.5 text-xs opacity-70">{total} {total === 1 ? 'vote' : 'votes'}</p>
      </div>
      <div className="space-y-1.5">
        {poll.options.map((option, index) => {
          const count = votes.filter((vote) => vote.optionIndex === index).length;
          const percentage = total ? Math.round((count / total) * 100) : 0;
          const selected = mine === index;
          return (
            <Button
              key={option}
              variant="ghost"
              disabled={disabled}
              onClick={() => onVote(index)}
              className={cn(
                'relative flex h-auto w-full whitespace-normal overflow-hidden rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default',
                selected ? 'border-malachite-600 bg-malachite-600/15' : 'border-current/15 hover:bg-black/5 dark:hover:bg-white/10',
              )}
              aria-pressed={selected}
            >
              <span className={cn('absolute inset-y-0 left-0 opacity-60', selected ? 'bg-malachite-600/20' : 'bg-current/10')} style={{ width: `${percentage}%` }} />
              <span className="relative flex min-w-0 flex-1 items-center gap-2">
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected && 'border-malachite-800 bg-malachite-800 text-white dark:border-malachite-800 dark:bg-malachite-800')}>
                  {selected ? '✓' : null}
                </span>
                <span className="truncate">{option}</span>
              </span>
              <span className="relative ml-3 tabular-nums text-xs opacity-75">{count}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
