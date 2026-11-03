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

## Step 2: Give the agent access (2026-11-02)

- **Asked:** The user created the Supabase project `passio-live` (ref `wyrfwbhjeowaclkxrwya`) and an empty GitHub repo, and thought they had run the Clerk CLI through npx in Assignment 4.
- **Made:**
  - `.mcp.json` with the Supabase MCP server scoped to this project. Same features as date-night (database, functions, debugging, development, docs, account, branching), and not read-only, so the agent can deploy the worker and set its schedule.
  - Confirmed from date-night's log and the npx cache that the Clerk CLI is the `clerk` npm package (v4), run as `npx clerk`, and that Assignment 4 used `clerk init --login` to create a real development app with keys in `.env.local`.
  - Confirmed the GitHub repo exists and is empty.
- **Blocked:** Auto mode denied two of my commands:
  - Downloading the Clerk CLI with `npx --yes`.
  - Adding the GitHub remote with a repo URL I had guessed instead of getting from the user.

  The user will run both. `clerk init` is interactive and opens a browser sign-in anyway.
- **Left for the user:**
  - Push to GitHub.
  - Run `npx clerk init --login`.
  - Restart Claude Code inside `passio-live` so `.mcp.json` and AGENTS.md load, then sign in to the Supabase MCP server.
  - Import the repo into Vercel.
- **Pushed back:** None.
- **Caught:** None.

### Step 2, Ask Your Agent: list the tools and check each one (2026-11-02, 6:58 PM)

- **Asked:** List the MCP servers and CLIs I can use here, what I'd use each for, and check that each one works.
- **Checked:**
  - **Supabase MCP** (`.mcp.json`, project `wyrfwbhjeowaclkxrwya`): loaded but not signed in yet, so only its sign-in tools are visible. I started the OAuth flow and gave the user the link. For: tables, RLS, migrations, SQL, deploying the worker Edge Function, the cron schedule, logs and advisors.
  - **Clerk CLI** (`npx clerk`, 4.1.0, already in the npx cache from the user's `clerk init --login`): `clerk doctor --json` passes login, auth (the user's account), link to app `passio-live` through the git remote, app reachable, and both keys in `.env.local`. It warns only that there's no production instance (not needed yet) and no shell completion. For: instance config, test users, checking sign-in.
  - **git + GitHub over SSH:** `git ls-remote origin` works with no prompt, and remote `main` matches local HEAD `63107fc`, so the user's push went through. `gh` isn't installed. We don't need it, because the repo is public and plain git covers pushing.
  - **Vercel:** no CLI or MCP. GitHub shows a "Vercel: success" status on `63107fc`, so the repo is imported and deploys on push. I can see whether a deploy passed, but I can't read build logs or set env vars.
  - **Passio:** one `curl` returned HTTP 200 in 0.46 s with 15 buses, all in service.
  - **Node toolchain:** Node 22.12, npm 11, Next 16.4.4, TypeScript 5.9.3. `tsc --noEmit` and ESLint pass on the current tree, including the user's uncommitted Clerk files.
  - Not installed, and not needed so far: Supabase CLI and Deno (the MCP server deploys Edge Functions on Supabase's side), and the Vercel CLI. `psql` is installed but has no connection string, and the MCP server covers SQL.
  - Account-wide claude.ai connectors (Claude Docs, Gmail, Google Calendar, Google Drive) are also loaded. They're unrelated to this project, so I didn't use or test them.
- **Found:** The deployed commit predates Clerk. The next push carries the Clerk code, and it needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in Vercel's env vars, plus the sign-in URL variables.
- **Pushed back:** None.
- **Caught:** The Supabase sign-in link I gave returned `{"message":"Unrecognized client_id"}`. A second link had the same `client_id`, so Claude Code was reusing a saved registration that Supabase no longer accepts. Fix: `/mcp` → supabase → Clear authentication → Authenticate, which registers a new client.
- **Supabase, after the user signed in:** `get_project_url` returns `https://wyrfwbhjeowaclkxrwya.supabase.co`, the right project. `execute_sql` works (Postgres 17.11). `list_tables` and `list_edge_functions` come back empty, as expected for a new project. Write tools are loaded (`apply_migration`, `deploy_edge_function`, `create_edge_function_secret`), so it isn't read-only. `list_projects` isn't there, so the server can only see this project.
- **Committed with this step:** the user's `clerk init` output: `ClerkProvider` in `app/layout.tsx`, `proxy.ts` (`clerkMiddleware`), the `/sign-in` and `/sign-up` pages, `@clerk/nextjs`, and the Clerk agent skills (`.agents/skills`, linked from `.claude/skills`, plus `skills-lock.json`). I scanned for keys first and found none. `.env.local` and `.claude/settings.local.json` are gitignored. Not pushed: Vercel needs the Clerk env vars first.
- **Vercel env vars (10:18 PM):** The user added the six Clerk variables in Vercel, for Production and Preview. They caught that they had the types swapped: the publishable key as Secret and `CLERK_SECRET_KEY` as Config.
  - We decided not to get new keys. Config values are encrypted and only readable by project members, and on Hobby that's only the user. A value reaches the browser only if its name starts with `NEXT_PUBLIC_`, so the secret key never left the server. It's also not in git, and it's a test key.
  - Fix: change `CLERK_SECRET_KEY` to Secret. The publishable key can stay Secret, since it reaches the browser anyway through its `NEXT_PUBLIC_` name.
  - The user asked whether the four `NEXT_PUBLIC_CLERK_SIGN_*` URLs belong in Vercel too. Yes, as Config. Without the sign-in and sign-up URLs, the live site would send people to Clerk's hosted sign-in page instead of `/sign-in`. The two fallback redirects are already Clerk's default of `/`, but adding them keeps Vercel matching `.env.local`.
  - Development is left unchecked, because we don't use the Vercel CLI and local dev reads `.env.local`.
  - Then I pushed the step 2 commits. The user confirmed they had switched `CLERK_SECRET_KEY` to Secret before the push.
- **Recheck after the push (10:20 PM):** The user asked the step 2 prompt again, and everything passed.
  - Supabase MCP: right project, Postgres 17.11, 0 tables, 0 functions.
  - Clerk: `doctor` passes everything but the two warnings, no production instance and no shell completion.
  - GitHub: `main` is at `e3460c4`.
  - Vercel: "Deployment has completed" on `e3460c4` at 10:19 PM, the first deploy with Clerk.
  - Passio: HTTP 200, 7 buses at night.
  - `tsc` and ESLint pass.
  - `8723c9e` shows "pending" on GitHub because Vercel only builds the newest commit in a push.
  - Live site, once the user gave the URL (https://passio-live.vercel.app): `/`, `/sign-in` and `/sign-up` all return HTTP 200.
    - Clerk's middleware answers on every page (`x-clerk-auth-status: signed-out`), so the secret key is set.
    - The publishable key in the page matches `.env.local`, and Clerk's sign-in script loads from the test setup (`talented-cowbird-4190.clerk.accounts.dev`).
    - `signInUrl` is `/sign-in`, so the URL variables took effect.
    - The sign-in form itself is drawn in the browser, so `curl` can't see it. The server-side page has no errors.

## Step 3: Plan the data flow (2026-11-02)

- **Asked:** Move on to step 3: a chart of Passio → worker → Supabase → Realtime → page, and the tables, before any code.
- **Made:** `docs/data-flow.md`, written in Markdown so it can go into the README in step 7. It has:
  - A Mermaid chart with 8 numbered arrows, and a table of what each arrow sends.
  - Three options for what counts as a change, using the step 1 measurements.
  - Proposed `routes`, `buses`, `follows` and `runs` tables, with types and where each column comes from in Passio.
  - The reasons behind each choice.

  Before relying on them, I checked two things in the Supabase docs through the MCP server:
  - Realtime can't filter deletes, so a bus that leaves the feed gets `in_feed = false` instead of being deleted. Its `in` filter for "my routes" is supported.
  - With Clerk as third-party auth, the user ID is the token's `sub` claim (`user_…`, not a UUID). So `follows.user_id` is text, and the policies use `auth.jwt()->>'sub'`, not `auth.uid()`.
- **Decisions:**
  - What counts as a change is option B: a bus is written when it moved 10 m or more, or its route, service status or Passio GPS time changed, or it joined or left the feed. The user may tune the threshold later.
  - B means parked buses are written about once a minute instead of on every run, and a frozen GPS (like bus 2207's) stops being written, so the page can flag it.
  - Buses every 20 seconds and routes every 5 minutes, so most runs make one Passio call instead of two.
  - The user approved the four tables as proposed.
- **Pushed back:** None.
- **Caught:** The user said "20 seconds is good to get the latest updates". I misread that as also fetching routes on every run, changed the plan and committed it (`3d167db`). The user corrected me: they meant buses every 20 seconds and routes back to 5 minutes, as first proposed.

### Step 3, Ask Your Agent: walk through the chart (2026-11-02, 10:36 PM)

- **Asked:** Walk me through the chart: what each part sends to the next, and what would break if one part changed it.
- **Answered,** arrow by arrow. The main break cases:
  - **1 · Cron → Worker:** if it stops firing, no new runs happen and buses freeze. The page still shows stale, because no new `runs` rows arrive. Firing faster breaks the polite-polling rule.
  - **2 · Worker → Passio:** a changed address, form format or new key requirement makes the call fail. The worker should log `ok = false` and touch no bus rows. A wrong system ID would quietly save another school's buses.
  - **3 · Passio → Worker:**
    - A renamed field could put buses at (0, 0), so the worker has to check each bus before saving.
    - An empty but successful response looks like "every bus went home" and would mark them all gone.
    - A changed route ID leaves people following the old one with no buses.
  - **4 · Worker → Postgres:** a renamed column makes the save fail, which shows in `runs`. Comparing text with numbers (`"41.79"` vs `41.79`) would make every row look changed. Nothing visibly breaks, but Realtime traffic roughly triples.
  - **5 · Postgres → Realtime:** if `buses` dropped out of Realtime, `runs` events would still arrive, so the page would say it's fresh while the buses don't move. Deleting bus rows would send every delete to every page.
  - **6 · Realtime → Page:**
    - The "my routes" filter is set when the page subscribes, so following a new route needs a new subscription.
    - Changes during a dropped connection aren't resent, so the page reloads after reconnecting.
    - An expired Clerk token (they last about a minute) silently stops updates.
  - **7 · Page → Postgres:** without the Clerk token, requests count as signed out and get nothing. A forged `user_id` is rejected by the policies. The page subscribes before loading so it doesn't miss changes.
  - **8 · Clerk → Page:** Supabase needs the `role: authenticated` claim. Switching Clerk to production gives every user a new ID, so existing follows would belong to nobody.
- **The pattern:** failures at arrows 1–4 stop `runs`, so the page shows stale and is honest about it. Failures at 5–6 keep `runs` arriving, so the page says fresh while the buses don't move.
- **To handle later:**
  - Step 4: check each bus's fields before saving, decide what an empty feed means, compare cleaned numbers, and never delete buses.
  - Step 5: subscribe before loading, subscribe again when follows change, reload after reconnecting, keep the Realtime token fresh, and set up Clerk with Supabase (the role claim plus third-party auth).
  - Later: a Clerk production instance changes every user ID.
- **Pushed back:** None.
- **Caught:** None.

## Step 4: Build the worker (2026-11-02)

- **Asked:** Move on to step 4.
- **Checked first:**
  - The project has the legacy anon key plus the new publishable key. `pg_cron` and `pg_net` were available but off.
  - In the Supabase docs:
    - Edge Functions get the new secret key in `SUPABASE_SECRET_KEYS`.
    - The new secret key works only on the `apikey` header; as a Bearer token it's rejected.
    - The built-in `verify_jwt` check only understands the legacy JWT keys. With the new keys, you turn it off and check the key in your own code.
    - `pg_cron` accepts `'20 seconds'`.
  - Node 22 can run TypeScript tests directly, so the tests need no Deno and no new package.
- **Made:**
  - **Test data:** two real Passio responses saved for the tests: buses at 10:20 PM (7 buses), and routes at 10:45 PM (20 UChicago and 13 CTA).
  - **`supabase/functions/worker/lib.ts`:** the rules. It cleans up Passio's values, applies the change rule, waits for 3 empty bus lists, and handles the 5-minute route timing and a 15-second minimum between runs. It uses no Deno or Node APIs, so Node can test it.
  - **`index.ts`:** the network and database parts. It reaches the database through its REST API with plain `fetch`, so no package. It refuses calls without a project secret key and logs one line per stage.
  - **`lib.test.ts`:** 30 tests against the saved responses, run with `npm run test:worker`. All pass, and TypeScript and ESLint are clean.
  - **Migrations, applied through the MCP server and saved in `supabase/migrations`:**
    - `routes`, `buses` and `runs`, with RLS on and no policies until step 5.
    - Turned on `pg_net` and `pg_cron`. Both migrations got the same timestamp at first, so the second was refused and I applied it again.
  - **Deployed `worker`** with `verify_jwt` off. A call with no key gets 401, a fake `sb_secret_` key gets 401 from Supabase's gateway, and a GET gets 405. The security advisor only reports "RLS enabled, no policy", which is expected until step 5.
  - **Ran it 3 times by hand from SQL,** using `net.http_post` with the key from Vault and only after 20 seconds or more since the last run:
    - Run 1: 5 buses joined and 20 routes saved, in 1.2 s.
    - Run 2: 4 moved, and the fifth, parked, wasn't written. 0.8 s, routes skipped.
    - Run 3: 4 moved and 1 new GPS time, 0.8 s.
- **Decisions:**
  - The user chose to wait for 3 empty bus lists in a row before marking every bus gone. The rule uses `runs.buses_seen`, so it needs no new column.
  - I added label changes (name, route name, color, Passio's `outdated`) as reasons to write, so saved labels never go stale, and told the user.
  - Runs within 15 s of the last one are turned away, which keeps Passio polling polite even if someone else calls the worker.
- **The user did:** saved the project's secret key in Vault as `worker_secret_key`. Neither the code nor I ever see it.
- **Blocked:** auto mode denied the migration that creates the 20-second cron job, because it's a standing change. I asked the user instead (see below).
- **Ask Your Agent ("Show me the worker's logs from its last three runs, and explain each line"):** I showed and explained the function log lines and the request-log lines for runs 1–3:
  - `booted` and `shutdown` come from Supabase starting and stopping copies of the worker.
  - The routes line appears only on runs that fetch routes.
  - The buses line counts each bus under its first reason.
  - Run 3's "1 new GPS time" is parked bus 1657, whose GPS time ticked without it moving 10 m. That's how a parked bus differs from a frozen one.
- **Turned on the schedule (user's OK):**
  - Cost check first:
    - About 130,000 worker calls a month, against 500,000 on the Free plan.
    - Data out is well under 1 GB a month, against 5 GB.
    - The database grows about 100 MB a month from `runs` and the cron history, against 500 MB. I'll suggest a cleanup job in step 6.
    - The Free plan has no overage charges. Going over limits restricts the project instead of billing. I can't see the organization's plan from this MCP server, so the user can check it under Organization → Billing.
  - Applied migration `schedule_worker_every_20_seconds` (saved as `20261103052023_…`). It creates the cron job `passio-worker`, which reads the key from Vault.
  - Checked after a minute: six runs from 11:20:44 to 11:22:24 PM, each 20 s apart. Every cron run succeeded, every call returned 200, and every `runs` row is ok, in 0.4–1.1 s. The first one also fetched routes (0 changed), because the last route fetch was more than 5 minutes earlier.
- **Pushed back:** Before approving the schedule, the user asked me to confirm it wouldn't cost anything.
- **Caught:** The user couldn't find Vault where I said to look (Integrations → Vault). I hadn't confirmed its place in the dashboard, and the docs don't give it, so I gave a direct link and a SQL Editor fallback.
- **Reading the test:** the user asked me to open `lib.test.ts`. I opened it in VS Code and gave a short guide to reading it: the setup at the top, `describe` and `test`, what each `assert` means, Cmd+click to jump to `lib.ts`, and `npm run test:worker`. The user read it and moved on without walking me through it.
- **Done.** Step 4 closed at the user's word.

## Step 5: Make the page live (2026-11-02 to 11-03, complete)

- **Asked:** Move on. I closed step 4 first: the schedule was on and the user had read the test.
- **Checked first:**
  - **Clerk and Supabase docs:**
    - Clerk's "Connect with Supabase" page adds `role: authenticated` to session tokens.
    - Supabase then trusts Clerk once it's added under Third-party auth.
    - The free plan includes 50,000 Clerk users a month.
    - I gave the user both dashboard links from the docs, not from memory, after the Vault mix-up in step 4.
  - **supabase-js source:**
    - With an `accessToken` callback, Realtime asks for a token when it connects and every 25 s after.
    - If the token expires in between, the server closes the channel and doesn't resubscribe.
  - **Next.js docs in `node_modules`:**
    - This project has `cacheComponents` on, so a server-side session read must sit inside `<Suspense>`.
    - `NEXT_PUBLIC_` values are baked in at build time.
    - Leaflet needs `dynamic(..., { ssr: false })` from a client component.
- **Decided by the user (asked together):**
  - Add `@supabase/supabase-js`.
  - Show a map with Leaflet: `leaflet` plus `@types/leaflet`, with OpenStreetMap tiles and no key.
  - Stale after 2 missed runs (60 s).
  - Down after 5 minutes with no good run, or a lost connection.
- **Made:**
  - **Packages:** `@supabase/supabase-js` 2.118.0, `leaflet` 1.9.4 and `@types/leaflet` 1.9.22, each released at least two weeks ago. The audit warnings are all from ESLint's own dependencies and were there before.
  - **Migration `step5_follows_read_access_realtime`:**
    - The `follows` table, with select, insert and delete policies on `auth.jwt()->>'sub'`.
    - Read-only policies on routes, buses and runs for signed-in users.
    - `buses` and `runs` added to Realtime.
  - **Checked the policies in a rolled-back transaction:**
    - User A sees only their own follow.
    - User B sees none of A's follows and can't delete them.
    - A can't add a follow under B's name.
    - Signed-out visitors see 0 rows.
  - **`.env.local`:** added the Supabase URL and publishable key. Both are public by design, and the file is git-ignored.
  - **`app/lib/live.ts`:**
    - The four page states, faded buses after 3 minutes without a new GPS time, and reading Postgres timestamps in any browser.
    - Combining a load with live updates by `changed_at`, so a late update can't overwrite a newer one.
    - 20 tests in `live.test.ts`, run with `npm run test:page`.
  - **`app/lib/supabase-browser.ts`:**
    - One client per user, using the Clerk token.
    - If Clerk's cached token has less than 30 s left, it fetches a new one, so Realtime's 25 s check never sends a token that's about to expire.
  - **`app/live-tracker.tsx`:**
    - Subscribes before loading, reloads after every reconnect, and retries with a growing wait.
    - Resubscribes when follows change, with follow and unfollow buttons.
    - A status line that screen readers announce only when the state changes.
  - **`app/bus-map.tsx`:**
    - Leaflet markers in the route's color, with an arrow for heading.
    - Passio's bus names are escaped and colors checked before they go into the map's HTML.
  - **`app/home.tsx`:** checks sign-in in the browser, since the data is protected by RLS. It shows the tracker when signed in and an intro when signed out.
  - **Checks:** TypeScript, ESLint and a production build pass. A smoke test of the built site served `/` and `/sign-in`.
- **Lint caught:** React's lint flagged the token callback as running during render. Clerk's `getToken` turned out to be stable, so I dropped the ref and moved the expiry check into a plain function.
- **Defaults I picked (the user can change them):**
  - A bus is faded after 3 minutes without a new GPS time.
  - A lost connection shows "Reconnecting…" for 15 s before "Not live".
  - Followable routes that aren't running are shown faded with "(not running)".
- **The user did:** connected Clerk to Supabase in both dashboards, signed in on localhost, and followed Central and Downtown Campus Connector (and followed then unfollowed one more).
- **Checked from my side:**
  - The follows rows have a `user_` ID, which came from the Clerk token, so Supabase accepted it.
  - Every request from the browser succeeded (follows, routes, buses, runs, an insert, a delete), and the websocket opened (101).
  - `realtime.subscription` shows the page listening as `authenticated` with the user's Clerk ID: `runs`, and `buses` filtered to `route_id in (38737, 61142)`.
  - Realtime's log shows it reloading the project's settings at 12:02 AM, right after the user added Clerk, then starting up at the page's first connection.
- **Pushed back:** None yet.
- **Caught:** The user asked, "is there supposed to be a map". There was no map. Its box was `h-full` inside a parent that had only a minimum height, so it ended up 0 px tall. The loading placeholder had the same bug. I fixed it by pinning the map to its parent's edges (`absolute inset-0`) and added a ResizeObserver so Leaflet redraws when its box changes size. The build checks passed because this is a layout bug only a person looking at the page would see.
- **"I don't see anything moving for Central":**
  - I checked the database instead of guessing. Central's only bus, 1659, dropped out of Passio's feed at 12:08:29 AM, a few miles northwest of campus, probably done for the night.
  - The only UChicago shuttle reporting was 1657 on MED Medical Shuttle. It moved 119 m between two runs.
  - The user followed it and confirmed the dot updates without refreshing. That means live updates work end to end.
- **Found while checking:** Passio's bus list had started including CTA buses (24 at 12:10 AM, none earlier in the evening). The worker dropped CTA routes but still saved their buses, and they made up most of each run's writes.
  - I asked; the user said to skip them.
- **Worker version 2:**
  - `parseBuses` leaves out buses on routes starting with "cta" and reports how many in the log.
  - They still count toward the list size, so a list of only CTA buses doesn't trigger the 3-empty-lists rule.
  - Added a test; the worker now has 31.
  - Deployed. The first run marked the 23 saved CTA buses gone, and the next run wrote nothing for them.
  - Then I deleted the 27 old CTA rows. 5 UChicago bus rows remain.
- **The Ask:** "Trace one update for me, from the source to my screen, and name every part it passes through."
  - I traced a real update instead of describing the code: the 9:59:12 AM run, which moved bus 1654 on Downtown Campus Connector (the route the user follows).
  - The path:
    - The bus's GPS, then Passio's servers.
    - pg_cron, then pg_net with the key from Vault, then the Edge Functions gateway, then the worker (Deno).
    - Passio `getBuses`, then `parseBuses`, then a PostgREST read, then `diffBuses`, then a PostgREST upsert.
    - The `buses` table in Postgres, then the WAL, the `supabase_realtime` publication and its replication slot.
    - Realtime: `list_changes`, then `apply_rls` checking the row as the user, plus the route filter.
    - The WebSocket, then supabase-js, then `applyRow`, React, and Leaflet's `setLatLng`.
  - The evidence:
    - The cron run at 9:59:12.121 and pg_net response 1916 (200).
    - The function booted in 26 ms, and the edge logs show each database call.
    - The worker logged "116 in the list (99 CTA, left out), 16 changed (9 moved, 7 new GPS time)".
    - Runs row 1915 took 891 ms.
    - The page's two `realtime.subscription` rows were made at 9:58:59 AM.
  - Not on the path: Vercel and Next.js (they only serve the page's code), Clerk (only the token), and OpenStreetMap (only map tiles).
  - What I couldn't see from the server: the WebSocket delivery and the marker moving. Both happen in the browser.
  - Noticed: in the morning, 99 of Passio's 116 listed buses are CTA, so skipping them matters.
- **The user did:** added `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel.
- **Pushed** `5f15283`. Vercel built it, and the live site's tracker script contains the Supabase URL and publishable key, so the user's Vercel settings worked. (The publishable key is meant to be public. RLS protects the data.)
- **The user asked** for the trace explained "as if to a 5 year old", and whether the map could show stops.
  - I checked Passio once before answering. `getStops=2` (same form field as buses) lists 95 UChicago stops on the 20 routes, with names, positions and order. The route IDs match ours.
  - The same response has each route's shape as a line. Most of its 2.2 MB is CTA shapes; the UChicago part is about 260 KB.
  - Not built: the user hasn't decided yet.
- **The user asked:** replace "Sign in" and "Create an account" on the landing page with one button. Earlier feedback was that both led to the same place.
  - Made: one "Start tracking" button that goes to `/sign-in`, with a small line under it: "New here? You can make an account on the next screen."
  - `/sign-in` now uses Clerk's sign-in-or-up form (`<SignIn withSignUp />`), so an email with no account goes straight on to make one. `/sign-up` still works for old links.
  - Checks: types and lint pass; `/` and `/sign-in` load on the dev server. Clerk's form loads from Clerk's servers, so the user checks how it looks.
- **Pushed back:** the user asked to keep sign-in and sign-up as separate pages, like before. I put back the plain `<SignIn />` form, which links to `/sign-up`. The one "Start tracking" button stays. Its hint now says "New here? The next screen has a link to make an account."
- **The user asked:** change the landing text to "Pick the routes you ride and track the buses on a map" and remove the "New here?" line. Done (with a period, like the heading above it).
- **The user asked:** keep the landing heading on one line and center everything. The column is now wider and centered. The heading stays on one line on screens 640 px and wider. On a phone it's too long for one line at that size, so it wraps evenly (`text-balance`).
- **The user asked:** add stops, shown only for routes the user follows.
  - **Checked first:** Passio's `getStops=2` response.
    - `routes` lists each route's stops in order. Loop routes list their first stop again at the end.
    - `stops` has each stop's name and position, keyed `ID<stopId>`. CTA stops have no `routeId`.
    - The route IDs match ours. `excludedRoutesID` looks like "not running now"; we already get that from routes, so it isn't used.
  - **Defaults I picked (the user can change them):**
    - Fetch stops once an hour, after the buses so they never delay a bus update. A failed try also waits an hour, so a broken fetch can't pull 2 MB every 20 s.
    - Each stop row lists its routes in `route_ids`, instead of a separate table.
    - A route missing from a fetch keeps its stops. Stops are never deleted.
    - Stops are loaded with the page, not over Realtime.
    - On the map: small white circles under the buses, with the stop name and the user's routes on hover. The map zooms to buses and stops the first time either appears.
  - **Made:**
    - Migration `stops_table`: the `stops` table, readable by signed-in users, plus `runs.stops_changed`.
    - Worker version 3: `parseStops`, `diffStops`, `shouldFetchStops`. The position check is now shared with buses.
    - 13 new worker tests on a trimmed real response (`fixtures/stops.json`, 80 KB), for 44 in all.
    - The page: `stopsOnRoutes` (3 tests, 23 in all), stops loaded with `route_ids && my routes`, and drawn by `BusMap`.
    - `docs/data-flow.md`: the stops table and the choices above.
  - **Checked from my side:**
    - The first run with stops (10:19:33 AM) logged "95 stops on 20 UChicago routes, 95 changed", with nothing skipped. The next run didn't fetch stops.
    - 36 stops are on more than one route.
    - As a signed-in user following Downtown Campus Connector, the database returns its 14 stops. A signed-out visitor gets 0.
    - Supabase's security advisor has no warnings.
    - Types, lint and a production build pass.
- **The user checked:** stops work. They liked the hover name, and asked that clicking a stop not do anything or turn it blue.
  - The blue was most likely the browser's focus outline, which Chrome draws around a map shape you click.
  - Stops now have their own class (`bus-stop`): a normal arrow cursor and no focus outline. Hover still shows the name.
  - Stops can't be reached with the keyboard, so removing the outline doesn't take a focus ring away from anyone.
- **Found while closing (my mistake):** since `1133629`, step 5's tracker notes had `"Start tracking"` in plain double quotes inside a double-quoted JavaScript string. That broke the tracker's script, so `docs/tracker.html` probably showed no steps. I rewrote the notes without inner quotes and now run `node --check` on the tracker's script before committing it.
- **The user checked:** the live site works signed in, including stops and the new landing page. Step 5 is complete.

## Step 6: Deploy and test (2026-11-03, complete)

- **The user asked:** move on to step 6.
- **Checked first (my part: the build and the runs table):**
  - The build: the live site works signed in. The user checked this at the end of step 5.
  - Runs since the schedule started (11:20 PM Nov 2): about 2,000, none failed, none with errors. The median took 0.65 s and the 99th percentile 2 s.
  - 11 runs took 7–8 s, close to the 8 s limit on each Passio call. All were bus-only runs, so the time went to Passio's bus call or to the function starting up. None failed. I'm watching this, not changing it.
  - The longest gap since the schedule started was 33 s, at 6:16 AM. A call came 13 s after a slow run and was turned away as too soon, as designed.
  - Cron: 1,997 calls, all succeeded. pg_net holds 1,077 responses (all 200 but one 429, the turned-away call). pg_net deletes its own responses after 6 hours.
  - Database: 15 MB of the free plan's 500 MB. The biggest tables are pg_net's responses (1.9 MB), cron's run history (1.1 MB) and `runs` (0.3 MB).
- **Found:**
  - The live site uses Clerk's development keys (`pk_test_`). That's expected: Clerk doesn't allow production keys on a `*.vercel.app` address. Development instances are capped at 100 users.
  - Cron's run history and `runs` each grow by about 4,300 rows a day, and nothing deletes them. That's about 3 MB a day, so the 500 MB limit is roughly 5 months away. A daily cleanup job would fix it. Not built; it needs the user's OK.
- **The user said yes** to the daily cleanup.
  - Made: cron job `cleanup-run-logs` (migration `daily_cleanup_of_run_logs`). It runs at 10:15 UTC, 4:15 AM in Chicago in winter, and keeps 1 day of cron's history and 7 days of `runs`.
  - First checked that the worker and page only read the newest runs (the oldest they need is within the hour).
  - Ran both deletes inside a transaction and undid it: they work. Nothing is old enough to delete yet, so the first real cleanup is tomorrow morning.
- **The Ask:** "Walk me through the free tier limits for each service my app uses, and how to set usage limits and spending alerts for each one."
  - I read the current pricing and limit pages first: Supabase pricing, cost control and billing FAQ; Vercel Hobby and usage; Clerk pricing and environments; the OSM tile policy.
  - Supabase Free: 500 MB database, 5 GB egress, 500,000 Edge Function calls a month, 2 million Realtime messages a month, 200 Realtime connections at once, 50,000 third-party users.
    - Our use: about 130,000 worker calls a month (26%) and a 15 MB database.
    - Egress is up to about 0.8 GB a month, if the worker's own reads count as egress.
    - Realtime is about 13,000 messages a day per page left open all day.
  - Vercel Hobby: 100 GB data transfer, 1 million CDN requests, 1 million function calls. If a limit is passed, that feature waits 30 days.
  - Clerk: the development instance is capped at 100 users. The Free plan's 50,000 retained users only applies to a production instance, which can't use a vercel.app address.
  - OSM tiles and Passio have no account and no published numbers. OSM has a usage policy we follow. For Passio, we set our own limits.
  - None of the three accounts can charge without a card. Spend caps and spend management exist only on paid plans (Supabase Pro, Vercel Pro). On the free plans, the "limit" is that service stops or restricts, so the user's job is to confirm no card is attached and know where the usage pages and alerts are.
- **The user's friend tested the live site:** they signed up, followed routes and saw buses update. The database agrees: two different people now have follows, both added in the last two hours, and each sees only their own.
- **The user checked** Supabase, Vercel and Clerk: all three are on free plans. Step 6 is complete.
