-- =============================================================================
-- 0004 — Scans: the reading, and everything derived from it.
--
-- The scanner's Worker is the only thing that writes here. Its record JSON is
-- stored WHOLE in scans.record, because that blob is what the client was
-- actually shown and it must never drift. Alongside it, the parts a salon needs
-- to query — findings, flags, photos, dated milestones — are broken out into
-- real columns.
--
-- That duplication is deliberate. The blob is the receipt; the tables are the
-- file. "Show me every client whose tips have been peeling since March" is a
-- query against the tables. "What exactly did she read on her phone in March"
-- is the blob.
-- =============================================================================

create table public.scans (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,

  -- The Worker's short base32 id. This is what appears in report_url, in the
  -- CRM, and in Maya's call context, so it has to survive as a real key.
  public_id       text not null check (public_id ~ '^[0-9a-z]{4,16}$'),

  -- Nullable: a public try-demo scan exists before anyone knows who took it.
  -- The lead POST attaches it. An unattached scan is still a scan.
  client_id       uuid references public.clients(id) on delete restrict,
  visit_id        uuid references public.visits(id) on delete restrict,

  source          text not null default 'try-demo' check (length(source) <= 40),
  captured_at     timestamptz not null default now(),

  -- Verdict Core output. Deterministic code decided these, not the model.
  tier            text not null check (tier in ('healthy','manageable','medical','unclear')),
  wear            text not null default 'unknown'
                    check (wear in ('bare','polish','gel','acrylic','extensions','unknown')),

  -- Perception metadata, kept queryable so a salon can see its own photo
  -- quality trend and HQ can see whether the gate is tuned right.
  confidence      real check (confidence between 0 and 1),
  photo_quality   real check (photo_quality between 0 and 1),
  nails_visible   smallint check (nails_visible between 0 and 5),
  hand            text check (hand in ('left','right','unknown')),
  undertone       text check (undertone in ('warm','cool','neutral','unknown')),
  nail_bed        text check (nail_bed in ('short_wide','long_narrow','balanced','unknown')),

  -- Plain-text summary for the CRM and for a call. Generated server-side.
  summary         text check (length(summary) <= 2000),

  -- The whole record, exactly as rendered.
  record          jsonb not null,
  record_version  smallint not null default 2,

  -- Dual-reader consensus bookkeeping, for when both readers are live: which
  -- models read it, how far apart they were, whether it degraded to one.
  analysis        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (tenant_id, public_id)
);

comment on table public.scans is
  'One reading. record holds exactly what the client saw; the columns beside it are what staff can query.';

create index scans_client_idx  on public.scans (client_id, captured_at desc);
create index scans_tenant_idx  on public.scans (tenant_id, captured_at desc);
create index scans_tier_idx    on public.scans (tenant_id, tier, captured_at desc);
create index scans_unattached_idx on public.scans (tenant_id, captured_at desc)
  where client_id is null;

create trigger scans_touch before update on public.scans
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------- findings --

-- One row per observed finding. The code vocabulary is closed and lives in the
-- Worker; it is mirrored here as a CHECK so a typo cannot enter the file.
create table public.scan_findings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  scan_id     uuid not null references public.scans(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete restrict,

  code        text not null check (code in (
                'ridging_vertical','grooves_longitudinal','lines_transverse','peeling_free_edge',
                'splitting_lateral','white_spots_surface','surface_rough_patches','thinning_plate',
                'dryness_dull','micro_cracks','breakage_chips','cuticle_dry','cuticle_overgrown',
                'cuticle_picked','shape_uneven_length','polish_grow_out','staining_yellow_mild',
                'healthy_plate','healthy_cuticle','even_structure')),

  fingers     text[] not null default '{}'::text[],
  zone        text not null default 'whole'
                check (zone in ('tip','mid','base','cuticle','folds','whole')),
  severity    text not null default 'mild'
                check (severity in ('mild','moderate','marked')),

  -- Positive findings are findings too. Kept explicit so "what improved" is a
  -- query and not a guess.
  is_positive boolean not null default false,

  observed_at timestamptz not null,
  created_at  timestamptz not null default now(),

  unique (scan_id, code, zone)
);

comment on table public.scan_findings is
  'Normalised findings. This is what makes "has her peeling improved since March" answerable.';

create index scan_findings_client_idx on public.scan_findings (client_id, code, observed_at desc);
create index scan_findings_code_idx   on public.scan_findings (tenant_id, code, observed_at desc);

-- ------------------------------------------------------------------ flags --

-- Serious-only. A flag is what sends a reading to the medical tier, and it is
-- the one thing on a client file that a salon must never quietly lose.
create table public.scan_flags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  scan_id     uuid not null references public.scans(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete restrict,

  code        text not null check (code in (
                'pigment_band_dark','onycholysis_lifting','lifting_with_discoloration',
                'green_discoloration','plate_crumbling','fold_inflammation_pus',
                'blisters_fluid','exposed_bed_or_bleeding','pitting_oil_drop_debris')),

  observed_at timestamptz not null,

  -- Staff acknowledgement. Not a diagnosis and not advice — a record that a
  -- human at the salon saw it and said something.
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledgement text check (length(acknowledgement) <= 1000),

  created_at  timestamptz not null default now(),

  unique (scan_id, code)
);

comment on table public.scan_flags is
  'Serious observations. Never auto-cleared; a human acknowledges, and that is recorded.';

create index scan_flags_client_idx  on public.scan_flags (client_id, observed_at desc);
create index scan_flags_open_idx    on public.scan_flags (tenant_id, observed_at desc)
  where acknowledged_at is null;

-- ----------------------------------------------------------------- photos --

-- Photos live in object storage, not in Postgres. Two backends are supported on
-- purpose: the public scanner already writes to Cloudflare R2 and serves through
-- its Worker, while staff captures go to Supabase Storage. The row is the
-- record either way; `storage` says which one holds the bytes.
create table public.scan_photos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  scan_id      uuid references public.scans(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete restrict,
  visit_id     uuid references public.visits(id) on delete restrict,

  kind         text not null default 'capture'
                 check (kind in ('capture','report','before','after','inspiration')),

  storage      text not null default 'r2' check (storage in ('r2','supabase')),
  path         text not null check (length(path) between 1 and 400),

  -- Only set for r2, where the Worker serves a permanent public URL. Supabase
  -- objects are private and reached through a signed URL minted at read time.
  public_url   text check (length(public_url) <= 600),

  width        integer check (width > 0),
  height       integer check (height > 0),
  bytes        integer check (bytes > 0),
  content_type text check (length(content_type) <= 60),

  taken_at     timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users(id) on delete set null,

  unique (storage, path)
);

comment on table public.scan_photos is
  'Photo history. Bytes live in R2 or Supabase Storage; this row is the file record.';

create index scan_photos_client_idx on public.scan_photos (client_id, taken_at desc)
  where deleted_at is null;
create index scan_photos_scan_idx   on public.scan_photos (scan_id)
  where deleted_at is null;

-- ------------------------------------------------------- care milestones --

-- The care calendar, as rows rather than as text inside a blob. This is what
-- turns a one-off reading into a relationship: a milestone has a due date, and
-- either a visit met it or it went past.
create table public.care_milestones (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  scan_id        uuid not null references public.scans(id) on delete cascade,
  client_id      uuid references public.clients(id) on delete restrict,

  due_on         date not null,
  label          text not null check (length(btrim(label)) between 1 and 120),
  sub            text check (length(sub) <= 200),
  kind           text not null default 'check'
                   check (kind in ('action','check','goal')),
  service_slug   text check (length(service_slug) <= 60),
  is_primary     boolean not null default false,

  status         text not null default 'pending'
                   check (status in ('pending','met','missed','waived')),
  met_by_visit_id uuid references public.visits(id) on delete set null,
  resolved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint care_milestones_resolution_coherent
    check ((status = 'pending') = (resolved_at is null))
);

comment on table public.care_milestones is
  'Dated care calendar rows. The gap between due_on and the visit that met it is the retention story.';

create index care_milestones_client_idx on public.care_milestones (client_id, due_on);
create index care_milestones_due_idx    on public.care_milestones (tenant_id, due_on)
  where status = 'pending';

create trigger care_milestones_touch before update on public.care_milestones
  for each row execute function public.touch_updated_at();
