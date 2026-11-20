import { useTranslation } from 'react-i18next';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ProfileAvatarFallback } from '@/components/profile/ProfileAvatarFallback';
import { safeImageSrc } from '@/lib/sanitize';
import type { RoommateProfileRow } from './RoommateCard';
import type { MatchResult } from '@/lib/roommateMatch';

export interface TopMatchEntry {
  profile: RoommateProfileRow;
  match: MatchResult;
}

interface TopMatchesBandProps {
  entries: TopMatchEntry[];
  onSelect: (profile: RoommateProfileRow) => void;
}

/**
 * "Top matches for you" - horizontal scroll band above the Browse grid.
 * Caller gates visibility (underclassman viewer, complete profile, enough
 * high-confidence matches) and passes already-computed scores.
 */
export function TopMatchesBand({ entries, onSelect }: TopMatchesBandProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <section aria-label={t('roommates:topMatches.ariaLabel')} className="mb-5">
      <h2 className="text-base font-semibold text-foreground">{t('roommates:topMatches.title')}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t('roommates:topMatches.subtitle')}</p>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {entries.map(({ profile, match }) => {
          const name =
            profile.full_name ?? profile.display_name ?? profile.name ?? 'Anonymous';
          const avatar = safeImageSrc(profile.avatar_url ?? null);
          return (
            <Button
              key={profile.id}
              type="button"
              variant="ghost"
              onClick={() => onSelect(profile)}
              className="flex h-auto w-36 shrink-0 snap-start flex-col items-center justify-start gap-2 rounded-xl border border-border bg-card p-3 text-center font-normal shadow-raised transition-shadow hover:bg-card hover:shadow-overlay"
            >
              <Avatar className="h-14 w-14 rounded-full border border-border">
                {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                <ProfileAvatarFallback name={name} />
              </Avatar>
              <span className="w-full truncate text-sm font-medium text-foreground">{name}</span>
              <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
                {t('roommates:topMatches.matchPct', { pct: match.score })}
              </span>
              {match.reasons[0] && (
                <span className="line-clamp-2 w-full text-xs text-muted-foreground">
                  {match.reasons[0]}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
