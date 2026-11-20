import { safeImageSrc } from '@/lib/sanitize';

/**
 * Parses a floorplan string that may contain comma-separated URLs
 * @param floorplan - The floorplan string from the database (may be single URL or comma-separated)
 * @returns Array of floorplan objects with URL and label (only https/http URLs included)
 */
export interface FloorPlanImage {
  url: string;
  label: string;
}

export function parseFloorplanUrls(floorplan: string | null | undefined): FloorPlanImage[] {
  if (!floorplan || !floorplan.trim()) {
    return [];
  }

  const urls = floorplan
    .split(',')
    .map(url => url.trim())
    .filter(url => url.length > 0);

  return urls
    .map((url, index) => ({ url: safeImageSrc(url), label: extractFloorLabel(url, index) }))
    .filter((item): item is FloorPlanImage => item.url != null);
}

/**
 * Extracts a label for a floor plan based on URL keywords or index
 * @param url - The floorplan URL
 * @param index - The index of the image (0-based)
 * @returns A descriptive label like "1st Floor", "2nd Floor", "Suite Type A", etc.
 */
function extractFloorLabel(url: string, index: number): string {
  const urlLower = url.toLowerCase();
  
  // Check for explicit floor indicators in URL
  const floorMatch = urlLower.match(/(\d+)(st|nd|rd|th)?[\s_-]?floor/i);
  if (floorMatch) {
    const floorNum = parseInt(floorMatch[1], 10);
    const suffix = getOrdinalSuffix(floorNum);
    return `${floorNum}${suffix} Floor`;
  }

  // Check for suite type indicators
  const suiteMatch = urlLower.match(/suite[\s_-]?type[\s_-]?([a-z])/i);
  if (suiteMatch) {
    return `Suite Type ${suiteMatch[1].toUpperCase()}`;
  }

  // Check for floor number patterns like "floor1", "f1", "level1"
  const levelMatch = urlLower.match(/(?:floor|f|level|l)[\s_-]?(\d+)/i);
  if (levelMatch) {
    const floorNum = parseInt(levelMatch[1], 10);
    const suffix = getOrdinalSuffix(floorNum);
    return `${floorNum}${suffix} Floor`;
  }

  // Check for building/floor combinations
  const buildingFloorMatch = urlLower.match(/(\d+)[\s_-]?fl/i);
  if (buildingFloorMatch) {
    const floorNum = parseInt(buildingFloorMatch[1], 10);
    const suffix = getOrdinalSuffix(floorNum);
    return `${floorNum}${suffix} Floor`;
  }

  // Default: use simple "Plan 1", "Plan 2" labeling
  return `Plan ${index + 1}`;
}

/**
 * Gets the ordinal suffix for a number (st, nd, rd, th)
 */
function getOrdinalSuffix(num: number): string {
  const j = num % 10;
  const k = num % 100;
  
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}
