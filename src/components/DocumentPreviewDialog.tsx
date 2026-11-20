import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { usePinchZoom } from '@/hooks/usePinchZoom';
import { publicAssetUrl } from '@/lib/publicAssetUrl';
import { saveDocumentPages } from '@/lib/saveDocumentPages';

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Same-origin `/public` path to the PDF (e.g. `/pitt-arrival-parking-pass.pdf`).
   * Resolves inside the webview in both web and native, so the preview never
   * leaves the app.
   */
  path: string;
  title: string;
  /** Suggested filename stem when the user saves. Defaults to the path basename. */
  fileName?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

/**
 * In-app document preview: rasterizes every page of a PDF and shows them stacked
 * in a pinch-zoom / pan lightbox with a save action. On native, "Save" hands the
 * rendered pages to the iOS share sheet (Save to Photos / Files) so PDFs like the
 * arrival parking pass stay inside the app instead of bouncing out to Safari.
 */
export function DocumentPreviewDialog({
  open,
  onOpenChange,
  path,
  title,
  fileName,
}: DocumentPreviewDialogProps) {
  const [images, setImages] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  // Cache the rendered rasters per path so re-opening is instant.
  const renderedFor = useRef<string | null>(null);

  const externalHref = publicAssetUrl(path);
  const downloadName = fileName ?? path.split('/').pop() ?? 'document.pdf';

  const { containerRef, contentRef, scale, reset, zoomIn, zoomOut, handlers } = usePinchZoom(
    MIN_SCALE,
    MAX_SCALE,
  );

  // Reset zoom/pan each time the dialog opens or the document changes.
  useEffect(() => {
    if (open) reset();
  }, [open, path, reset]);

  useEffect(() => {
    if (!open) return;
    if (renderedFor.current === path && images.length) {
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setImages([]);
    (async () => {
      try {
        const { renderPdfPages } = await import('@/lib/renderPdfPages');
        const pages = await renderPdfPages(path);
        if (cancelled) return;
        renderedFor.current = path;
        setImages(pages);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, path, images.length]);

  const handleSave = async () => {
    if (status !== 'ready' || saving) return;
    setSaving(true);
    try {
      await saveDocumentPages(images, downloadName, title);
    } catch {
      // User cancelled the share sheet, or the write failed - nothing to do.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 left-0 top-0 grid h-full w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:inset-auto sm:left-[50%] sm:top-[50%] sm:h-[90vh] sm:w-[96vw] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
          <DialogTitle className="truncate text-sm font-semibold text-foreground">{title}</DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close preview"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Pan / zoom surface */}
        <div
          ref={containerRef}
          {...handlers}
          className="relative touch-none select-none overflow-hidden bg-card"
        >
          {status === 'loading' && (
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
          {status === 'error' && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load the preview.</p>
              <a
                href={externalHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-malachite-800 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Open in browser instead
              </a>
            </div>
          )}
          {status === 'ready' && images.length > 0 && (
            <div ref={contentRef} className="w-full will-change-transform">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={images.length > 1 ? `${title} - page ${i + 1}` : title}
                  draggable={false}
                  className="pointer-events-none block w-full select-none [-webkit-touch-callout:none]"
                />
              ))}
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:pb-2.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= MIN_SCALE || status !== 'ready'}
              aria-label="Zoom out"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-12 text-center text-xs font-medium tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={scale >= MAX_SCALE || status !== 'ready'}
              aria-label="Zoom in"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={scale === 1 || status !== 'ready'}
              aria-label="Reset zoom"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={status !== 'ready' || saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-malachite-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-malachite-900 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
