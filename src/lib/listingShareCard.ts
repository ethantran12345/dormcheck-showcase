import { Capacitor } from '@capacitor/core';
import tokens from '@/design/tokens.json';

export interface ListingShareCardInput {
  title: string;
  price: string;
  condition?: string;
  location?: string;
  imageUrl?: string;
  url: string;
}

export function buildListingShareCaption(input: ListingShareCardInput): string {
  return `${input.title} · ${input.price}\nStudent Market on Dormcheck\n${input.url}`;
}

const shareCardColors = {
  page: tokens.color.muted.hex,
  surface: tokens.color.surface.hex,
  placeholder: tokens.color['stone-200'].hex,
  heading: tokens.color['stone-900'].hex,
  body: tokens.color['stone-600'].hex,
  brand: tokens.color['malachite-800'].hex,
  muted: tokens.color['stone-500'].hex,
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight, maxWidth));
}

async function loadImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url || url.endsWith('/placeholder.svg')) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Render a portrait card sized for Stories while staying crisp in messages. */
export async function renderListingShareCard(input: ListingShareCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  ctx.fillStyle = shareCardColors.page;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = shareCardColors.surface;
  roundedRect(ctx, 54, 54, 972, 1242, 44);
  ctx.fill();

  const image = await loadImage(input.imageUrl);
  ctx.save();
  roundedRect(ctx, 94, 94, 892, 820, 32);
  ctx.clip();
  if (image) {
    const scale = Math.max(892 / image.naturalWidth, 820 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, 94 + (892 - width) / 2, 94 + (820 - height) / 2, width, height);
  } else {
    ctx.fillStyle = shareCardColors.placeholder;
    ctx.fillRect(94, 94, 892, 820);
  }
  ctx.restore();

  ctx.fillStyle = shareCardColors.heading;
  ctx.font = '700 58px Jost, Nunito, system-ui, sans-serif';
  wrapText(ctx, input.title, 94, 1000, 690, 66, 2);

  ctx.textAlign = 'right';
  ctx.font = '800 58px Nunito, system-ui, sans-serif';
  ctx.fillText(input.price, 986, 1000, 250);
  ctx.textAlign = 'left';

  const details = [input.condition, input.location].filter(Boolean).join(' · ');
  if (details) {
    ctx.fillStyle = shareCardColors.body;
    ctx.font = '500 31px Nunito, system-ui, sans-serif';
    ctx.fillText(details, 94, 1155, 850);
  }

  ctx.fillStyle = shareCardColors.brand;
  roundedRect(ctx, 94, 1200, 38, 38, 12);
  ctx.fill();
  ctx.fillStyle = shareCardColors.heading;
  ctx.font = '700 31px Sora, Nunito, system-ui, sans-serif';
  ctx.fillText('dormcheck', 148, 1231);
  ctx.fillStyle = shareCardColors.muted;
  ctx.font = '500 27px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Student Market', 986, 1231);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render share card'))), 'image/png');
  });
}

export type ListingShareResult = 'shared' | 'downloaded' | 'copied';

export async function shareListingCard(input: ListingShareCardInput): Promise<ListingShareResult> {
  const blob = await renderListingShareCard(input);
  const file = new File([blob], 'dormcheck-listing.png', { type: 'image/png' });
  const caption = buildListingShareCaption(input);

  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const base64 = await blobToBase64(blob);
    const saved = await Filesystem.writeFile({
      path: `share/dormcheck-listing-${Date.now()}.png`,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    await Share.share({ title: input.title, text: caption, url: input.url, files: [saved.uri] });
    return 'shared';
  }

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: input.title, text: caption, files: [file] });
    return 'shared';
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'dormcheck-listing.png';
  link.click();
  URL.revokeObjectURL(objectUrl);
  return 'downloaded';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}
