/**
 * Walk-time estimates anchored to the Cathedral of Learning (campus center),
 * used by the explore sort control and the saved-halls compare view.
 */
const CATHEDRAL = { lat: 40.4443, lng: -79.9532 };
const WALK_METERS_PER_MIN = 80; // ~3 mph casual walking pace

export function walkMinutesToCathedral(
  lat?: number | null,
  lng?: number | null,
): number | null {
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const R = 6371000; // meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(CATHEDRAL.lat - lat);
  const dLng = toRad(CATHEDRAL.lng - lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat)) * Math.cos(toRad(CATHEDRAL.lat)) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(a));
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN));
}

export function formatWalkToCathedral(minutes: number | null): string {
  return minutes == null ? 'N/A' : `${minutes} min walk`;
}
