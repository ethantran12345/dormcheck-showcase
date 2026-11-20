import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, X } from 'lucide-react';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { ProfileEditFields } from '@/components/profile/ProfileEditFields';
import { PageContainer } from '@/components/ui/page-container';

/**
 * Modal-overlay wrapper around ProfileEditFields. Remaining consumer:
 * RoommatePage (roommate-context quick edit). The canonical full-profile surface
 * is Settings → Profile (`SettingsProfile`); `/profile` redirects there.
 */
export default function EditProfile({
  onClose,
  onEditHousing,
}: {
  onClose?: () => void;
  onEditHousing?: () => void;
} = {}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Scroll-lock, backdrop, Escape and the focus trap all come from Dialog now
  // (T3.5) - this used to hand-roll body.style.overflow plus a keydown handler
  // on a non-focusable div, which meant Escape only ever worked by accident.

  const modalOverlay = useModalOverlay();
  const setHideBottomNavRef = useRef(modalOverlay?.setHideBottomNav);
  setHideBottomNavRef.current = modalOverlay?.setHideBottomNav;
  useEffect(() => {
    setHideBottomNavRef.current?.(true);
    return () => setHideBottomNavRef.current?.(false);
  }, []);

  const closeEditor = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) closeEditor(); }}>
      <DialogContent
        // Full-screen takeover on mobile (unchanged feel: no scrim, no rounded
        // card); centered card at md+. `[&>button]:hidden` suppresses Dialog's
        // stock close - this header already has its own Back/X controls.
        className={cn(
          'flex flex-col gap-0 overflow-hidden bg-background p-0 [&>button]:hidden',
          isMobile
            ? 'inset-0 left-0 top-0 h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 shadow-none sm:rounded-none'
            : 'mx-4 w-full max-w-lg max-h-[85vh] rounded-xl border border-border/60 bg-card shadow-overlay'
        )}
        // Mobile overlay matches the takeover's own background so the
        // scrollbar-gutter strip beside a fixed inset-0 panel never shows the
        // page through; desktop keeps the dimming scrim.
        overlayClassName={isMobile ? 'bg-background' : 'bg-black/50'}
        aria-describedby={undefined}
      >
        <div
          className={cn(
            'sticky top-0 z-10 flex shrink-0 items-center border-b border-border/60 bg-card px-4 py-3',
            !isMobile && 'justify-end rounded-t-xl',
            isMobile && 'justify-between pt-[max(0.75rem,env(safe-area-inset-top))]'
          )}
        >
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-1 gap-2"
              onClick={closeEditor}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          ) : null}
          {/* Always rendered: Dialog needs an accessible name. Visible as the
              mobile header title, sr-only on the desktop card. */}
          <DialogTitle className={cn(isMobile ? 'text-base font-semibold' : 'sr-only')}>
            Edit Profile
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={closeEditor}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            isMobile ? 'px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]' : 'p-6'
          )}
        >
          <PageContainer width="content" className="py-4 md:py-0">
            <ProfileEditFields
              onSaved={closeEditor}
              onEditHousing={onEditHousing}
              onDeletedProfile={closeEditor}
            />
          </PageContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
