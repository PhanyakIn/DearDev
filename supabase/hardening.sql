-- Payment hardening — paste this into the Supabase SQL editor.
--
-- This file is safe to run on the LIVE project: it only creates the per-IP
-- rate-limit counter and tightens the `products` column grants. It does NOT
-- touch the products, product_contains or site_contact rows, so the live
-- catalog, prices and images stay exactly as they are.
--
-- (Do not re-run the whole supabase/schema.sql on the live project just for
-- this — the seed rows there would overwrite the real product data. That seed
-- has been made safe in schema.sql, but this file is the short path.)
--
-- Run it once, then verify with:  npm run check:hardening

-- ---------------------------------------------------------------------------
-- 1. Per-IP rate limiting for the payment endpoints.
--    The counter lives in Postgres so every serverless instance shares it —
--    an in-memory counter would reset on every cold start.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. Keep the private storage object name server-only.
--    The anon key ships inside the browser bundle and RLS policies are
--    row-level, not column-level — so without an explicit column grant anyone
--    could read products.file_path straight from PostgREST. The bucket itself
--    is private, so this is defence in depth, not an open door.
-- ---------------------------------------------------------------------------

revoke select on products from anon, authenticated;
grant select (
  id, name, price, currency, image_url, badge,
  short_detail, description, video_url, is_active, created_at
) on products to anon, authenticated;
grant select on products to service_role;

-- Make PostgREST pick up the new function right away (no waiting for the
-- schema cache to refresh).
notify pgrst, 'reload schema';
