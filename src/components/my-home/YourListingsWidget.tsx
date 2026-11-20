import { useCallback, useState } from 'react';
import { ThumbImage } from '@/components/ui/thumb-image';
import { useNavigate } from 'react-router';
import {
  Camera,
  CheckCircle,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useImageUpload } from '@/hooks/useImageUpload';
import {
  useMyListings,
  type ListingForm,
  type MarketplaceCategory,
  MARKETPLACE_CATEGORIES,
  type MyListing,
} from '@/hooks/useMyListings';
import {
  FULL_SCREEN_DIALOG_BODY_CLASS,
  FULL_SCREEN_DIALOG_CONTENT_CLASS,
  FULL_SCREEN_DIALOG_FOOTER_CLASS,
  FULL_SCREEN_DIALOG_HEADER_CLASS,
} from '@/lib/profileDialogClasses';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WidgetCard } from '@/components/my-home/WidgetCard';
import { isServiceListing } from '@/lib/servicePosts';

interface YourListingsWidgetProps {
  userId: string;
}

/** This widget is deliberately i18n-free (see the strings around it); the three
 *  service states get the same words the localized surfaces use. */
const SERVICE_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  claimed: 'Taken',
  completed: 'Done',
};

const emptyListingForm = (): ListingForm => ({
  title: '',
  description: '',
  price: '',
  category: 'Other',
  imageFiles: [],
  imageFile: null,
});

export function YourListingsWidget({ userId }: YourListingsWidgetProps) {
  const navigate = useNavigate();
  const { pickOne } = useImageUpload();
  const { listings, isLoading, createListing, deleteListing, markAsSold, relistListing } =
    useMyListings(userId);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [listingForm, setListingForm] = useState<ListingForm>(emptyListingForm);
  const [isSubmittingListing, setIsSubmittingListing] = useState(false);
  const [deletingListing, setDeletingListing] = useState<MyListing | null>(null);

  const resetListingForm = useCallback(() => {
    setListingForm(emptyListingForm());
  }, []);

  const handleQuickListingPhotoPick = useCallback(async () => {
    try {
      const file = await pickOne({ source: 'prompt', accept: 'image/*' });
      setListingForm((f) => ({ ...f, imageFile: file ?? null }));
    } catch (error) {
      toast.error('Could not choose photo', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }, [pickOne]);

  if (!isLoading && listings.length === 0) {
    return (
      <>
        <WidgetCard title="Your listings" icon={<ShoppingBag className="h-4 w-4" />} tint="amber" accent>
          <div className="lg:flex lg:min-h-[180px] lg:flex-1 lg:flex-col lg:items-center lg:justify-center lg:text-center">
            <ShoppingBag className="mb-2 hidden h-8 w-8 text-stone-300 lg:block" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Post items you want to sell to other students at your school.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 gap-1.5 bg-malachite-800 hover:bg-malachite-900 text-white"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="w-4 h-4" />
              Add listing
            </Button>
          </div>
        </WidgetCard>
        <CreateListingDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          listingForm={listingForm}
          setListingForm={setListingForm}
          isSubmitting={isSubmittingListing}
          onPickPhoto={() => void handleQuickListingPhotoPick()}
          onReset={resetListingForm}
          onSubmit={async () => {
            setIsSubmittingListing(true);
            try {
              const form: ListingForm = {
                ...listingForm,
                imageFiles: listingForm.imageFiles ?? [],
                imageUrl: listingForm.imageUrl ?? undefined,
              };
              const ok = await createListing(form, () => {
                setShowCreateDialog(false);
                resetListingForm();
                navigate('/marketplace');
              });
              if (ok) {
                setShowCreateDialog(false);
                resetListingForm();
              }
            } finally {
              setIsSubmittingListing(false);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
      <WidgetCard
        title="Your listings"
        icon={<ShoppingBag className="h-4 w-4" />}
        tint="amber"
        accent
        className="lg:col-span-1"
      >
        {isLoading && listings.length === 0 ? (
          <div className="space-y-2 py-1" aria-hidden>
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {listings.map((listing) => {
              const isSold = (listing.status ?? 'available') === 'sold';
              // NO PAYMENTS, and no sale lifecycle: a service post is pinned at
              // price 0, so this row rendered "$0", and "Mark sold" would drive
              // it to a status its own DB CHECK forbids. It shows its own
              // lifecycle state instead, and is closed out from the post itself.
              const isService = isServiceListing(listing);
              const serviceStatus = listing.status ?? 'open';
              return (
                <div
                  key={listing.id}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5 transition-colors hover:bg-muted/40"
                >
                  {/* Whole listing area taps through to edit - a big, easy target. */}
                  <button
                    type="button"
                    onClick={() => navigate(`/marketplace/edit/${listing.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-label={`Edit ${listing.title}`}
                  >
                    <ThumbImage
                      src={safeImageSrc(listing.image_urls?.[0])}
                      thumbWidth={200}
                      alt={listing.title}
                      className="h-16 w-16 shrink-0 rounded-lg bg-muted object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{listing.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {!isService && (
                          <span className="text-sm font-semibold text-foreground">
                            ${Number(listing.price).toLocaleString()}
                          </span>
                        )}
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                            isSold ? 'bg-muted text-muted-foreground' : 'bg-muted text-foreground',
                          )}
                        >
                          {isService
                            ? SERVICE_STATUS_LABELS[serviceStatus] ?? 'Open'
                            : isSold
                              ? 'Sold'
                              : 'Active'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Visible quick action - flip status without opening the menu.
                      Absent for a service post: it is closed out by either party
                      from the post itself, never "sold". */}
                  {isService ? null : isSold ? (
                    <button
                      type="button"
                      onClick={() => void relistListing(listing.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Relist
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void markAsSold(listing.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Mark sold
                    </button>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={`Actions for ${listing.title}`}
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => navigate(`/marketplace/edit/${listing.id}`)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeletingListing(listing)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </WidgetCard>

      <CreateListingDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        listingForm={listingForm}
        setListingForm={setListingForm}
        isSubmitting={isSubmittingListing}
        onPickPhoto={() => void handleQuickListingPhotoPick()}
        onReset={resetListingForm}
        onSubmit={async () => {
          setIsSubmittingListing(true);
          try {
            const form: ListingForm = {
              ...listingForm,
              imageFiles: listingForm.imageFiles ?? [],
              imageUrl: listingForm.imageUrl ?? undefined,
            };
            const ok = await createListing(form, () => {
              setShowCreateDialog(false);
              resetListingForm();
              navigate('/marketplace');
            });
            if (ok) {
              setShowCreateDialog(false);
              resetListingForm();
            }
          } finally {
            setIsSubmittingListing(false);
          }
        }}
      />

      <AlertDialog open={!!deletingListing} onOpenChange={(open) => !open && setDeletingListing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete listing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{deletingListing?.title}&quot; from the marketplace. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deletingListing) {
                  await deleteListing(deletingListing.id, () => setDeletingListing(null));
                  setDeletingListing(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CreateListingDialog({
  open,
  onOpenChange,
  listingForm,
  setListingForm,
  isSubmitting,
  onPickPhoto,
  onReset,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingForm: ListingForm;
  setListingForm: React.Dispatch<React.SetStateAction<ListingForm>>;
  isSubmitting: boolean;
  onPickPhoto: () => void;
  onReset: () => void;
  onSubmit: () => Promise<void>;
}) {
  const handleOpenChange = (next: boolean) => {
    if (!next) onReset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName="bg-black/60"
        className={cn(FULL_SCREEN_DIALOG_CONTENT_CLASS, 'sm:!max-w-lg [&>button]:hidden')}
      >
        <DialogHeader
          className={cn(
            FULL_SCREEN_DIALOG_HEADER_CLASS,
            'space-y-0 border-b border-border !px-6 !pb-4 sm:!px-6 sm:!pt-6 sm:!pr-6',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 text-left">
              <DialogTitle>Add Listing</DialogTitle>
              <DialogDescription>
                Sell items to other students at your school. Buyers can message you through DormCheck.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div className={cn(FULL_SCREEN_DIALOG_BODY_CLASS, '!px-6')}>
          <div className="space-y-4">
          <div>
            <Label htmlFor="listing-title">Title</Label>
            <Input
              id="listing-title"
              value={listingForm.title}
              onChange={(e) => setListingForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g., Mini Fridge"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="listing-desc">Description (optional)</Label>
            <Textarea
              id="listing-desc"
              value={listingForm.description}
              onChange={(e) => setListingForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Condition, details..."
              rows={2}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="listing-price">Price ($)</Label>
              <Input
                id="listing-price"
                type="text"
                inputMode="decimal"
                value={listingForm.price}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setListingForm((f) => ({ ...f, price: '' }));
                    return;
                  }
                  let s = v.replace(/[^0-9.]/g, '');
                  const idx = s.indexOf('.');
                  if (idx !== -1) {
                    const before = s.slice(0, idx);
                    const after = s.slice(idx + 1).replace(/\./g, '').slice(0, 2);
                    s = before + '.' + after;
                  }
                  setListingForm((f) => ({ ...f, price: s }));
                }}
                placeholder="0"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="listing-category">Category</Label>
              <Select
                value={listingForm.category}
                onValueChange={(v) =>
                  setListingForm((f) => ({ ...f, category: v as MarketplaceCategory }))
                }
              >
                <SelectTrigger id="listing-category" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Photo</Label>
            <div className="mt-1 flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onPickPhoto}>
                <Camera className="w-4 h-4" />
                {listingForm.imageFile
                  ? listingForm.imageFile.name
                  : listingForm.imageUrl
                    ? 'Change photo'
                    : 'Choose photo'}
              </Button>
              {(listingForm.imageUrl || listingForm.imageFile) && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-muted shrink-0">
                  {listingForm.imageFile ? (
                    <img
                      src={URL.createObjectURL(listingForm.imageFile)}
                      alt="Listing photo preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={safeImageSrc(listingForm.imageUrl) || '/placeholder.svg'}
                      alt={listingForm.title ? `${listingForm.title} photo` : 'Listing photo'}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = '/placeholder.svg';
                      }}
                    />
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Optional. JPG or PNG.</p>
          </div>
          </div>
        </div>

        <div
          className={cn(
            FULL_SCREEN_DIALOG_FOOTER_CLASS,
            'flex flex-col gap-2 border-t border-border !px-6 !py-4',
          )}
        >
          <Button
            disabled={
              !listingForm.title.trim() ||
              (() => {
                const n = parseFloat(listingForm.price);
                return listingForm.price === '' || Number.isNaN(n) || n < 0;
              })() ||
              isSubmitting
            }
            className="w-full bg-malachite-800 text-white hover:bg-malachite-900"
            onClick={() => void onSubmit()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Posting...
              </>
            ) : (
              'Post'
            )}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
