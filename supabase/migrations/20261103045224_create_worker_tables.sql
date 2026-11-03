-- Tables the worker writes (step 4). See docs/data-flow.md.
-- Read access for signed-in users and the follows table come in step 5.

create table public.routes (
  id         text primary key,             -- Passio myid
  name       text not null,
  short_name text,
  color      text,
  active     boolean not null,             -- the opposite of Passio's "outdated"
  changed_at timestamptz not null
);

create table public.buses (
  device_id       text primary key,        -- Passio deviceId
  name            text,
  route_id        text,                    -- no foreign key on purpose
  route_name      text,
  color           text,
  lat             double precision not null,
  lng             double precision not null,
  heading         real,
  out_of_service  boolean not null,
  passio_outdated boolean not null,        -- kept, not trusted
  gps_time        text,                    -- Passio "created", e.g. '06:16 PM'
  gps_changed_at  timestamptz not null,    -- worker's clock
  in_feed         boolean not null,
  changed_at      timestamptz not null     -- worker's clock
);
create index buses_route_id_idx on public.buses (route_id);

create table public.runs (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null,     -- worker's fetch time: page freshness
  duration_ms    integer,
  ok             boolean not null,
  buses_seen     integer,
  buses_changed  integer,
  routes_changed integer,                  -- null on runs that skip routes
  error          text
);
create index runs_started_at_idx on public.runs (started_at desc);

alter table public.routes enable row level security;
alter table public.buses  enable row level security;
alter table public.runs   enable row level security;

-- The worker's secret key acts as service_role, which skips row-level
-- security but still needs table privileges.
grant select, insert, update on public.routes, public.buses to service_role;
grant select, insert on public.runs to service_role;
