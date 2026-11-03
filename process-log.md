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
