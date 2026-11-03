// Rules for the Passio worker: clean up Passio's responses, decide which rows
// changed, and a few timing checks. This file uses no Deno or Node APIs, so the
// Edge Function (Deno) and the tests (Node) can both import it.
// The reasons behind each rule are in docs/data-flow.md.

/** A bus counts as moved once it is this far from its saved position. */
export const MOVE_THRESHOLD_M = 10;
/** Empty bus lists in a row before every bus is marked gone. */
export const EMPTY_RUNS_TO_CLEAR = 3;
/** How often routes are fetched again. */
export const ROUTE_REFRESH_MS = 5 * 60 * 1000;
/** A run that starts sooner than this after the last one is turned away. */
export const MIN_RUN_GAP_MS = 15 * 1000;

/** A bus from Passio after cleaning up its values. */
export type Bus = {
  device_id: string;
  name: string | null;
  route_id: string | null;
  route_name: string | null;
  color: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  out_of_service: boolean;
  passio_outdated: boolean;
  gps_time: string | null;
};

/** A row in the buses table: a bus plus what the worker tracks about it. */
export type BusRow = Bus & {
  gps_changed_at: string;
  in_feed: boolean;
  changed_at: string;
};

/** A UChicago route from Passio after cleaning up its values. */
export type Route = {
  id: string;
  name: string;
  short_name: string | null;
  color: string | null;
  active: boolean;
};

/** A row in the routes table. */
export type RouteRow = Route & { changed_at: string };

/** Something in Passio's response that couldn't be used, and why. */
export type Skipped = { id: string | null; reason: string };

/** Why a bus row is being written. */
export type BusReason = "joined" | "moved" | "gps" | "details" | "left";

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Passio sends yes/no values as 1, "1", 0 or "0". */
function flag(v: unknown): boolean {
  return v === 1 || v === "1" || v === true;
}

/** Text with spaces trimmed, numbers turned into text, and blank as null. */
function text(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** A number from a number or numeric text. Anything else becomes null. */
function num(v: unknown): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CTA routes (IDs starting with "cta") aren't UChicago shuttles, so they're never saved. */
export function isCtaRoute(id: string | null): boolean {
  return id !== null && id.toLowerCase().startsWith("cta");
}

/**
 * Clean up a getBuses response. Buses on CTA routes are left out (`cta` counts
 * them). Buses with no usable ID or position are skipped, not saved. `count` is
 * how many buses Passio listed, including CTA and skipped ones, so the
 * empty-list rule only fires when Passio really sent nothing. Throws if the
 * response isn't shaped like a bus list at all.
 */
export function parseBuses(json: unknown): { buses: Bus[]; skipped: Skipped[]; count: number; cta: number } {
  if (!isObject(json) || !("buses" in json)) {
    throw new Error('Passio bus response has no "buses" field');
  }
  const groups = json.buses;
  // PHP sends an empty list as [] and a full one as {"<deviceId>": [bus]}.
  if (!isObject(groups) && !Array.isArray(groups)) {
    throw new Error('Passio "buses" field is not a list');
  }
  const raws: unknown[] = Object.values(groups).flatMap((g) => (Array.isArray(g) ? g : [g]));

  const buses = new Map<string, Bus>();
  const skipped: Skipped[] = [];
  let cta = 0;
  for (const raw of raws) {
    if (!isObject(raw)) {
      skipped.push({ id: null, reason: "not an object" });
      continue;
    }
    const routeId = text(raw.routeId);
    if (isCtaRoute(routeId)) {
      cta += 1;
      continue;
    }
    const id = text(raw.deviceId);
    if (!id) {
      skipped.push({ id: null, reason: "no deviceId" });
      continue;
    }
    const lat = num(raw.latitude);
    const lng = num(raw.longitude);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      skipped.push({ id, reason: `bad position ${JSON.stringify(raw.latitude)}, ${JSON.stringify(raw.longitude)}` });
      continue;
    }
    buses.set(id, {
      device_id: id,
      name: text(raw.busName),
      route_id: routeId,
      route_name: text(raw.route),
      color: text(raw.color),
      lat,
      lng,
      heading: num(raw.calculatedCourse),
      out_of_service: flag(raw.outOfService),
      passio_outdated: flag(raw.outdated),
      gps_time: text(raw.created),
    });
  }
  return { buses: [...buses.values()], skipped, count: raws.length, cta };
}

/**
 * Clean up a getRoutes response. Only UChicago routes are kept: CTA routes
 * (IDs starting with "cta") are left out. Throws if there's no route list.
 */
export function parseRoutes(json: unknown): { routes: Route[]; skipped: Skipped[] } {
  if (!isObject(json) || !Array.isArray(json.all)) {
    throw new Error('Passio route response has no "all" list');
  }
  const routes = new Map<string, Route>();
  const skipped: Skipped[] = [];
  for (const raw of json.all) {
    if (!isObject(raw)) {
      skipped.push({ id: null, reason: "not an object" });
      continue;
    }
    const id = text(raw.myid);
    if (!id) {
      skipped.push({ id: null, reason: "no myid" });
      continue;
    }
    if (isCtaRoute(id)) continue;
    const name = text(raw.name);
    if (!name) {
      skipped.push({ id, reason: "no name" });
      continue;
    }
    routes.set(id, {
      id,
      name,
      short_name: text(raw.shortName),
      color: text(raw.color),
      active: !flag(raw.outdated),
    });
  }
  return { routes: [...routes.values()], skipped };
}

/** Distance in meters between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * The change rule (option B in docs/data-flow.md): why this bus should be
 * written, or null if it hasn't really changed. A heading change alone is
 * never a reason. GPS jitter of a few meters isn't either.
 */
export function changeReason(bus: Bus, prev: BusRow | undefined): BusReason | null {
  if (!prev || !prev.in_feed) return "joined";
  if (distanceM(bus, prev) >= MOVE_THRESHOLD_M) return "moved";
  if (bus.gps_time !== prev.gps_time) return "gps";
  if (
    bus.route_id !== prev.route_id ||
    bus.out_of_service !== prev.out_of_service ||
    bus.name !== prev.name ||
    bus.route_name !== prev.route_name ||
    bus.color !== prev.color ||
    bus.passio_outdated !== prev.passio_outdated
  ) {
    return "details";
  }
  return null;
}

function busRow(b: Bus, gps_changed_at: string, in_feed: boolean, changed_at: string): BusRow {
  return {
    device_id: b.device_id,
    name: b.name,
    route_id: b.route_id,
    route_name: b.route_name,
    color: b.color,
    lat: b.lat,
    lng: b.lng,
    heading: b.heading,
    out_of_service: b.out_of_service,
    passio_outdated: b.passio_outdated,
    gps_time: b.gps_time,
    gps_changed_at,
    in_feed,
    changed_at,
  };
}

/**
 * Compare this run's buses with the saved rows and return only the rows to
 * write.
 * - `seen` holds every device ID Passio listed, including skipped ones, so a
 *   bus with bad data isn't mistaken for a bus that left.
 * - `markMissing` is false while an empty feed hasn't lasted long enough to
 *   trust. Then saved buses are left alone.
 */
export function diffBuses(
  feed: Bus[],
  seen: Set<string>,
  stored: BusRow[],
  now: string,
  markMissing: boolean,
): { writes: BusRow[]; reasons: Record<BusReason, number> } {
  const reasons: Record<BusReason, number> = { joined: 0, moved: 0, gps: 0, details: 0, left: 0 };
  const old = new Map(stored.map((r) => [r.device_id, r]));
  const writes: BusRow[] = [];

  for (const bus of feed) {
    const prev = old.get(bus.device_id);
    const reason = changeReason(bus, prev);
    if (!reason) continue;
    reasons[reason]++;
    const gpsChangedAt = prev && bus.gps_time === prev.gps_time ? prev.gps_changed_at : now;
    writes.push(busRow(bus, gpsChangedAt, true, now));
  }

  if (markMissing) {
    for (const prev of stored) {
      if (prev.in_feed && !seen.has(prev.device_id)) {
        reasons.left++;
        writes.push(busRow(prev, prev.gps_changed_at, false, now));
      }
    }
  }
  return { writes, reasons };
}

function routeRow(r: Route, changed_at: string): RouteRow {
  return { id: r.id, name: r.name, short_name: r.short_name, color: r.color, active: r.active, changed_at };
}

/**
 * Compare this run's routes with the saved rows and return only the rows to
 * write. A route that drops off Passio's list is marked inactive, unless the
 * whole list came back empty. That's more likely a glitch than every route
 * ending at once.
 */
export function diffRoutes(feed: Route[], stored: RouteRow[], now: string): RouteRow[] {
  const old = new Map(stored.map((r) => [r.id, r]));
  const writes: RouteRow[] = [];
  for (const r of feed) {
    const prev = old.get(r.id);
    if (
      !prev ||
      r.name !== prev.name ||
      r.short_name !== prev.short_name ||
      r.color !== prev.color ||
      r.active !== prev.active
    ) {
      writes.push(routeRow(r, now));
    }
  }
  if (feed.length > 0) {
    const ids = new Set(feed.map((r) => r.id));
    for (const prev of stored) {
      if (prev.active && !ids.has(prev.id)) writes.push(routeRow({ ...prev, active: false }, now));
    }
  }
  return writes;
}

/**
 * How many empty bus lists in a row this run makes, counting this one (0 if
 * this run's list isn't empty). `recent` is buses_seen from the latest
 * successful runs, newest first.
 */
export function emptyStreak(count: number, recent: (number | null)[]): number {
  if (count > 0) return 0;
  let streak = 1;
  for (const seen of recent) {
    if (seen !== 0) break;
    streak++;
  }
  return streak;
}

/** True if it's time to fetch routes. `sinceMs` is null if they never have been. */
export function shouldFetchRoutes(sinceMs: number | null): boolean {
  return sinceMs === null || sinceMs >= ROUTE_REFRESH_MS;
}

/** True if the last run started too recently. Keeps Passio polling polite. */
export function tooSoon(sinceLastRunMs: number | null): boolean {
  return sinceLastRunMs !== null && sinceLastRunMs < MIN_RUN_GAP_MS;
}

/** Compare two keys in a way that doesn't leak through timing. Empty never matches. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
