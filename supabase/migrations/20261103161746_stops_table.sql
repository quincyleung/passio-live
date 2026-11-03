-- Stops, shown on the map for the routes a user follows. See docs/data-flow.md.
-- The worker fetches them from Passio every hour and writes only what changed.

create table public.stops (
  id         text primary key,             -- Passio stopId
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  route_ids  text[] not null default '{}', -- UChicago routes that stop here, sorted
  changed_at timestamptz not null          -- worker's clock
);

alter table public.stops enable row level security;
create policy "Signed-in users read stops" on public.stops for select to authenticated using (true);
grant select on public.stops to authenticated;
grant select, insert, update on public.stops to service_role;

-- When the worker last tried stops. Null on runs that don't.
alter table public.runs add column stops_changed integer;
