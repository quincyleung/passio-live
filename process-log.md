# Process log

## Setup: project instructions (2026-11-02)

- **Asked:** Move anything useful from CLAUDE.md into AGENTS.md, and add Stack, Rules and Workflow sections to the AGENTS.md that create-next-app makes. Stack: Next.js + Tailwind on Vercel, Clerk, Supabase, and a Node.js worker in `/worker` on Railway. Rules: keys only in env files, the worker uses the secret key and the app the publishable key, RLS on every user table, ask before adding packages, poll Passio every 20 seconds at most. Workflow: one step at a time, commit after each, update the tracker and this log.
- **Made:** At first, nothing: the folder was empty, so there was no AGENTS.md or tsconfig.json yet. After the user said yes, I ran `create-next-app` with TypeScript, Tailwind, App Router, ESLint, no `src/` and npm, which gave Next 16.4.4. It refuses non-empty folders, so I moved `process-log.md` out and back. There was no CLAUDE.md, so nothing to move. I kept the Next.js agent-rules block and added these sections to AGENTS.md:
  - The idea, Stack, Rules and Workflow
  - A short Source section with the Passio endpoints and the fields chosen in step 1

  I also added `supabase` to the `exclude` list in `tsconfig.json`; `tsc --noEmit` passes.
- **Decisions:** The two sets of setup notes conflicted. One said a Node worker in `/worker` on Railway; the tracker said an Edge Function with Supabase Cron. The user chose the Edge Function to match the brief, still polling every 20 seconds. AGENTS.md uses that, not the Railway version.
- **Pushed back:** None.
- **Caught:** None.

## Setup: tracker (2026-11-02)

- **Asked:** A self-contained `docs/tracker.html` with no build step and no packages: a countdown to Tue Nov 3, 5:30 PM Central, a progress bar, and one card per step (goal, you vs. agent, Ask Your Agent prompt, status, notes). Step data goes in a JS array at the top of the file.
- **Made:** `docs/tracker.html` with 7 steps. Step data is in `STEPS` at the top of the file, along with `DEADLINE` (5:30 PM CST, UTC−6) and `UPDATED`. The progress bar has one segment per step, colored by status. It supports dark mode, and the You/Agent columns stack on phones. Each step's Ask Your Agent prompt comes from the brief; step 6 uses the brief's free-tier prompt, because the quiz prompt moved to step 7.
- **Pushed back:** None.
- **Caught:** None.

## Step 1: Choose a live source (2026-11-02)

- **Asked:** Call Passio GO for UChicago (system 1068) twice, a few minutes apart, and show what changed.
- **Made:** No code. `POST passiogo.com/mapGetData.php?getBuses=2` with `json={"s0":"1068","sA":1}` returns HTTP 200 with no key. I called it at 6:16 and 6:19 PM and also fetched the route list (`getRoutes=2`). Findings:
  - 15 shuttles were live in both snapshots, and none joined or left.
  - All 15 moved, from 17 m to 1.1 km in 3 minutes.
  - Besides position and heading, the only fields that changed were `created`/`createdTime` (the last GPS report) and `more` (an undocumented code).
  - `created` only has minute precision (`"06:16 PM"`) and no date. One bus was 3 minutes behind the others.
  - Latitude and longitude come back as strings, and `deviceId` is a number while `routeId` is a string.
  - `paxLoad` and `totalCap` were always 0, so there's no rider data.
  - 33 routes in total: 20 UChicago routes (8 marked `outdated`, meaning not running now) and 13 CTA routes that never show up in the bus feed. Midway Metra has two route IDs: 38809 is active and 38731 is outdated.
  - I explained each field (what it is, how often it changes, whether we keep it) and what that means for the design. Freshness has to come from the worker's own fetch time. Almost every shuttle changes on every run, so each page should only listen to the routes that person follows. Shuttles that drop out of the feed need a rule.
- **Ask Your Agent ("Explain this response"):** Asked again before moving on, this time measuring instead of estimating. I made 6 calls 20 seconds apart (6:36 to 6:38 PM), each returning HTTP 200 in about 0.4 s. Across the 75 bus-to-bus comparisons:
  - Latitude and longitude changed in 93%, heading in 87%, `created` in 39% and `more` in 19%. 14 fields never changed.
  - Bus 2207 (Downtown Campus Connector) didn't move at all, and its `created` stayed at 6:33 PM, but Passio's `outdated` flag stayed 0. We need our own per-bus staleness check.
  - East 1665 and South 1662 were parked and drifted only 1–4 m per call, from GPS jitter.
  - Three routes marked active (GE Gleacher Express, Regents Express, MED Medical Shuttle) had no buses.
  - `outdated` is the string `"0"` on UChicago routes but the number `0` on CTA routes. Route `id` repeats across routes, so it isn't a route ID. "Midway Convocation " has a trailing space.
- **Decisions:**
  - Source: Passio GO, UChicago system 1068.
  - Keep the proposed fields, now listed in AGENTS.md. Drop `more`, `paxLoad`, `totalCap` and the internal IDs.
  - Users follow routes, not stops.
- **Pushed back:** None.
- **Caught:** None.
