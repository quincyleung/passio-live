// Supabase Edge Function: fetch UChicago's buses from Passio GO and save only
// what changed. Supabase Cron calls it every 20 seconds (see
// supabase/migrations). Routes are fetched every 5 minutes. Every call that
// passes the checks adds one row to `runs`.
//
// The rules are in lib.ts. This file handles the network and the database.

import {
  type BusRow,
  diffBuses,
  diffRoutes,
  EMPTY_RUNS_TO_CLEAR,
  emptyStreak,
  parseBuses,
  parseRoutes,
  type RouteRow,
  safeEqual,
  shouldFetchRoutes,
  tooSoon,
} from "./lib.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// Supabase provides these. They're never in code. The default secret key
// bypasses row-level security, which only the worker should do.
const SECRET_KEYS: Record<string, string> = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const DB_KEY = SECRET_KEYS["default"] ?? "";

const PASSIO_URL = "https://passiogo.com/mapGetData.php";
const SYSTEM_ID = "1068"; // UChicago

type Run = {
  started_at: string;
  duration_ms: number | null;
  ok: boolean; // true if the buses were fetched and saved
  buses_seen: number | null;
  buses_changed: number | null;
  routes_changed: number | null; // null on runs that don't fetch routes
  error: string | null;
};

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function passio(query: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${PASSIO_URL}?${query}`, {
    method: "POST",
    body: new URLSearchParams({ json: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Passio ${query}: HTTP ${res.status}`);
  return await res.json();
}

// The database is reached through its REST API. The secret key goes on the
// `apikey` header only, because Supabase rejects it as a Bearer token.
async function dbGet<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: DB_KEY } });
  if (!res.ok) throw new Error(`database read ${path.split("?")[0]}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function dbWrite(table: string, rows: unknown[], onConflict?: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
    method: "POST",
    headers: {
      apikey: DB_KEY,
      "Content-Type": "application/json",
      Prefer: onConflict ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`database write ${table}: HTTP ${res.status} ${await res.text()}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "use POST" }, 405);

  // Only callers holding one of the project's secret keys may start a run.
  // The cron job sends it from Vault.
  const key = req.headers.get("apikey") ?? "";
  if (!Object.values(SECRET_KEYS).some((k) => safeEqual(key, k))) {
    return reply({ error: "unauthorized" }, 401);
  }

  const startedMs = Date.now();
  const now = new Date(startedMs).toISOString();

  let sinceLastRun: number | null;
  try {
    const [last] = await dbGet<{ started_at: string }>("runs?select=started_at&order=started_at.desc&limit=1");
    sinceLastRun = last ? startedMs - Date.parse(last.started_at) : null;
  } catch (e) {
    console.error(`could not read runs: ${message(e)}`);
    return reply({ error: message(e) }, 500);
  }
  if (tooSoon(sinceLastRun)) {
    console.log(`skipped: the last run started ${Math.round((sinceLastRun ?? 0) / 1000)} s ago`);
    return reply({ skipped: "too soon after the last run" }, 429);
  }

  const run: Run = {
    started_at: now,
    duration_ms: null,
    ok: false,
    buses_seen: null,
    buses_changed: null,
    routes_changed: null,
    error: null,
  };
  const errors: string[] = [];

  // Routes, every 5 minutes. A failure here is logged, but the buses still run.
  try {
    const [lastFetch] = await dbGet<{ started_at: string }>(
      "runs?select=started_at&routes_changed=not.is.null&order=started_at.desc&limit=1",
    );
    if (shouldFetchRoutes(lastFetch ? startedMs - Date.parse(lastFetch.started_at) : null)) {
      const { routes, skipped } = parseRoutes(await passio("getRoutes=2", { systemSelected0: SYSTEM_ID, amount: 1 }));
      for (const s of skipped) console.warn(`routes: skipped ${s.id ?? "?"}: ${s.reason}`);
      const writes = diffRoutes(routes, await dbGet<RouteRow>("routes?select=*"), now);
      if (writes.length > 0) await dbWrite("routes", writes, "id");
      run.routes_changed = writes.length;
      console.log(`routes: ${routes.length} UChicago routes, ${writes.length} changed`);
    }
  } catch (e) {
    errors.push(`routes: ${message(e)}`);
  }

  // Buses, on every run.
  try {
    const { buses, skipped, count, cta } = parseBuses(await passio("getBuses=2", { s0: SYSTEM_ID, sA: 1 }));
    for (const s of skipped) console.warn(`buses: skipped ${s.id ?? "?"}: ${s.reason}`);

    // An empty list is only trusted once it has lasted EMPTY_RUNS_TO_CLEAR runs.
    let streak = 0;
    if (count === 0) {
      const recent = await dbGet<{ buses_seen: number | null }>(
        `runs?select=buses_seen&ok=is.true&order=started_at.desc&limit=${EMPTY_RUNS_TO_CLEAR - 1}`,
      );
      streak = emptyStreak(count, recent.map((r) => r.buses_seen));
      console.log(
        streak >= EMPTY_RUNS_TO_CLEAR
          ? `buses: list empty ${streak} runs in a row, marking every bus gone`
          : `buses: list empty (${streak} of ${EMPTY_RUNS_TO_CLEAR}), leaving buses as they are`,
      );
    }

    const seen = new Set([...buses.map((b) => b.device_id), ...skipped.flatMap((s) => (s.id ? [s.id] : []))]);
    const stored = await dbGet<BusRow>("buses?select=*");
    const { writes, reasons } = diffBuses(buses, seen, stored, now, count > 0 || streak >= EMPTY_RUNS_TO_CLEAR);
    if (writes.length > 0) await dbWrite("buses", writes, "device_id");

    run.ok = true;
    run.buses_seen = count;
    run.buses_changed = writes.length;
    console.log(
      `buses: ${count} in the list${cta > 0 ? ` (${cta} CTA, left out)` : ""}, ${writes.length} changed ` +
        `(${reasons.moved} moved, ${reasons.gps} new GPS time, ${reasons.details} other details, ` +
        `${reasons.joined} joined, ${reasons.left} left)`,
    );
  } catch (e) {
    errors.push(`buses: ${message(e)}`);
  }

  run.error = errors.length > 0 ? errors.join("; ") : null;
  run.duration_ms = Date.now() - startedMs;
  for (const e of errors) console.error(e);
  try {
    await dbWrite("runs", [run]);
  } catch (e) {
    console.error(`could not save the run: ${message(e)}`);
  }
  console.log(`run ${run.ok ? "ok" : "FAILED"} in ${run.duration_ms} ms`);
  return reply(run, run.ok ? 200 : 502);
});
