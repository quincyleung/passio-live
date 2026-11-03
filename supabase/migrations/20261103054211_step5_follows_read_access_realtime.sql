-- Step 5: what signed-in users can see and change. See docs/data-flow.md.
-- Signed-in users are Clerk users. Their token's "sub" claim is the Clerk
-- user ID (text, like user_...), and its "role" claim is "authenticated".

-- follows: one row per user per route they follow.
create table public.follows (
  user_id    text not null default (auth.jwt()->>'sub'),
  route_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);
alter table public.follows enable row level security;

create policy "Users see their own follows" on public.follows
  for select to authenticated using ((select auth.jwt()->>'sub') = user_id);
create policy "Users add their own follows" on public.follows
  for insert to authenticated with check ((select auth.jwt()->>'sub') = user_id);
create policy "Users remove their own follows" on public.follows
  for delete to authenticated using ((select auth.jwt()->>'sub') = user_id);
grant select, insert, delete on public.follows to authenticated;

-- routes, buses, runs: any signed-in user can read them. Only the worker writes.
-- Signed-out visitors (anon) have no policy, so they see no rows.
create policy "Signed-in users read routes" on public.routes
  for select to authenticated using (true);
create policy "Signed-in users read buses" on public.buses
  for select to authenticated using (true);
create policy "Signed-in users read runs" on public.runs
  for select to authenticated using (true);
grant select on public.routes, public.buses, public.runs to authenticated;

-- Realtime: send bus updates and new runs to open pages. Before sending a row,
-- Realtime checks the policies above with that viewer's token.
alter publication supabase_realtime add table public.buses, public.runs;
