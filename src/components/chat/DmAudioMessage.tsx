import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Volume2 } from 'lucide-react';
import { downloadDmAudio, audioDurationLabel } from '@/lib/dmAudio';
import { Button } from '@/components/ui/button';
import type { DmAudioMessageMetadata } from '@/types/dmMessageMeta';
import { cn } from '@/lib/utils';

export function DmAudioMessage({ metadata, isMe }: { metadata: DmAudioMessageMetadata; isMe: boolean }) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source);
  }, [source]);

  useEffect(() => {
    if (!source) return;
    void audioRef.current?.play().catch(() => {});
  }, [source]);

  const preparePlayback = async () => {
    if (source || loading) {
      void audioRef.current?.play().catch(() => {});
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      setSource(await downloadDmAudio(metadata.path));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn('flex min-w-[190px] items-center gap-3 px-1 py-0.5', isMe ? 'text-white' : 'text-foreground')}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => { void preparePlayback(); }}
        disabled={loading}
        aria-label={source ? 'Play voice message' : 'Load voice message'}
        className={cn(
          'h-9 w-9 shrink-0 rounded-full transition-opacity disabled:opacity-60',
          isMe ? 'bg-white/20 hover:bg-white/30 [&_svg]:text-white' : 'bg-malachite-800 hover:bg-malachite-900 dark:bg-malachite-800 dark:hover:bg-malachite-900 [&_svg]:text-white',
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4 fill-current" aria-hidden />}
      </Button>
      <div className="min-w-0 flex-1">
        {source ? (
          <audio ref={audioRef} controls preload="metadata" src={source} className="h-8 w-full max-w-[210px]" />
        ) : (
          <div className="flex h-8 items-center gap-2" aria-live="polite">
            <Volume2 className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <div className={cn('h-1 flex-1 rounded-full', isMe ? 'bg-white/35' : 'bg-foreground/20')} />
            <span className="text-xs tabular-nums opacity-80">{audioDurationLabel(metadata.durationMs)}</span>
          </div>
        )}
        {failed ? <p className="mt-1 text-xs text-destructive">Couldn’t load this voice message.</p> : null}
      </div>
    </div>
  );
}
