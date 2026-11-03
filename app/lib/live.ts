// Rules for the live page: how fresh the data is, and how to combine a fresh
// load with live updates. No React, Next.js or browser-only APIs here, so Node
// can test it: npm run test:page

/** The worker runs every 20 seconds (supabase/migrations/*_schedule_worker_every_20_seconds.sql). */
export const RUN_EVERY_MS = 20_000;
/** Stale after 2 missed runs, which means no good run in 60 s (user's choice, step 5). */
export const STALE_AFTER_MISSED_RUNS = 2;
export const STALE_AFTER_MS = (STALE_AFTER_MISSED_RUNS + 1) * RUN_EVERY_MS;
/** Down after 5 minutes with no good run (user's choice, step 5). */
export const DOWN_AFTER_MS = 5 * 60_000;
/** A lost connection shows as "reconnecting" this long before the page says it's down. */
export const RECONNECT_GRACE_MS = 15_000;
/** A bus whose GPS time hasn't changed in this long is drawn faded. Passio's GPS time only changes once a minute. */
export const BUS_GPS_STALE_MS = 3 * 60_000;
/** Get a new Clerk token when the current one has less than this left. Realtime asks for one every 25 s. */
export const MIN_TOKEN_LIFE_S = 30;

export type Connection = "connecting" | "live" | "lost";

export type Status =
  | { state: "loading" }
  | { state: "fresh"; ageMs: number }
  | { state: "stale"; ageMs: number; reconnecting: boolean }
  | { state: "down"; ageMs: number | null; lostConnection: boolean };

/** Which of the four states the page is in. */
export function pageStatus(input: {
  loaded: boolean;
  connection: Connection;
  lostSince: number | null;
  lastOkRunAt: number | null;
  now: number;
}): Status {
  const { loaded, connection, lostSince, lastOkRunAt, now } = input;
  const ageMs = lastOkRunAt === null ? null : Math.max(0, now - lastOkRunAt);
  const lostTooLong = connection === "lost" && lostSince !== null && now - lostSince >= RECONNECT_GRACE_MS;

  if (lostTooLong) return { state: "down", ageMs, lostConnection: true };
  if (!loaded) return { state: "loading" };
  if (ageMs === null || ageMs >= DOWN_AFTER_MS) return { state: "down", ageMs, lostConnection: false };
  if (connection === "lost") return { state: "stale", ageMs, reconnecting: true };
  if (ageMs > STALE_AFTER_MS) return { state: "stale", ageMs, reconnecting: false };
  return { state: "fresh", ageMs };
}

/** True if a bus's GPS time hasn't changed in BUS_GPS_STALE_MS (a frozen or parked-and-off GPS). */
export function busGpsStale(gpsChangedAt: string, now: number): boolean {
  const t = parseTime(gpsChangedAt);
  return t !== null && now - t >= BUS_GPS_STALE_MS;
}

/**
 * Milliseconds from a Postgres timestamp, as the REST API or Realtime sends it.
 * Handles "2026-11-03 05:22:24.123456+00" as well as ISO, since some browsers
 * can't parse a space, more than 3 decimal places, or a "+00" offset.
 */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Seconds until a JWT expires, or 0 if it can't be read (so the caller gets a new one). */
export function tokenSecondsLeft(token: string, now: number): number {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp: unknown = JSON.parse(atob(payload)).exp;
    return typeof exp === "number" ? exp - now / 1000 : 0;
  } catch {
    return 0;
  }
}

/** "12 s", "1 min 5 s", "7 min", "2 h 3 min". */
export function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 5) return `${m} min ${s % 60} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

type Timed = { device_id: string; changed_at: string };

function newer(a: Timed, b: Timed): boolean {
  return (parseTime(a.changed_at) ?? 0) > (parseTime(b.changed_at) ?? 0);
}

/** Apply one bus row from Realtime, unless the page already has a newer one. */
export function applyRow<T extends Timed>(rows: Map<string, T>, row: T): Map<string, T> {
  const current = rows.get(row.device_id);
  if (current && newer(current, row)) return rows;
  const next = new Map(rows);
  next.set(row.device_id, row);
  return next;
}

/**
 * Replace the page's buses with a fresh load. The page subscribes first and
 * loads second, so a live update can arrive while the load is on its way. Keep
 * those updates (`arrived`) when they're newer than what the load returned.
 */
export function mergeLoad<T extends Timed>(rows: Map<string, T>, loaded: T[], arrived: Set<string>): Map<string, T> {
  const next = new Map(loaded.map((row) => [row.device_id, row] as const));
  for (const id of arrived) {
    const live = rows.get(id);
    if (!live) continue;
    const fromLoad = next.get(id);
    if (!fromLoad || !newer(fromLoad, live)) next.set(id, live);
  }
  return next;
}

/** A stop as the page loads it: the UChicago routes that stop there are in `route_ids`. */
export type StopRow = { id: string; name: string; lat: number; lng: number; route_ids: string[] };

/** A stop to draw, with the names of the user's routes that stop there. */
export type MapStop = { id: string; name: string; lat: number; lng: number; routes: string[] };

/**
 * Only the stops on routes the user follows. A stop shared with a route they
 * don't follow lists only their routes.
 */
export function stopsOnRoutes(stops: StopRow[], follows: Set<string>, routeNames: Map<string, string>): MapStop[] {
  return stops.flatMap((s) => {
    const mine = s.route_ids.filter((id) => follows.has(id));
    if (mine.length === 0) return [];
    const routes = mine.map((id) => routeNames.get(id) ?? id).sort((a, b) => a.localeCompare(b));
    return [{ id: s.id, name: s.name, lat: s.lat, lng: s.lng, routes }];
  });
}
