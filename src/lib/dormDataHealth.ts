/**
 * Per-dorm data completeness. "Key fields" are the ones whose absence visibly
 * degrades the student housing detail page: photo, rate, address, map pin,
 * description. Shared by the Manage Dorms list badges and the Dashboard card.
 */

export type DormHealthRow = {
  id: number;
  residence_hall: string | null;
  image_url: string | null;
  rate_per_term: string | null;
  address: string | null;
  // master_housing types latitude/longitude as numeric; keep both so callers passing
  // the real row type (DormsListPage) match without a cast. The presence checks below
  // are type-agnostic.
  latitude: string | number | null;
  longitude: string | number | null;
  details: string | null;
};

export const DORM_HEALTH_COLUMNS =
  'id, residence_hall, image_url, rate_per_term, address, latitude, longitude, details';

// Values arrive as text columns but some (lat/lng) are numeric at runtime.
const present = (v: string | number | null | undefined): boolean =>
  v != null && String(v).trim().length > 0;

/** Human-readable labels of the key fields missing from this row. */
export function missingKeyFields(row: DormHealthRow): string[] {
  const missing: string[] = [];
  if (!present(row.image_url)) missing.push('photo');
  if (!present(row.rate_per_term)) missing.push('rate');
  if (!present(row.address)) missing.push('address');
  if (!present(row.latitude) || !present(row.longitude)) missing.push('map location');
  if (!present(row.details)) missing.push('description');
  return missing;
}
