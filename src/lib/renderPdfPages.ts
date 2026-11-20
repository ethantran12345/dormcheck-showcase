/**
 * Render a PDF's pages to PNG data URLs, for in-app preview.
 *
 * pdfjs-dist is heavy, so this module is only ever reached via dynamic
 * `import()` (see `DocumentPreviewDialog`) - keeping it out of the main bundle
 * as its own lazily-loaded chunk. The worker is shipped as a separate asset by
 * Vite (`?url`) and wired up once on module load.
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

async function renderPageToDataUrl(page: PDFPageProxy, targetWidth: number): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const renderScale = Math.min(3, Math.max(1, targetWidth / base.width));
  const viewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

/**
 * Render every page of a PDF to a PNG data URL (one per page, in order).
 *
 * @param path         Same-origin URL to the PDF (relative `/public` path works
 *                     in both web and the native webview).
 * @param targetWidth  Target raster width in CSS px; each page is rendered at up
 *                     to 3× its intrinsic width so it stays crisp when zoomed.
 */
export async function renderPdfPages(path: string, targetWidth = 1400): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument(path).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      // Pages render sequentially to keep peak memory bounded.
      const page = await pdf.getPage(n);
      pages.push(await renderPageToDataUrl(page, targetWidth));
    }
    return pages;
  } finally {
    // Free worker-side resources; the data URLs are already captured.
    void pdf.destroy();
  }
}
