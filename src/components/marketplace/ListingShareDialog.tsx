import { useState } from 'react';
import { Check, Link2, Loader2, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { safeImageSrc } from '@/lib/sanitize';
import { shareListingCard, type ListingShareCardInput } from '@/lib/listingShareCard';

interface ListingShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listing: ListingShareCardInput;
}

export function ListingShareDialog({ open, onOpenChange, listing }: ListingShareDialogProps) {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const image = safeImageSrc(listing.imageUrl) ?? '/placeholder.svg';

  const share = async () => {
    setSharing(true);
    try {
      const result = await shareListingCard(listing);
      if (result === 'downloaded') toast.success(t('housing:portal.marketplace.detail.shareDownloaded'));
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError') {
        toast.error(t('housing:portal.marketplace.detail.shareError'));
      }
    } finally {
      setSharing(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(listing.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('housing:portal.marketplace.detail.shareError'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="!z-[10075] !bg-black/50"
        className="z-[10080] w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-card border-0 bg-card p-0 shadow-overlay [&>button]:right-3 [&>button]:top-3"
      >
        <div className="px-6 pb-2 pt-6">
          <DialogTitle className="font-display text-xl font-semibold text-foreground">
            {t('housing:portal.marketplace.detail.shareTitle')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('housing:portal.marketplace.detail.shareDescription')}
          </DialogDescription>
        </div>

        <div className="mx-6 overflow-hidden rounded-card bg-[hsl(var(--page))] p-3">
          <div className="overflow-hidden rounded-card bg-card shadow-raised">
            <div className="aspect-[4/3] overflow-hidden bg-muted">
              <img src={image} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <p className="line-clamp-2 font-display text-lg font-semibold leading-tight text-foreground">
                  {listing.title}
                </p>
                <p className="shrink-0 text-lg font-bold text-foreground">{listing.price}</p>
              </div>
              <p className="mt-3 text-xs font-semibold text-malachite-800">dormcheck</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 px-6 pb-6 pt-4">
          <Button
            className="h-12 w-full gap-2 bg-malachite-800 text-base font-semibold text-white hover:bg-malachite-900 dark:bg-malachite-600 dark:text-stone-950 dark:hover:bg-malachite-500 [&_svg]:size-5"
            onClick={() => void share()}
            disabled={sharing}
          >
            {sharing ? <Loader2 className="animate-spin" /> : <Share2 />}
            {sharing
              ? t('housing:portal.marketplace.detail.preparingShare')
              : t('housing:portal.marketplace.detail.sharePost')}
          </Button>
          <Button variant="ghost" className="h-11 w-full gap-2 [&_svg]:size-4" onClick={() => void copyLink()}>
            {copied ? <Check /> : <Link2 />}
            {copied
              ? t('housing:portal.marketplace.detail.linkCopied')
              : t('housing:portal.marketplace.detail.copyLink')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
