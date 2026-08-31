-- =============================================================================
-- 0003 — Services and visits: what actually happened in the chair.
--
-- Money is integer cents throughout. A visit is built as lines (one service,
-- one technician, one price), settled once, and tipped after settlement —
-- because that is the order it happens at the desk.
--
-- Mutations carry an idempotency key. An iPad on salon wifi will send the same
-- "settle this visit" twice, and the second one must be a no-op rather than a
-- second charge.
-- =============================================================================

-- --------------------------------------------------------------- services --

create table public.services (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,

  -- Stable across renames and price changes; this is what the scanner's care
  -- calendar recommends by name (biab-nail-strengthening-therapy, gel-removal…).
  slug          text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$'),
  name          text not null check (length(btrim(name)) between 1 and 120),
  category      text check (length(category) <= 40),

  duration_min  smallint check (duration_min between 5 and 600),
  price_cents   integer not null default 0 check (price_cents >= 0),

  -- Shown on the client-facing menu, vs. internal-only (a redo, a courtesy fix).
  is_bookable   boolean not null default true,
  sort_order    smallint not null default 100,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,

  unique (tenant_id, slug)
);

comment on table public.services is
  'The salon''s menu. slug is the stable key the care calendar recommends against.';

create index services_tenant_idx on public.services (tenant_id, sort_order)
  where archived_at is null;

create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------- visits --

create table public.visits (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  client_id       uuid not null references public.clients(id) on delete restrict,

  status          text not null default 'booked'
                    check (status in ('booked','arrived','in_chair','settled','cancelled','no_show')),

  -- Scheduled vs. what actually happened. Both kept: the gap between them is
  -- the salon's own operational data.
  scheduled_for   timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  settled_at      timestamptz,

  -- Denormalised totals, written by the settle path. Cheap to read on a client
  -- file that shows twenty visits at once.
  subtotal_cents  integer not null default 0 check (subtotal_cents >= 0),
  discount_cents  integer not null default 0 check (discount_cents >= 0),
  tip_cents       integer not null default 0 check (tip_cents >= 0),
  total_cents     integer not null default 0 check (total_cents >= 0),
  currency        char(3) not null default 'USD',

  -- A redo is a visit that exists because a previous one did not hold. Linking
  -- them is how a salon sees its own rework rate instead of guessing at it.
  redo_of_id      uuid references public.visits(id) on delete restrict,
  redo_reason     text check (length(redo_reason) <= 400),

  note            text check (length(note) <= 2000),

  -- Same key, same result. The write path upserts on it.
  idempotency_key text,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  cancelled_at    timestamptz,

  constraint visits_settled_has_time
    check ((status = 'settled') = (settled_at is not null)),
  constraint visits_no_self_redo
    check (redo_of_id is distinct from id)
);

comment on table public.visits is
  'One appointment. Totals are integer cents; tip is applied after settlement.';

create unique index visits_idempotency_uniq
  on public.visits (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index visits_client_idx    on public.visits (client_id, coalesce(started_at, scheduled_for) desc);
create index visits_tenant_day_idx on public.visits (tenant_id, scheduled_for)
  where status in ('booked','arrived','in_chair');

create trigger visits_touch before update on public.visits
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ visit lines --

-- One row per service performed, by one technician, at one price. The price is
-- COPIED here rather than joined from services: a receipt must still be true
-- after the menu changes.
create table public.visit_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  visit_id      uuid not null references public.visits(id) on delete restrict,

  service_id    uuid references public.services(id) on delete restrict,
  service_slug  text not null,
  service_name  text not null,

  -- Which technician did this line. Drives the per-line tech chip and, later,
  -- commission.
  tech_id       uuid references public.tenant_members(id) on delete restrict,

  qty           smallint not null default 1 check (qty between 1 and 20),
  unit_cents    integer not null check (unit_cents >= 0),
  line_cents    integer not null check (line_cents >= 0),

  -- Interops with the try-on product's shade library.
  shade_slug    text check (length(shade_slug) <= 60),

  sort_order    smallint not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  voided_at     timestamptz,
  void_reason   text check (length(void_reason) <= 200)
);

comment on table public.visit_lines is
  'A service line on a visit. Price is copied, not joined — an old receipt stays true.';

create index visit_lines_visit_idx on public.visit_lines (visit_id, sort_order)
  where voided_at is null;
create index visit_lines_tech_idx  on public.visit_lines (tech_id, created_at desc)
  where voided_at is null;

create trigger visit_lines_touch before update on public.visit_lines
  for each row execute function public.touch_updated_at();
