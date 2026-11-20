import { Capacitor } from '@capacitor/core';

/**
 * Persist the rendered preview pages to the device.
 *
 * - **Web**: triggers a normal browser download of each PNG.
 * - **Native (iOS)**: writes the PNGs into the app cache, then opens the system
 *   share sheet pointed at those image files. Because they're images, iOS offers
 *   "Save Image(s)" (→ Photos) *and* "Save to Files" - keeping the user inside
 *   the app instead of bouncing to Safari.
 *
 * @param images    PNG data URLs, one per page (from `renderPdfPages`).
 * @param baseName  Filename stem, e.g. `pitt-arrival-parking-pass`.
 * @param title     Human label for the share sheet.
 */
export async function saveDocumentPages(
  images: string[],
  baseName: string,
  title: string,
): Promise<void> {
  if (!images.length) return;
  const stem = baseName.replace(/\.[^.]+$/, '');
  const fileName = (i: number) => (images.length > 1 ? `${stem}-page-${i + 1}.png` : `${stem}.png`);

  if (!Capacitor.isNativePlatform()) {
    images.forEach((src, i) => {
      const a = document.createElement('a');
      a.href = src;
      a.download = fileName(i);
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    return;
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  const uris: string[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const data = images[i].replace(/^data:[^,]*,/, '');
    // Sequential writes keep peak memory low.
    const { uri } = await Filesystem.writeFile({
      path: fileName(i),
      data,
      directory: Directory.Cache,
    });
    uris.push(uri);
  }

  await Share.share({ title, files: uris });
}
