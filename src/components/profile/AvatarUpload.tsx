import { useState, useCallback } from 'react';
import { Camera, Loader2, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useImageUpload } from '@/hooks/useImageUpload';
import { getInitials } from '@/lib/identity';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { EditPhotoModal } from './EditPhotoModal';

interface AvatarUploadProps {
  /** Current avatar URL to display */
  value?: string | null;
  /** Called when user selects a new file */
  onFileSelect?: (file: File | null) => void;
  /** Optional className for the container */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Name used for the initials fallback; falls back to a person icon when empty */
  fallbackName?: string;
}

const sizeClasses = {
  sm: 'w-16 h-16',
  md: 'w-20 h-20',
  lg: 'w-24 h-24',
};

export function AvatarUpload({
  value,
  onFileSelect,
  className,
  size = 'lg',
  fallbackName,
}: AvatarUploadProps) {
  const { pickOne } = useImageUpload();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editImageSrc, setEditImageSrc] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const openCropForFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setEditImageSrc(url);
    setEditModalOpen(true);
  }, []);

  const handleClick = useCallback(async () => {
    if (isPicking) return;

    setIsPicking(true);

    try {
      const file = await pickOne({ source: 'prompt' });
      if (!file) return;
      openCropForFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to choose a photo.';
      toast.error(message);
    } finally {
      setIsPicking(false);
    }
  }, [isPicking, openCropForFile, pickOne]);

  const handleEditClose = useCallback(() => {
    setEditModalOpen(false);
    if (editImageSrc) URL.revokeObjectURL(editImageSrc);
    setEditImageSrc(null);
  }, [editImageSrc]);

  const handleEditSave = useCallback(
    (blob: Blob) => {
      const file = new File([blob], 'avatar.jpg', { type: blob.type });
      onFileSelect?.(file);
      handleEditClose();
    },
    [onFileSelect, handleEditClose]
  );

  const previewUrl = value ?? undefined;
  const initials = fallbackName?.trim() ? getInitials(fallbackName) : null;

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div className="relative group">
        <Avatar className={cn(sizeClasses[size], 'ring-2 ring-border')}>
          <AvatarImage src={previewUrl} alt="Profile avatar" />
          <AvatarFallback className="bg-gradient-to-br from-malachite-500 to-malachite-700 text-xl font-extrabold text-white">
            {initials ?? <User className="w-1/2 h-1/2" />}
          </AvatarFallback>
        </Avatar>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="absolute bottom-0 right-0 h-8 w-8 rounded-full shadow-raised"
          disabled={isPicking}
          onClick={handleClick}
          aria-label="Change avatar"
        >
          {isPicking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        </Button>
      </div>
      {editImageSrc && (
        <EditPhotoModal
          open={editModalOpen}
          onClose={handleEditClose}
          imageSrc={editImageSrc}
          onSave={handleEditSave}
          aspect={1}
        />
      )}
    </div>
  );
}
