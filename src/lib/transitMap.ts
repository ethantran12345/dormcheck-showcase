/** Shared transit map types and pin rendering (MapView overlays). */

export const BUS_STOP_COLOR = '#FFB81C';
export const POGOH_TEAL = '#0D9488';
/**
 * Muted default color for bus route lines. Until the user picks a route, every
 * line draws in this single neutral grey-blue so the network reads as quiet
 * context instead of a rainbow; the selected route then pops in its own color.
 */
export const BUS_LINE_MUTED = '#94A3B8';
/**
 * Representative swatch for the multi-colored bus route lines in the map legend.
 * The map draws each route in its own color, so the legend can't mirror a single
 * line; this one neutral blue stands in for "bus routes" as a category.
 */
export const ROUTE_SWATCH = '#1D4ED8';
/** Darker amber for the bus-cluster count text (AA on the BUS_STOP_COLOR fill). */
export const BUS_COUNT_TEXT = '#5C3300';

function darkenPinColor(hex: string, amount = 0.22): string {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const factor = 1 - amount;
  const toByte = (start: number) =>
    Math.max(0, Math.min(255, Math.round(parseInt(raw.slice(start, start + 2), 16) * factor)));
  const r = toByte(0);
  const g = toByte(2);
  const b = toByte(4);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function buildTransitPinSvg(color: string, isActive: boolean): SVGSVGElement {
  const pinW = isActive ? 34 : 26;
  const pinH = isActive ? 44 : 34;
  const pinFill = isActive ? darkenPinColor(color) : color;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(pinW));
  svg.setAttribute('height', String(pinH));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  svg.style.display = 'block';
  svg.style.filter = isActive
    ? 'drop-shadow(0 4px 10px rgba(15, 23, 42, 0.45)) drop-shadow(0 0 0 3px rgba(255, 255, 255, 0.95))'
    : 'drop-shadow(0 1px 3px rgba(15, 23, 42, 0.28))';

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z');
  path.setAttribute('fill', pinFill);
  path.setAttribute('stroke', '#ffffff');
  path.setAttribute('stroke-width', isActive ? '2.5' : '1.25');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export interface PogohStation {
  Id: number | string;
  Name: string;
  'Total Docks': number;
  Latitude: number;
  Longitude: number;
}

export interface BusStop {
  objectID: number;
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stop_route?: string;
  routes?: string;
  route_filter?: string | number;
  route_sort?: number;
  mode?: string;
  direction?: string;
  svc_days?: string;
}

export function busStopTransitKey(stop: BusStop): string {
  return `bus-${stop.objectID}`;
}

export function pogohTransitKey(station: PogohStation): string {
  return `pogoh-${station.Id}`;
}

export function deriveAvailableBusRoutes(busStops: BusStop[]): string[] {
  const routesSet = new Set<string>();
  busStops.forEach((stop) => {
    if (stop.routes) {
      const splitRoutes = String(stop.routes)
        .split(',')
        .map((r) => r.trim().toUpperCase())
        .filter(Boolean);
      splitRoutes.forEach((r) => routesSet.add(r));
    }
  });
  return Array.from(routesSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function filterBusStopsBySelectedRoutes(
  busStops: BusStop[],
  selectedRoutes: string[],
): BusStop[] {
  if (!selectedRoutes.length) return busStops;
  const selectedSet = new Set(selectedRoutes.map((r) => String(r).trim().toUpperCase()));
  return busStops.filter((stop) => {
    if (!stop.routes) return false;
    const stopRoutes = String(stop.routes)
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    return stopRoutes.some((r) => selectedSet.has(r));
  });
}
