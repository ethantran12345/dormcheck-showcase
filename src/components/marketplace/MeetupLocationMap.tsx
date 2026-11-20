import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { geocodeAddress } from '@/lib/geocode';
import {
  resolveCampusLandmark,
  campusCenterLatLng,
  neutralMeetupSpots,
} from '@/lib/campusLandmarks';
import { useUniversity } from '@/contexts/UniversityContext';
import { getUniversityById } from '@/config/universities';

interface MeetupLocationMapProps {
  /** Free-text meetup location, e.g. "Cathedral of Learning lawn". */
  location: string;
  /**
   * The LISTING's university. Everything spatial resolves against this school,
   * not the viewer's: the seller wrote this copy about their own campus, so
   * "the Cut" typed by a CMU seller must resolve in CMU's table even when a
   * Pitt student is reading it. Resolving against the viewer would silently pin
   * a cross-school listing on the wrong campus — the same class of mistake as
   * the verified badge naming the viewer's school.
   *
   * Optional so same-school callers that never had a second school need no
   * change; omitted falls back to the viewer's university, which is correct
   * exactly when the two are the same.
   */
  listingUniversityId?: string | null;
}

// Brand malachite for the map pin (no leading # — Mapbox static API wants a bare hex).
const PIN_COLOR = '03C03C';

/**
 * Facebook-Marketplace-style location block: a static map thumbnail (much lighter
 * than instantiating a GL map per modal open) with the meetup copy and an
 * "approximate" caption below. The whole card links out to Google Maps for
 * directions, since students often don't know where a landmark actually is.
 *
 * This mounts on the listing detail modal, which is live for every tenant, so
 * every coordinate here is per-school: the landmark keyword table is keyed by
 * university slug, the geocoder is biased to that school's campus, and the last
 * fallback is that school's own campus center. When there's no Mapbox token or
 * nothing resolves, it degrades to a plain text row.
 */
export function MeetupLocationMap({ location, listingUniversityId }: MeetupLocationMapProps) {
  const { t } = useTranslation();
  const { university: viewerUniversity } = useUniversity();
  // The school the copy is ABOUT. Falls back to the viewer's only when the
  // listing does not name one (guest feed rows, pre-backfill rows).
  const university =
    (listingUniversityId ? getUniversityById(listingUniversityId) : undefined) ?? viewerUniversity;
  const isCrossSchool = university.slug !== viewerUniversity.slug;
  const neutralSpots = useMemo(
    () => neutralMeetupSpots(viewerUniversity.slug, university.slug),
    [viewerUniversity.slug, university.slug],
  );
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  const hasToken = typeof token === 'string' && token.trim() !== '';
  const trimmed = location.trim();

  // MUST be memoised: `resolveCampusLandmark` returns a FRESH object literal on
  // every call, so an unmemoised value is a new identity each render. It is a
  // dependency of the effect below, which calls `setCoords(landmark)` — new
  // identity → state change → render → new identity → "Maximum update depth
  // exceeded" (hundreds of errors/second, a hang on device). Keyed on `trimmed`
  // + the slug, the identity is stable and the effect settles after one pass.
  const landmark = useMemo(
    () => resolveCampusLandmark(trimmed, university.slug),
    [trimmed, university.slug]
  );
  // Same identity rule as `landmark` — this is an effect dependency.
  const campusCenter = useMemo(() => campusCenterLatLng(university), [university]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(landmark);

  useEffect(() => {
    if (landmark) {
      setCoords(landmark);
      return;
    }
    if (!hasToken) {
      setCoords(null);
      return;
    }
    let cancelled = false;
    setCoords(null);
    geocodeAddress(trimmed, university.campusCenter).then((res) => {
      if (!cancelled) setCoords(res ?? campusCenter);
    });
    return () => {
      cancelled = true;
    };
  }, [trimmed, landmark, hasToken, university.campusCenter, campusCenter]);

  const staticUrl =
    hasToken && coords
      ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+${PIN_COLOR}(${coords.lng},${coords.lat})/${coords.lng},${coords.lat},14,0/640x260@2x?access_token=${token}`
      : null;

  // Disambiguate the free-text landmark with the school's own city, not a
  // hardcoded "Pittsburgh PA" — otherwise every future tenant's students get
  // directions to a Pittsburgh street that shares a name with theirs.
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${trimmed} ${university.city}`
  )}`;

  const textRow = (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="truncate whitespace-pre-wrap break-words text-sm font-medium text-foreground">
          {location}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('housing:portal.marketplace.detail.locationApproximate')}
        </p>
      </div>
    </div>
  );

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold text-foreground">
        {t('housing:portal.marketplace.form.meetupLocation')}
      </h3>
      {staticUrl ? (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:bg-muted"
          aria-label={t('housing:portal.marketplace.detail.getDirections', { location })}
        >
          <img
            src={staticUrl}
            alt=""
            className="h-40 w-full object-cover"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {textRow}
        </a>
      ) : (
        <div className="rounded-xl border border-border bg-card">{textRow}</div>
      )}

      {/* Cross-school meetups are the one case the seller's own copy cannot
          solve: they wrote "meet at Towers" meaning their campus, and the buyer
          is a mile away at another one. Naming the school and offering public,
          in-between ground is the safety-relevant half of a shared marketplace —
          the alternative students default to is somebody's dorm.
          Renders only when the two schools differ AND we have vetted spots for
          the pair; neutralMeetupSpots() fails closed to [], so an unknown pair
          shows nothing rather than a guess. */}
      {isCrossSchool && neutralSpots.length > 0 && (
        <div className="mt-2 rounded-card border border-stone-200 bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">
            {t('marketplace:meetup.crossSchool.title', { school: university.shortName })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('marketplace:meetup.crossSchool.body')}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {neutralSpots.map((spot) => {
              const name = t(`marketplace:meetup.neutral.${spot.id}`);
              return (
                <li key={spot.id}>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-pill border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
                    aria-label={t('marketplace:meetup.neutral.openAria', { place: name })}
                  >
                    {name}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
