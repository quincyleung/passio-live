<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## The idea

A live UChicago shuttle tracker using Passio GO (UChicago is system 1068). Signed-in users choose which routes they follow and watch buses move without refreshing.

## Stack

- Next.js App Router + Tailwind, hosted on Vercel Hobby
- Clerk for sign-in
- Supabase for the database and Realtime
- Worker: a Supabase Edge Function (Deno) in `supabase/functions`, run by Supabase Cron. `supabase` is in the `exclude` list in `tsconfig.json` so the Next.js build doesn't check it.

## Source: Passio GO (no key)

- Buses: `POST https://passiogo.com/mapGetData.php?getBuses=2`, form field `json={"s0":"1068","sA":1}`
- Routes: `POST https://passiogo.com/mapGetData.php?getRoutes=2`, form field `json={"systemSelected0":"1068","amount":1}`
- Bus fields we keep: `deviceId` (row key), `busName`, `routeId`, `route`, `color`, `latitude`/`longitude` (strings → numbers), `calculatedCourse` (heading), `created` (last GPS report, minute precision, no date), `outOfService`, `outdated`.
- Route fields we keep: `myid` (the ID buses point to), `name`, `shortName`, `color`, `outdated` (not running now). Hide CTA routes (IDs start with `cta`).
- Passio's timestamps aren't precise enough for freshness; the worker records its own fetch time.
- Users follow routes, not stops.

## Rules

- Keys only in `.env*` files and platform variables (Vercel env vars, Supabase function secrets), never in code or commits.
- The worker writes with the Supabase secret key, which Supabase gives the function on its own servers. The app only uses the publishable key.
- Every user table has `user_id` and row-level security.
- Ask before adding packages.
- Poll Passio politely: every 20 seconds, not faster.

## Workflow

- One step at a time. The user directs every step; don't build ahead.
- Commit after each step with a clear message.
- After each step, update `docs/tracker.html` (the `STEPS` array at the top) and append to `process-log.md`: what the user asked, what you made, where the user pushed back, and what the user caught.
