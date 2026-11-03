// Tests for the live page's rules. Run with: npm run test:page

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyRow,
  busGpsStale,
  formatAgo,
  mergeLoad,
  pageStatus,
  parseTime,
  RECONNECT_GRACE_MS,
  tokenSecondsLeft,
} from "./live.ts";

const NOW = Date.parse("2026-11-03T05:30:00.000Z");
const ago = (s: number) => NOW - s * 1000;

describe("pageStatus: loading, fresh, stale, down", () => {
  const live = { loaded: true, connection: "live" as const, lostSince: null, now: NOW };

  test("loading until the first load finishes", () => {
    assert.deepEqual(pageStatus({ ...live, loaded: false, connection: "connecting", lastOkRunAt: null }), { state: "loading" });
  });

  test("fresh when the last good run was within 60 s", () => {
    assert.equal(pageStatus({ ...live, lastOkRunAt: ago(5) }).state, "fresh");
    assert.equal(pageStatus({ ...live, lastOkRunAt: ago(60) }).state, "fresh");
  });

  test("stale after 2 missed runs (more than 60 s)", () => {
    assert.deepEqual(pageStatus({ ...live, lastOkRunAt: ago(61) }), { state: "stale", ageMs: 61_000, reconnecting: false });
  });

  test("down after 5 minutes with no good run", () => {
    assert.equal(pageStatus({ ...live, lastOkRunAt: ago(299) }).state, "stale");
    assert.deepEqual(pageStatus({ ...live, lastOkRunAt: ago(300) }), { state: "down", ageMs: 300_000, lostConnection: false });
  });

  test("down when there has never been a good run", () => {
    assert.equal(pageStatus({ ...live, lastOkRunAt: null }).state, "down");
  });

  test("a lost connection is 'reconnecting' at first, then down", () => {
    const lost = { ...live, connection: "lost" as const, lastOkRunAt: ago(5) };
    assert.deepEqual(pageStatus({ ...lost, lostSince: ago(3) }), { state: "stale", ageMs: 5_000, reconnecting: true });
    assert.deepEqual(pageStatus({ ...lost, lostSince: NOW - RECONNECT_GRACE_MS }), { state: "down", ageMs: 5_000, lostConnection: true });
  });

  test("never connecting at all ends up down, not loading forever", () => {
    const status = pageStatus({ loaded: false, connection: "lost", lostSince: ago(20), lastOkRunAt: null, now: NOW });
    assert.deepEqual(status, { state: "down", ageMs: null, lostConnection: true });
  });

  test("a clock slightly ahead of the server doesn't give a negative age", () => {
    assert.deepEqual(pageStatus({ ...live, lastOkRunAt: NOW + 2_000 }), { state: "fresh", ageMs: 0 });
  });
});

describe("busGpsStale", () => {
  test("faded after 3 minutes without a new GPS time", () => {
    assert.equal(busGpsStale(new Date(ago(170)).toISOString(), NOW), false);
    assert.equal(busGpsStale(new Date(ago(180)).toISOString(), NOW), true);
  });
});

describe("parseTime", () => {
  const expected = Date.parse("2026-11-03T05:22:24.123Z");

  test("reads the REST API's ISO format", () => {
    assert.equal(parseTime("2026-11-03T05:22:24.123456+00:00"), expected);
  });

  test("reads Postgres's own format (space, short offset)", () => {
    assert.equal(parseTime("2026-11-03 05:22:24.123456+00"), expected);
    assert.equal(parseTime("2026-11-02 23:22:24.123-06"), expected);
  });

  test("returns null for nothing or nonsense", () => {
    assert.equal(parseTime(null), null);
    assert.equal(parseTime("not a time"), null);
  });
});

describe("tokenSecondsLeft", () => {
  const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

  test("reads exp from the token", () => {
    assert.equal(tokenSecondsLeft(jwt({ exp: NOW / 1000 + 42 }), NOW), 42);
  });

  test("an unreadable token counts as expired, so a new one is fetched", () => {
    assert.equal(tokenSecondsLeft("garbage", NOW), 0);
    assert.equal(tokenSecondsLeft(jwt({ sub: "user_1" }), NOW), 0);
  });
});

describe("formatAgo", () => {
  test("seconds, then minutes and seconds, then minutes, then hours", () => {
    assert.equal(formatAgo(12_400), "12 s");
    assert.equal(formatAgo(65_000), "1 min 5 s");
    assert.equal(formatAgo(7 * 60_000 + 9_000), "7 min");
    assert.equal(formatAgo(123 * 60_000), "2 h 3 min");
  });
});

describe("combining a load with live updates", () => {
  const row = (id: string, changedAt: string, lat = 41.79) => ({ device_id: id, changed_at: changedAt, lat });
  const T1 = "2026-11-03T05:20:00+00:00";
  const T2 = "2026-11-03T05:20:20+00:00";

  test("a live update replaces an older row", () => {
    const rows = new Map([["a", row("a", T1)]]);
    assert.equal(applyRow(rows, row("a", T2, 41.8)).get("a")?.lat, 41.8);
  });

  test("an update that arrives late doesn't overwrite a newer row", () => {
    const rows = new Map([["a", row("a", T2, 41.8)]]);
    assert.equal(applyRow(rows, row("a", T1)), rows);
  });

  test("a load replaces everything, so buses on unfollowed routes drop off", () => {
    const rows = new Map([["old", row("old", T1)]]);
    assert.deepEqual([...mergeLoad(rows, [row("a", T1)], new Set()).keys()], ["a"]);
  });

  test("an update that arrived during the load is kept if it's newer", () => {
    const rows = new Map([["a", row("a", T2, 41.8)]]);
    const merged = mergeLoad(rows, [row("a", T1)], new Set(["a"]));
    assert.equal(merged.get("a")?.lat, 41.8);
  });

  test("a bus that joined during the load is kept even though the load missed it", () => {
    const rows = new Map([["new", row("new", T2)]]);
    assert.ok(mergeLoad(rows, [row("a", T1)], new Set(["new"])).has("new"));
  });
});
