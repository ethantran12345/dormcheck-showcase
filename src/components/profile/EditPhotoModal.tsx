import { useState, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from '@/lib/cropImage';
import { getCroppedImg } from '@/lib/cropImage';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

export type AspectPreset = { value: number; label: string };

const DEFAULT_ASPECT_PRESETS: AspectPreset[] = [
  { value: 3 / 2, label: 'Landscape (3:2)' },
  { value: 3 / 4, label: 'Portrait (3:4)' },
];

interface EditPhotoModalProps {
  open: boolean;
  onClose: () => void;
  imageSrc: string;
  onSave: (blob: Blob) => void;
  /** Optional initial aspect for feed preview: 3/2 (landscape) or 3/4 (portrait). When autoDetectAspect is true, this is overridden by image dimensions. */
  aspect?: number;
  /** When true, detects image orientation (width vs height) and sets default aspect: landscape (3/2) if width > height, portrait (3/4) otherwise. User can still override with buttons. */
  autoDetectAspect?: boolean;
  /**
   * Aspect ratio preset buttons shown in the modal.
   * When omitted, defaults to feed preview ratios (3:2 / 3:4).
   */
  aspectPresets?: AspectPreset[];
  /** Label above the aspect preset buttons. Defaults to "Feed preview shape" for the legacy presets. */
  aspectControlsLabel?: string;
  /** Override whether aspect controls are shown. Defaults to true only when there are multiple presets. */
  showAspectControls?: boolean;
}

export function EditPhotoModal({
  open,
  onClose,
  imageSrc,
  onSave,
  aspect: aspectProp,
  autoDetectAspect = false,
  aspectPresets,
  aspectControlsLabel,
  showAspectControls,
}: EditPhotoModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState([1] as number[]);
  const [rotation, setRotation] = useState([0] as number[]);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const presets = aspectPresets ?? DEFAULT_ASPECT_PRESETS;
  const defaultAspect = aspectProp !== undefined ? aspectProp : presets[0]?.value ?? 3 / 2;
  const [aspectChoice, setAspectChoice] = useState<number>(defaultAspect);

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(
        imageSrc,
        croppedAreaPixels,
        rotation[0] ?? 0
      );
      onSave(blob);
      onClose();
    } catch (err) {
      console.error('Crop failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setCrop({ x: 0, y: 0 });
    setZoom([1]);
    setRotation([0]);
    setCroppedAreaPixels(null);
    setAspectChoice(defaultAspect);
    onClose();
  };

  const handleAspectChange = (value: number) => {
    setAspectChoice(value);
    setCroppedAreaPixels(null);
  };

  useEffect(() => {
    if (open && aspectProp !== undefined && !autoDetectAspect) setAspectChoice(aspectProp);
  }, [open, aspectProp, autoDetectAspect]);

  useEffect(() => {
    if (!open || !imageSrc || !autoDetectAspect) return;
    const img = new Image();
    img.src = imageSrc;
    const onLoad = () => {
      const isLandscape = img.width > img.height;
      const landscapePreset = presets.find((p) => p.value >= 1) ?? presets[0];
      const portraitPreset = presets.find((p) => p.value < 1) ?? presets[presets.length - 1] ?? presets[0];
      setAspectChoice(isLandscape ? landscapePreset.value : portraitPreset.value);
    };
    img.onload = onLoad;
    return () => { img.onload = null; img.src = ''; };
  }, [open, imageSrc, autoDetectAspect, presets]);

  const resolvedAspectControlsLabel =
    aspectControlsLabel ?? (aspectPresets ? 'Aspect ratio' : 'Feed preview shape');
  const computedShowAspectControls = showAspectControls ?? presets.length > 1;
  const isAspectSelected = (value: number) => Math.abs(aspectChoice - value) < 1e-6;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        overlayClassName="z-[10060]"
        className="z-[10070] max-w-lg p-0 gap-0 overflow-hidden rounded-2xl"
      >
        <DialogTitle className="sr-only">Edit Photo</DialogTitle>
        <div className="relative h-[320px] w-full bg-stone-900">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom[0] ?? 1}
            rotation={rotation[0] ?? 0}
            aspect={aspectChoice}
            cropShape="rect"
            showGrid={true}
            onCropChange={setCrop}
            onCropComplete={onCropComplete}
            onZoomChange={(z) => setZoom([z])}
            onRotationChange={(r) => setRotation([r])}
          />
        </div>
        <div className="p-4 space-y-4 border-t border-border">
          {computedShowAspectControls && (
            <div className="space-y-2">
              <Label className="text-sm">{resolvedAspectControlsLabel}</Label>
              <div className="flex gap-2">
                {presets.map((p) => (
                  <Button
                    key={p.value}
                    type="button"
                    variant="outline"
                    aria-pressed={isAspectSelected(p.value)}
                    onClick={() => handleAspectChange(p.value)}
                    className={`h-auto flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                      isAspectSelected(p.value)
                        ? 'border-malachite-600 bg-malachite-600/10 text-foreground hover:bg-malachite-600/10'
                        : 'border-border bg-muted/50 text-muted-foreground hover:border-malachite-600/50 hover:bg-muted/50 hover:text-muted-foreground'
                    }`}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-sm">Zoom</Label>
            <Slider
              value={zoom}
              onValueChange={setZoom}
              min={1}
              max={3}
              step={0.1}
              className="w-full [&_.bg-primary]:!bg-malachite-600 [&_button]:!border-malachite-600 [&_button]:focus-visible:!ring-malachite-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Rotation</Label>
            <Slider
              value={rotation}
              onValueChange={setRotation}
              min={0}
              max={360}
              step={1}
              className="w-full [&_.bg-primary]:!bg-malachite-600 [&_button]:!border-malachite-600 [&_button]:focus-visible:!ring-malachite-600"
            />
          </div>
        </div>
        <DialogFooter className="p-4 pt-0 gap-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-malachite-800 hover:bg-malachite-900 text-white focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
