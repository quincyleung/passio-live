// Tests for the worker's rules, run against real saved Passio responses:
//   fixtures/buses.json   getBuses, 2026-11-02 at 10:20 PM (7 buses)
//   fixtures/routes.json  getRoutes, 2026-11-02 at 10:45 PM (20 UChicago + 13 CTA)
// Run with: npm run test:worker

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Bus, BusRow, RouteRow } from "./lib.ts";
import {
  changeReason,
  diffBuses,
  diffRoutes,
  distanceM,
  emptyStreak,
  MOVE_THRESHOLD_M,
  parseBuses,
  parseRoutes,
  safeEqual,
  shouldFetchRoutes,
  tooSoon,
} from "./lib.ts";

const busesJson: unknown = JSON.parse(readFileSync(new URL("./fixtures/buses.json", import.meta.url), "utf8"));
const routesJson: unknown = JSON.parse(readFileSync(new URL("./fixtures/routes.json", import.meta.url), "utf8"));

const T0 = "2026-11-03T04:19:40.000Z"; // first run
const T1 = "2026-11-03T04:20:00.000Z"; // the run 20 seconds later

/** Rows as the worker would have saved them at time `at`. */
function saved(buses: Bus[], at: string): BusRow[] {
  return buses.map((b) => ({ ...b, gps_changed_at: at, in_feed: true, changed_at: at }));
}

/** The same bus, moved `m` meters north. */
function north(b: Bus, m: number): Bus {
  return { ...b, lat: b.lat + m / 111_195 };
}

/** All device IDs in a list of buses. */
function ids(buses: Bus[]): Set<string> {
  return new Set(buses.map((b) => b.device_id));
}

const { buses: feed } = parseBuses(busesJson);
const first = feed[0];

describe("parseBuses on the saved response", () => {
  test("keeps all 7 buses and skips none", () => {
    const { buses, skipped, count } = parseBuses(busesJson);
    assert.equal(buses.length, 7);
    assert.equal(count, 7);
    assert.deepEqual(skipped, []);
  });

  test("turns Passio's strings and numbers into the right types", () => {
    assert.deepEqual(first, {
      device_id: "412770", // number in Passio, text here
      name: "1657",
      route_id: "38730",
      route_name: "Apostolic/Drexel",
      color: "#ea7948",
      lat: 41.7913906, // "41.791390600" in Passio
      lng: -87.5960601,
      heading: 264.98307896377594,
      out_of_service: false, // 0 in Passio
      passio_outdated: false,
      gps_time: "10:19 PM",
    });
  });

  test("skips a bus with a bad position but still reports its ID", () => {
    const json = {
      buses: {
        "1": [{ deviceId: 1, latitude: "abc", longitude: "-87.6" }],
        "2": [{ deviceId: 2, latitude: "0", longitude: "0" }],
      },
    };
    const { buses, skipped, count } = parseBuses(json);
    assert.equal(buses.length, 0);
    assert.equal(count, 2);
    assert.deepEqual(skipped.map((s) => s.id), ["1", "2"]);
  });

  test("reads an empty list ([]) as zero buses", () => {
    assert.equal(parseBuses({ buses: [] }).count, 0);
  });

  test("throws when the response isn't a bus list at all", () => {
    assert.throws(() => parseBuses({ error: "system not found" }), /no "buses" field/);
    assert.throws(() => parseBuses("<html>"), /no "buses" field/);
  });
});

describe("parseRoutes on the saved response", () => {
  const { routes, skipped } = parseRoutes(routesJson);

  test("keeps the 20 UChicago routes and drops the 13 CTA routes", () => {
    assert.equal(routes.length, 20);
    assert.deepEqual(skipped, []);
    assert.ok(routes.every((r) => !r.id.startsWith("cta")));
  });

  test('trims names ("Midway Convocation " has a trailing space)', () => {
    assert.ok(routes.some((r) => r.name === "Midway Convocation"));
    assert.ok(routes.every((r) => r.name === r.name.trim()));
  });

  test('active is the opposite of Passio\'s "outdated"', () => {
    const apostolic = routes.find((r) => r.id === "38729");
    assert.equal(apostolic?.active, false); // outdated "1"
    assert.equal(routes.filter((r) => r.active).length, 10); // 10 running at 10:45 PM
  });

  test("throws when there's no route list", () => {
    assert.throws(() => parseRoutes({ routes: [] }), /no "all" list/);
  });
});

describe("diffBuses: what counts as a change (option B, 10 m)", () => {
  const stored = saved(feed, T0);

  test("first run: every bus is new, so all 7 are written", () => {
    const { writes, reasons } = diffBuses(feed, ids(feed), [], T0, true);
    assert.equal(writes.length, 7);
    assert.equal(reasons.joined, 7);
    assert.ok(writes.every((w) => w.in_feed && w.gps_changed_at === T0 && w.changed_at === T0));
  });

  test("the same response again writes nothing (numbers compare as numbers)", () => {
    const again = parseBuses(busesJson).buses;
    assert.equal(diffBuses(again, ids(again), stored, T1, true).writes.length, 0);
  });

  test("GPS jitter under 10 m is not a change", () => {
    const jitter = [north(first, 4), ...feed.slice(1)];
    assert.equal(diffBuses(jitter, ids(jitter), stored, T1, true).writes.length, 0);
  });

  test("moving 10 m or more is a change, and keeps the old GPS time", () => {
    const moved = [north(first, 15), ...feed.slice(1)];
    const { writes, reasons } = diffBuses(moved, ids(moved), stored, T1, true);
    assert.equal(writes.length, 1);
    assert.equal(reasons.moved, 1);
    assert.equal(writes[0].changed_at, T1);
    assert.equal(writes[0].gps_changed_at, T0); // gps_time is still "10:19 PM"
  });

  test("a new GPS time is a change even if the bus is parked", () => {
    const ticked = [{ ...first, gps_time: "10:20 PM" }, ...feed.slice(1)];
    const { writes, reasons } = diffBuses(ticked, ids(ticked), stored, T1, true);
    assert.equal(reasons.gps, 1);
    assert.equal(writes[0].gps_changed_at, T1);
  });

  test("a heading change on its own is not a change", () => {
    assert.equal(changeReason({ ...first, heading: 90 }, stored[0]), null);
  });

  test("a new route or service status is a change", () => {
    assert.equal(changeReason({ ...first, route_id: "38736" }, stored[0]), "details");
    assert.equal(changeReason({ ...first, out_of_service: true }, stored[0]), "details");
  });

  test("a bus missing from a non-empty list is marked gone once, not deleted", () => {
    const rest = feed.slice(1);
    const { writes, reasons } = diffBuses(rest, ids(rest), stored, T1, true);
    assert.equal(reasons.left, 1);
    assert.deepEqual(
      writes.map((w) => [w.device_id, w.in_feed]),
      [[first.device_id, false]],
    );
    // Next run: already marked gone, so nothing to write.
    const after = stored.map((r) => (r.device_id === first.device_id ? writes[0] : r));
    assert.equal(diffBuses(rest, ids(rest), after, T1, true).writes.length, 0);
  });

  test("a bus that comes back is written again", () => {
    const gone = stored.map((r) => (r.device_id === first.device_id ? { ...r, in_feed: false } : r));
    assert.equal(changeReason(first, gone[0]), "joined");
  });

  test("a skipped bus (bad data) is not mistaken for a bus that left", () => {
    const rest = feed.slice(1);
    const seen = new Set([...ids(rest), first.device_id]); // listed, but skipped
    assert.equal(diffBuses(rest, seen, stored, T1, true).writes.length, 0);
  });
});

describe("empty bus list: wait 3 runs before marking every bus gone", () => {
  const stored = saved(feed, T0);

  test("counts empty runs in a row, newest first", () => {
    assert.equal(emptyStreak(7, [0, 0]), 0); // not empty
    assert.equal(emptyStreak(0, [7, 7]), 1);
    assert.equal(emptyStreak(0, [0, 7]), 2);
    assert.equal(emptyStreak(0, [0, 0]), 3);
    assert.equal(emptyStreak(0, [null, 0]), 1); // unknown breaks the run
  });

  test("runs 1 and 2 of an empty list leave the buses alone", () => {
    assert.equal(diffBuses([], new Set(), stored, T1, false).writes.length, 0);
  });

  test("run 3 marks every bus gone", () => {
    const { writes, reasons } = diffBuses([], new Set(), stored, T1, true);
    assert.equal(reasons.left, 7);
    assert.ok(writes.every((w) => !w.in_feed));
  });
});

describe("diffRoutes", () => {
  const { routes } = parseRoutes(routesJson);
  const stored: RouteRow[] = routes.map((r) => ({ ...r, changed_at: T0 }));

  test("first fetch writes all 20; the same list again writes none", () => {
    assert.equal(diffRoutes(routes, [], T0).length, 20);
    assert.equal(diffRoutes(routes, stored, T1).length, 0);
  });

  test("a route starting or stopping service is a change", () => {
    const toggled = routes.map((r) => (r.id === "38729" ? { ...r, active: true } : r));
    assert.deepEqual(diffRoutes(toggled, stored, T1).map((r) => r.id), ["38729"]);
  });

  test("a route that drops off the list is marked inactive", () => {
    const active = routes.find((r) => r.active);
    assert.ok(active);
    const writes = diffRoutes(routes.filter((r) => r !== active), stored, T1);
    assert.deepEqual(writes.map((r) => [r.id, r.active]), [[active.id, false]]);
  });

  test("an empty route list marks nothing inactive", () => {
    assert.equal(diffRoutes([], stored, T1).length, 0);
  });
});

describe("timing and key checks", () => {
  test("routes are fetched every 5 minutes", () => {
    assert.equal(shouldFetchRoutes(null), true);
    assert.equal(shouldFetchRoutes(4 * 60_000), false);
    assert.equal(shouldFetchRoutes(5 * 60_000), true);
  });

  test("a run within 15 seconds of the last one is turned away", () => {
    assert.equal(tooSoon(null), false);
    assert.equal(tooSoon(10_000), true);
    assert.equal(tooSoon(20_000), false);
  });

  test("keys must match exactly, and empty never matches", () => {
    assert.equal(safeEqual("sb_secret_abc", "sb_secret_abc"), true);
    assert.equal(safeEqual("sb_secret_abc", "sb_secret_abd"), false);
    assert.equal(safeEqual("sb_secret_ab", "sb_secret_abc"), false);
    assert.equal(safeEqual("", ""), false);
  });

  test("distance is in meters", () => {
    const d = distanceM(first, north(first, MOVE_THRESHOLD_M));
    assert.ok(Math.abs(d - MOVE_THRESHOLD_M) < 0.01, `got ${d}`);
  });
});
