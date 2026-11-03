"use client";

// The live part of the page (step 5). For the data flow, see docs/data-flow.md:
//   1. Load the user's follows (row-level security returns only theirs).
//   2. Subscribe to Realtime: bus changes on those routes, and each new run.
//   3. Once subscribed, load routes, buses and the latest good run. Subscribing
//      first means no update falls in the gap between loading and listening.
//   4. If the connection drops, retry with a growing wait, and load again once
//      it's back. Following or unfollowing a route starts again at step 2.

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapBus, MapMode } from "./bus-map";
import {
  applyRow,
  busGpsStale,
  formatAgo,
  mergeLoad,
  pageStatus,
  parseTime,
  type Connection,
  type Status,
} from "./lib/live";
import { supabaseConfigured, useSupabase } from "./lib/supabase-browser";

const BusMap = dynamic(() => import("./bus-map"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-zinc-100 dark:bg-zinc-900" />,
});

type Route = { id: string; name: string; short_name: string | null; color: string | null; active: boolean };

type Bus = {
  device_id: string;
  name: string | null;
  route_id: string | null;
  route_name: string | null;
  color: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  out_of_service: boolean;
  gps_changed_at: string;
  in_feed: boolean;
  changed_at: string;
};

type Run = { started_at: string; ok: boolean };

const BUS_COLUMNS =
  "device_id,name,route_id,route_name,color,lat,lng,heading,out_of_service,gps_changed_at,in_feed,changed_at";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compass(heading: number | null): string {
  if (heading === null || !Number.isFinite(heading)) return "";
  return COMPASS[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
}

export default function LiveTracker() {
  const supabase = useSupabase();

  const [routes, setRoutes] = useState<Route[]>([]);
  const [follows, setFollows] = useState<string[] | null>(null); // null until loaded
  const [buses, setBuses] = useState<Map<string, Bus>>(() => new Map());
  const [lastOkRunAt, setLastOkRunAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lostSince, setLostSince] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0); // bumping this resubscribes
  const [now, setNow] = useState(0); // 0 until the first tick in the browser
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [followProblem, setFollowProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const failures = useRef(0);
  const arrived = useRef<Set<string> | null>(null); // buses updated while a load is on its way

  // A clock for "updated 12 s ago" and the fresh/stale/down checks.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  // 1. The user's follows.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("follows")
      .select("route_id")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoadProblem(`Couldn't load the routes you follow: ${error.message}`);
          setFollows([]);
          return;
        }
        setFollows((data as { route_id: string }[]).map((f) => f.route_id).sort());
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const followKey = follows === null ? null : follows.join(",");

  // 2–4. Subscribe, then load; retry and reload after a drop.
  useEffect(() => {
    if (!supabase || followKey === null) return;
    const db = supabase;
    const ids = followKey === "" ? [] : followKey.split(",");
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      const pending = new Set<string>();
      arrived.current = pending;
      const [routesRes, busesRes, runRes] = await Promise.all([
        db.from("routes").select("id,name,short_name,color,active").order("name"),
        ids.length > 0 ? db.from("buses").select(BUS_COLUMNS).in("route_id", ids).eq("in_feed", true) : null,
        db.from("runs").select("started_at").eq("ok", true).order("started_at", { ascending: false }).limit(1),
      ]);
      if (arrived.current === pending) arrived.current = null;
      if (disposed) return;
      const error = routesRes.error ?? busesRes?.error ?? runRes.error;
      if (error) {
        setLoadProblem(`Couldn't load the latest data: ${error.message}`);
        return;
      }
      setLoadProblem(null);
      setRoutes(routesRes.data as Route[]);
      setBuses((current) => mergeLoad(current, (busesRes?.data ?? []) as Bus[], pending));
      const last = parseTime((runRes.data as Run[])[0]?.started_at);
      if (last !== null) setLastOkRunAt((prev) => Math.max(prev ?? 0, last));
      setLoaded(true);
    }

    const channel = db.channel(`live-${Math.random().toString(36).slice(2)}`);
    if (ids.length > 0) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "buses", filter: `route_id=in.(${ids.join(",")})` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const row = payload.new as Bus;
          arrived.current?.add(row.device_id);
          setBuses((current) => applyRow(current, row));
        },
      );
    }
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "runs" }, (payload) => {
      const run = payload.new as Run;
      const t = parseTime(run.started_at);
      if (run.ok && t !== null) setLastOkRunAt((prev) => Math.max(prev ?? 0, t));
    });
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        failures.current = 0;
        setConnection("live");
        setLostSince(null);
        void load();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setConnection("lost");
        setLostSince((prev) => prev ?? Date.now());
        clearTimeout(retry);
        const wait = Math.min(30_000, 2_000 * 2 ** Math.min(failures.current, 4));
        failures.current += 1;
        retry = setTimeout(() => setAttempt((a) => a + 1), wait);
      }
    });

    return () => {
      disposed = true;
      clearTimeout(retry);
      void db.removeChannel(channel);
    };
  }, [supabase, followKey, attempt]);

  async function toggleFollow(routeId: string) {
    if (!supabase || follows === null || saving) return;
    const before = follows;
    const following = before.includes(routeId);
    setSaving(routeId);
    setFollowProblem(null);
    setFollows(following ? before.filter((id) => id !== routeId) : [...before, routeId].sort());
    const { error } = following
      ? await supabase.from("follows").delete().eq("route_id", routeId)
      : await supabase.from("follows").insert({ route_id: routeId });
    if (error) {
      setFollows(before);
      setFollowProblem(`Couldn't ${following ? "unfollow" : "follow"} that route: ${error.message}`);
    }
    setSaving(null);
  }

  const status: Status = now === 0 ? { state: "loading" } : pageStatus({ loaded, connection, lostSince, lastOkRunAt, now });
  const mode: MapMode = status.state === "down" ? "down" : status.state === "stale" ? "stale" : "normal";

  const followSet = useMemo(() => new Set(follows ?? []), [follows]);
  const routeNames = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);
  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [routes],
  );

  const mapBuses: MapBus[] = useMemo(
    () =>
      [...buses.values()]
        .filter((b) => b.in_feed && b.route_id !== null && followSet.has(b.route_id))
        .map((b) => ({
          id: b.device_id,
          name: b.name ?? b.device_id,
          routeName: (b.route_id && routeNames.get(b.route_id)) || b.route_name || "Unknown route",
          lat: b.lat,
          lng: b.lng,
          heading: b.heading,
          color: b.color,
          gpsStale: now > 0 && busGpsStale(b.gps_changed_at, now),
          outOfService: b.out_of_service,
        }))
        .sort((a, b) => a.routeName.localeCompare(b.routeName) || a.name.localeCompare(b.name)),
    [buses, followSet, routeNames, now],
  );

  if (!supabaseConfigured) {
    return (
      <p className="m-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        This site was built without its Supabase settings (NEXT_PUBLIC_SUPABASE_URL and
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
      </p>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <section aria-label="Routes" className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Routes {follows !== null && `· following ${follows.length}`}
        </h2>
        {routes.length === 0 ? (
          <p className="text-sm text-zinc-500">Loading routes…</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sortedRoutes.map((route) => {
              const on = followSet.has(route.id);
              return (
                <li key={route.id}>
                  <button
                    type="button"
                    onClick={() => void toggleFollow(route.id)}
                    disabled={saving !== null}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition disabled:cursor-wait ${
                      on
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700"
                    } ${route.active ? "" : "opacity-60"}`}
                    title={route.active ? undefined : "Not running right now"}
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: /^#[0-9a-f]{3,8}$/i.test(route.color ?? "") ? route.color! : "#a1a1aa" }}
                    />
                    {route.name}
                    {!route.active && <span className="text-xs">(not running)</span>}
                    {on && <span aria-hidden>✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {followProblem && <p className="mt-2 text-sm text-red-700">{followProblem}</p>}
      </section>

      <StatusBar status={status} onRetry={() => setAttempt((a) => a + 1)} />
      {loadProblem && <p className="bg-red-50 px-4 py-2 text-sm text-red-800">{loadProblem}</p>}

      <div className="relative min-h-[60vh] flex-1">
        <BusMap buses={mapBuses} mode={mode} />
        {loaded && mapBuses.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
            <p className="rounded-md bg-white/90 px-4 py-2 text-sm text-zinc-700 shadow">
              {follows?.length ? "No buses on your routes right now." : "Follow a route above to see its buses."}
            </p>
          </div>
        )}
      </div>

      {mapBuses.length > 0 && (
        <section aria-label="Buses" className="border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
          <ul className="grid gap-1 sm:grid-cols-2">
            {mapBuses.map((bus) => (
              <li key={bus.id} className={bus.gpsStale || bus.outOfService ? "text-zinc-400" : ""}>
                <span className="font-medium">{bus.name}</span> · {bus.routeName}
                {compass(bus.heading) && ` · heading ${compass(bus.heading)}`}
                {bus.outOfService && " · out of service"}
                {bus.gpsStale && " · GPS not updating"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatusBar({ status, onRetry }: { status: Status; onRetry: () => void }) {
  let dot = "bg-zinc-400";
  let text = "Connecting…";
  let detail: string | null = null;
  let retry = false;

  if (status.state === "fresh") {
    dot = "bg-green-600 animate-pulse";
    text = `Live · updated ${formatAgo(status.ageMs)} ago`;
  } else if (status.state === "stale") {
    dot = "bg-amber-500";
    text = status.reconnecting
      ? `Reconnecting… · last update ${formatAgo(status.ageMs)} ago`
      : `Behind · last update ${formatAgo(status.ageMs)} ago`;
    detail = status.reconnecting ? null : "The tracker has missed a couple of updates. Buses may be out of date.";
  } else if (status.state === "down") {
    dot = "bg-red-600";
    if (status.lostConnection) {
      text = "Not live · lost the connection";
      detail = "Still trying to reconnect. Buses shown may be out of date.";
      retry = true;
    } else {
      text = status.ageMs === null ? "Not live · no updates yet" : `Not live · no update in ${formatAgo(status.ageMs)}`;
      detail = "The tracker isn't getting data from Passio. Buses shown may be out of date.";
    }
  }

  // Screen readers hear only the state when it changes, not the ticking seconds.
  const announced = { loading: "Connecting", fresh: "Live", stale: "Behind", down: "Not live" }[status.state];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
      <span role="status" className="sr-only">
        {announced}
      </span>
      <span className="flex items-center gap-2 font-medium">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        {text}
      </span>
      {detail && <span className="text-zinc-500">{detail}</span>}
      {retry && (
        <button type="button" onClick={onRetry} className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:border-zinc-500">
          Retry now
        </button>
      )}
    </div>
  );
}
