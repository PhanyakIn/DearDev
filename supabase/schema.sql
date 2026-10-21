-- DearDev shop database schema (Supabase / Postgres)
-- Run this in Supabase Dashboard → SQL Editor → New query → Paste → Run

-- 1. Products table (public catalog data only, no secrets here)
create table if not exists products (
  id text primary key,
  name text not null,
  price integer not null default 0,
  currency text not null default 'THB',
  image_url text,
  badge text,
  short_detail text,
  description text,
  video_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. What's included per product (replaces `contains: [...]` array)
create table if not exists product_contains (
  product_id text not null references products(id) on delete cascade,
  item text not null,
  position integer not null default 0,
  primary key (product_id, item)
);

-- 3. Contact channels (single row, id = 1)
create table if not exists site_contact (
  id integer primary key check (id = 1),
  discord text,
  facebook text,
  updated_at timestamptz not null default now()
);

-- 4. Public read-only access (no login needed to view shop)
alter table products enable row level security;
alter table product_contains enable row level security;
alter table site_contact enable row level security;

drop policy if exists "public read products" on products;
create policy "public read products"
  on products for select using (is_active = true);

drop policy if exists "public read contains" on product_contains;
create policy "public read contains"
  on product_contains for select using (true);

drop policy if exists "public read contact" on site_contact;
create policy "public read contact"
  on site_contact for select using (true);

-- 5. Seed with your current shop data (edit URLs after uploading images to Storage)
--    NOTE: on conflict → do nothing. The seed rows are placeholders; a re-run
--    must never overwrite the live product data (price, image, description).
insert into products (id, name, price, currency, image_url, badge, short_detail, description, video_url)
values (
  'prod1',
  'Movement System R6 V1',
  59,
  'THB',
  'REPLACE_WITH_STORAGE_PUBLIC_URL',
  'Sell',
  'Advanced Movement System Version 1 for R6 models (Only PC)',
  'A high-quality movement system, perfect for parkour, RPG, and racing games. It is easily customizable via ModuleScript and includes free SFX, VFX, animations, and more.',
  'https://youtu.be/flvTWThTPRc?si=Fme119kc9-nkG_PK'
)
on conflict (id) do nothing;

insert into product_contains (product_id, item, position)
values
  ('prod1', 'Auto Sprint', 1),
  ('prod1', 'Cam Sway', 2),
  ('prod1', 'Wall Running', 3),
  ('prod1', 'Laché', 4),
  ('prod1', 'Ledge Hanging', 5),
  ('prod1', 'Wall Climbable', 6),
  ('prod1', 'Obstacle Vaulting', 7),
  ('prod1', 'Roll Landing', 8),
  ('prod1', 'Easy to customize', 9),
  ('prod1', 'Free Animations', 10),
  ('prod1', 'Free SFX', 11),
  ('prod1', 'Free VFX', 12)
on conflict do nothing;

insert into site_contact (id, discord, facebook)
values (1, 'REPLACE_WITH_DISCORD_URL', 'REPLACE_WITH_FACEBOOK_URL')
on conflict (id) do nothing;

-- 6. Digital file location per product (path inside the PRIVATE storage bucket)
--    Never store a public URL here — downloads go through signed URLs only.
alter table products add column if not exists file_path text;

-- 7. Orders (PRIVATE — no anon access; only the server via service_role)
--    status: pending | paid | rejected | refunded
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  product_id       text references products(id),
  email            text,
  amount           integer not null default 0,      -- satang (THB * 100)
  currency         text not null default 'THB',
  status           text not null default 'pending',
  license_key      text unique,
  slip_ref         text,                             -- bank reference on the slip (dedupe)
  slip_payload     jsonb,                            -- raw SlipOK response (audit trail)
  qr_expires_at    timestamptz,
  download_count   integer not null default 0,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);

-- One order per slip reference → blocks re-using the same slip twice.
create unique index if not exists orders_slip_ref_idx
  on orders (slip_ref) where slip_ref is not null;

create index if not exists orders_email_idx on orders (email);

-- RLS: deny all for anon. The service_role key (server only) bypasses RLS.
alter table orders enable row level security;
-- (no policy is created on purpose → anon cannot read/write orders)

-- 8. Atomic guarded increment so downloads cannot exceed the limit.
--    Returns the updated row, or NULL when unpaid or already at the cap.
create or replace function consume_download(p_order_id uuid, p_max int default 3)
returns orders
language plpgsql
as $$
declare
  r orders;
begin
  update orders
     set download_count = download_count + 1
   where id = p_order_id
     and status = 'paid'
     and download_count < p_max
  returning * into r;
  return r;
end;
$$;

-- 9. Per-IP rate limiting for the payment endpoints.
--    The counter lives in Postgres so every serverless instance shares it —
--    an in-memory counter would reset on every cold start.
--    (On an existing project run supabase/hardening.sql instead of this file,
--     so the live product rows are not touched by the seed above.)
create table if not exists rate_limits (
  key               text primary key,
  hit_count         integer not null default 0,
  window_started_at timestamptz not null default now()
);

alter table rate_limits enable row level security;
-- (no policy on purpose → anon/authenticated cannot read or write it)

grant all on table rate_limits to service_role;

-- Count one hit for p_key and report whether the caller is still inside the
-- limit. Atomic, so parallel requests cannot slip past the cap.
--
-- The counter column is called hit_count (not hits) on purpose: an output
-- column called `hits` would shadow it inside the function body.
create or replace function check_rate_limit(
  p_key             text,
  p_limit           integer,
  p_window_seconds  integer
)
returns table(allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql
as $$
declare
  v_hits    integer;
  v_started timestamptz;
begin
  insert into rate_limits as rl (key, hit_count, window_started_at)
  values (p_key, 1, now())
  on conflict (key) do update
     set hit_count = case
           when rl.window_started_at < now() - make_interval(secs => p_window_seconds) then 1
           else rl.hit_count + 1
         end,
         window_started_at = case
           when rl.window_started_at < now() - make_interval(secs => p_window_seconds) then now()
           else rl.window_started_at
         end
  returning rl.hit_count, rl.window_started_at into v_hits, v_started;

  return query
    select
      v_hits <= p_limit,
      v_hits,
      greatest(
        0,
        ceil(extract(epoch from (v_started + make_interval(secs => p_window_seconds) - now())))::integer
      );
end;
$$;

-- Housekeeping: drop counters that are long past their window.
create or replace function purge_rate_limits()
returns integer
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Only the server may call these (PostgREST uses the service_role key).
revoke all on function check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function purge_rate_limits() from public, anon, authenticated;
grant execute on function check_rate_limit(text, integer, integer) to service_role;
grant execute on function purge_rate_limits() to service_role;

-- 10. Keep the private storage object name server-only.
--     The anon key ships inside the browser bundle and RLS policies are
--     row-level, not column-level — without an explicit column grant anyone
--     could read products.file_path straight from PostgREST. The bucket itself
--     is private, so this is defence in depth.
revoke select on products from anon, authenticated;
grant select (
  id, name, price, currency, image_url, badge,
  short_detail, description, video_url, is_active, created_at
) on products to anon, authenticated;
grant select on products to service_role;

-- Make PostgREST pick up the new function right away (no waiting for the
-- schema cache to refresh).
notify pgrst, 'reload schema';
