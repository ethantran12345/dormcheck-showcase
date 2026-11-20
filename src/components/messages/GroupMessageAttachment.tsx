import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Instagram, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GroupMessageMetadata } from '@/types/groupMessageMeta';

interface GroupMessageAttachmentProps {
  metadata: GroupMessageMetadata;
  isMine: boolean;
}

/**
 * Renders the structured payload on a group message as a card (shared checklist
 * item) or a chip (shared Instagram handle), in place of the plain text bubble.
 */
export function GroupMessageAttachment({ metadata, isMine }: GroupMessageAttachmentProps) {
  const { t } = useTranslation();

  if (metadata.type === 'checklist_item') {
    return (
      <Link
        to="/checklist"
        className={cn(
          'flex w-64 max-w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5 shadow-raised transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isMine && 'ml-auto',
        )}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {metadata.imageUrl ? (
            <img src={metadata.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Package className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('messaging:group.share.bringingLabel')}
          </span>
          <span className="block truncate text-sm font-semibold text-foreground">{metadata.name}</span>
          {metadata.category && (
            <span className="block truncate text-xs text-muted-foreground">{metadata.category}</span>
          )}
        </span>
      </Link>
    );
  }

  // instagram
  return (
    <a
      href={`https://instagram.com/${metadata.username}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-raised transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isMine && 'ml-auto',
      )}
    >
      <Instagram className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <span className="truncate">@{metadata.username}</span>
      <span className="text-xs text-muted-foreground">{t('messaging:group.share.igOnInstagram')}</span>
    </a>
  );
}
