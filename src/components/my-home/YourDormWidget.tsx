import { useState } from 'react';
import { CommunityCard } from '@/components/my-home/CommunityCard';
import { Link } from 'react-router';
import { ArrowRight, Building, Building2, Check, Copy, Home, MapPin, Navigation, Users } from 'lucide-react';
import type { Dorm } from '@/types';
import { directionsUrl } from '@/lib/maps';
import { dormSlugFromName } from '@/lib/dormSlug';
import { safeImageSrc } from '@/lib/sanitize';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WidgetCard, WidgetBleed } from '@/components/my-home/WidgetCard';
import type { HousingProfileSnapshot } from '@/components/my-home/MyHousingEditorDialog';

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function PrimaryLinkButton({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      asChild
      className="mt-4 w-full bg-malachite-800 text-white hover:bg-malachite-900 md:w-auto"
    >
      <Link to={to}>
        {children}
        <ArrowRight className="ml-1 h-4 w-4" />
      </Link>
    </Button>
  );
}

function HousingSetupButton({
  hasHousing,
  onClick,
}: {
  hasHousing: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 border-border bg-card text-foreground hover:bg-muted hover:text-foreground"
      onClick={onClick}
    >
      {hasHousing ? 'Change' : 'Set up'}
    </Button>
  );
}

function HousingSummaryRow({
  housing,
  onEdit,
}: {
  housing: HousingProfileSnapshot;
  onEdit: () => void;
}) {
  const displayHousingType =
    housing.housing_type === 'off-campus'
      ? 'off-campus'
      : housing.housing_type === 'on-campus'
        ? 'on-campus'
        : null;
  const currentDormDisplay = (housing.current_dorm ?? '').trim();
  const currentFloorDisplay = housing.current_floor?.trim() ?? '';
  const currentRoomDisplay = housing.current_room?.trim() ?? '';
  const neighborhoodDisplay = housing.neighborhood?.trim() ?? '';

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/80 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          {displayHousingType === 'on-campus' ? (
            <Building className="h-4 w-4 text-muted-foreground" />
          ) : displayHousingType === 'off-campus' ? (
            <Home className="h-4 w-4 text-muted-foreground" />
          ) : (
            <MapPin className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {currentDormDisplay || 'No housing set'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {displayHousingType === 'on-campus' && currentFloorDisplay
              ? `Floor ${currentFloorDisplay}${currentRoomDisplay ? ` · Room ${currentRoomDisplay}` : ''}`
              : ''}
            {displayHousingType === 'off-campus' && neighborhoodDisplay ? neighborhoodDisplay : ''}
            {!displayHousingType ? 'Add where you live' : ''}
          </p>
        </div>
      </div>
      <HousingSetupButton hasHousing={!!currentDormDisplay} onClick={onEdit} />
    </div>
  );
}

export interface YourDormWidgetProps {
  dorm: Dorm | null;
  currentDormName: string | null;
  housing: HousingProfileSnapshot;
  loading: boolean;
  /** Open the page-level housing editor dialog. */
  onEditHousing: () => void;
  /** Show the "Roommates" quick link (gated by the roommates feature). */
  showRoommates?: boolean;
  /** master_housing.id of the user's building (from useCurrentUserBuilding); enables the community link. */
  buildingId?: number | null;
  /** Building/floor chats Phase-1 flag; the community link renders only when true. */
  showBuildingChats?: boolean;
}

export function YourDormWidget({
  dorm,
  currentDormName,
  housing,
  loading,
  onEditHousing,
  showRoommates = false,
  buildingId = null,
  showBuildingChats = false,
}: YourDormWidgetProps) {
  const [addrCopied, setAddrCopied] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const openEditor = onEditHousing;

  if (loading) {
    return (
      <WidgetCard title="Your Dorm" icon={<Building2 className="w-4 h-4" />} tint="violet">
        <div className="h-32 w-full rounded-lg bg-muted animate-pulse" />
        <div className="mt-3 space-y-2">
          <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
        </div>
      </WidgetCard>
    );
  }

  if (!dorm) {
    const dormLabel = (currentDormName ?? '').trim();
    const mailtoBody = dormLabel
      ? `Hi DormCheck team,\n\nPlease add the following dorm to DormCheck:\n\n${dormLabel}\n\nThanks!`
      : 'Hi DormCheck team,\n\nPlease add my dorm to DormCheck.\n\nThanks!';
    const mailto = `mailto:support@dormcheck.com?subject=${encodeURIComponent(
      `Add ${dormLabel || 'a dorm'} to DormCheck`,
    )}&body=${encodeURIComponent(mailtoBody)}`;

    return (
        <WidgetCard title="Your Dorm" icon={<Building2 className="w-4 h-4" />} tint="violet">
          <HousingSummaryRow housing={housing} onEdit={openEditor} />
          <div className="flex flex-1 flex-col items-center justify-center py-2 text-center">
            <Building2 className="mb-3 h-10 w-10 text-muted-foreground/40" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-muted-foreground">
              {dormLabel
                ? `We don't have details for "${dormLabel}" in our database yet.`
                : "You haven't picked a dorm yet."}
            </p>
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Knowing your exact dorm helps us match you with the right roommates and listings.
            </p>
            {dormLabel && (
              <div className="mt-3 flex w-full flex-col gap-2">
                <a
                  href={mailto}
                  className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors md:w-auto"
                >
                  Help us add it
                </a>
              </div>
            )}
          </div>
        </WidgetCard>
    );
  }

  const addr = dorm.address?.trim() || dorm.mailingAddress?.trim() || null;
  const handleCopyAddress = async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setAddrCopied(true);
      setTimeout(() => setAddrCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const slug = dormSlugFromName(dorm.name);
  const img = safeImageSrc(dorm.image) ?? '/placeholder.svg';

  const moveInRows: { label: string; value: string }[] = [];
  if (nonEmpty(dorm.moveInParkingLot)) {
    moveInRows.push({ label: 'Parking', value: dorm.moveInParkingLot.trim() });
  }
  if (nonEmpty(dorm.moveInTimeWindow)) {
    moveInRows.push({ label: 'Time', value: dorm.moveInTimeWindow.trim() });
  }
  if (nonEmpty(dorm.moveInEntrance)) {
    moveInRows.push({ label: 'Entrance', value: dorm.moveInEntrance.trim() });
  }
  if (nonEmpty(dorm.moveInCartLocation)) {
    moveInRows.push({ label: 'Cart pickup', value: dorm.moveInCartLocation.trim() });
  }
  const moveInNotes = nonEmpty(dorm.moveInNotes) ? dorm.moveInNotes.trim() : null;
  // Long notes get clamped to 2 lines with a Show more/less toggle so the widget
  // stays scannable instead of ending in a wall of italic text. ~110 chars ≈ what
  // fits in two clamped lines at this width.
  const notesIsLong = !!moveInNotes && moveInNotes.length > 110;
  const hasMoveInBlock = moveInRows.length > 0 || !!moveInNotes;

  const floorRoomParts: string[] = [];
  const floorTrimmed = housing.current_floor?.trim();
  const roomTrimmed = housing.current_room?.trim();
  if (floorTrimmed) floorRoomParts.push(`Floor ${floorTrimmed}`);
  if (roomTrimmed) floorRoomParts.push(`Room ${roomTrimmed}`);
  const floorRoomLine = floorRoomParts.length > 0 ? floorRoomParts.join(' · ') : null;

  // Temporarily hidden for now (do NOT delete) - flip to true to bring it back.
  const showViewDetails: boolean = false;

  // The building community (chats + floormates) lives on its own page now; the
  // card only links to it, and only for the fully-resolved on-campus case.
  const showCommunityLink =
    showBuildingChats && buildingId != null && housing.housing_type === 'on-campus';

  const metaLine = [floorRoomLine, dorm.housingType].filter(Boolean).join(' · ');

  return (
      <WidgetCard title="Your Dorm" icon={<Building2 className="w-4 h-4" />} tint="violet" accent>
        {/* Persistent door to the building + floor rooms - never dismissible. */}
        <CommunityCard className="mb-3" />
        <WidgetBleed>
          {/* Compact banner with the name/room overlaid, so the dorm card stays
              the same uniform height as every other tile instead of a giant hero
              photo. Not interactive (the /campus detail page is feature-gated). */}
          <div className="relative overflow-hidden rounded-2xl bg-muted">
            <img
              src={img}
              alt={dorm.name}
              className="h-28 w-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/placeholder.svg';
              }}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            <button
              type="button"
              onClick={openEditor}
              className="absolute right-2 top-2 rounded-full bg-card/90 px-3 py-1 text-xs font-semibold text-foreground shadow-raised backdrop-blur transition-colors hover:bg-card"
            >
              Change
            </button>
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="truncate text-base font-semibold text-white drop-shadow-sm">{dorm.name}</div>
              {metaLine && <div className="truncate text-xs text-white/85">{metaLine}</div>}
            </div>
          </div>
        </WidgetBleed>

        {/* Pills first: on the fixed-height tile the community link is the key
            action, so it stays above the (secondary) address, which clips first. */}
        {(showRoommates || showCommunityLink) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {showRoommates && (
              <Link
                to="/roommates"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Roommates
              </Link>
            )}
            {showCommunityLink && (
              <Link
                to="/my-home/dorm"
                data-testid="your-dorm-community-link"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                Your building community
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            )}
          </div>
        )}

        {addr && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Address</p>
              <p className="truncate text-sm text-foreground">{addr}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={handleCopyAddress}
                aria-label="Copy address"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {addrCopied ? <Check className="h-4 w-4 text-muted-foreground" /> : <Copy className="h-4 w-4" />}
              </button>
              <a
                href={directionsUrl({ address: addr, lat: dorm.latitude, lng: dorm.longitude })}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Get directions"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Navigation className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}

        {!showCommunityLink && hasMoveInBlock && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Move-in details
            </p>
            {moveInRows.length > 0 && (
              <dl className="space-y-2.5">
                {moveInRows.map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                    <dd className="mt-0.5 text-sm text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {moveInNotes && (
              <div className={cn(moveInRows.length > 0 && 'mt-3')}>
                <p
                  className={cn(
                    'whitespace-pre-wrap text-sm italic text-muted-foreground',
                    notesIsLong && !notesExpanded && 'line-clamp-2',
                  )}
                >
                  {moveInNotes}
                </p>
                {notesIsLong && (
                  <button
                    type="button"
                    onClick={() => setNotesExpanded((v) => !v)}
                    className="mt-1 text-xs font-semibold text-foreground hover:underline"
                  >
                    {notesExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {showViewDetails && (
          <PrimaryLinkButton to={`/campus/${slug}`}>View full details</PrimaryLinkButton>
        )}
      </WidgetCard>
  );
}
