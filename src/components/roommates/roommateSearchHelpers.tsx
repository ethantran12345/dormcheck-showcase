import { Link } from 'react-router';
import { MapPin, Wifi, Zap, Droplet, Flame } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dormSlugFromName } from '@/lib/dormSlug';
import type { RoommateSearchPost, ProfileEmbed } from './roommateSearchTypes';
import { HOUSING_OFF, HOUSING_ON } from './roommateSearchTypes';

export function hashName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? 'Anonymous').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatPostedAgo(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('roommates:posts.postedJustNow');
  if (mins < 60) return t('roommates:posts.postedMinsAgo', { mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('roommates:posts.postedHrsAgo', { hrs });
  const days = Math.floor(hrs / 24);
  if (days === 1) return t('roommates:posts.postedOneDayAgo');
  return t('roommates:posts.postedDaysAgo', { days });
}

export function normalizeProfile(p: ProfileEmbed | ProfileEmbed[] | null | undefined): ProfileEmbed | null {
  if (p == null) return null;
  return Array.isArray(p) ? p[0] ?? null : p;
}

const locationChipClass =
  'inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground border border-border hover:opacity-90 transition-opacity';

export function LocationTagChip({ post }: { post: RoommateSearchPost }) {
  const raw = post.address?.trim();
  if (!raw) return null;

  if (post.housing_type === HOUSING_OFF) {
    const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={cn(locationChipClass, 'cursor-pointer')}
      >
        <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{raw}</span>
      </a>
    );
  }

  if (post.housing_type === HOUSING_ON) {
    return (
      <Link
        to={`/housing/${dormSlugFromName(raw)}`}
        onClick={(e) => e.stopPropagation()}
        className={cn(locationChipClass, 'cursor-pointer')}
      >
        <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{raw}</span>
      </Link>
    );
  }

  return (
    <span className={locationChipClass}>
      <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{raw}</span>
    </span>
  );
}

export function genderPreferenceLabel(gp: string | null | undefined, t: (key: string) => string): string | null {
  if (gp === 'any') return t('roommates:posts.any');
  if (gp === 'all-female') return t('roommates:posts.allFemale');
  if (gp === 'all-male') return t('roommates:posts.allMale');
  return null;
}

export function utilityIcon(name: string): LucideIcon | null {
  const n = name.toLowerCase();
  if (n.includes('wifi') || n.includes('wi-fi') || n.includes('internet')) return Wifi;
  if (n.includes('electric')) return Zap;
  if (n.includes('water')) return Droplet;
  if (n.includes('gas') || n.includes('heat')) return Flame;
  return null;
}

export function cleanSocialHandle(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^@/, '');
}
