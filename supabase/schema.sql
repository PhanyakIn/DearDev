-- DearDev shop database schema (Supabase / Postgres)
-- Run this in Supabase Dashboard → SQL Editor → New query → Paste → Run

-- 1. Products table (public catalog data only, no secrets here)
create table if not exists products (
  id text primary key,
  name text not null,
  price integer not null default 0,
  currency text not null default '฿THB',
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
insert into products (id, name, price, currency, image_url, badge, short_detail, description, video_url)
values (
  'prod1',
  'Movement System R6 V1',
  199,
  '฿THB',
  'REPLACE_WITH_STORAGE_PUBLIC_URL',
  'Sell',
  'Advanced Movement System Version 1 for R6 models (Only PC)',
  'A high-quality movement system, perfect for parkour, RPG, and racing games. It is easily customizable via ModuleScript and includes free SFX, VFX, animations, and more.',
  'https://youtu.be/flvTWThTPRc?si=Fme119kc9-nkG_PK'
)
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  currency = excluded.currency,
  image_url = excluded.image_url,
  badge = excluded.badge,
  short_detail = excluded.short_detail,
  description = excluded.description,
  video_url = excluded.video_url;

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
values (1, 'https://discord.com/users/611523422383636492', 'https://www.facebook.com/profile.php?id=61595086306611')
on conflict (id) do update set
  discord = excluded.discord,
  facebook = excluded.facebook,
  updated_at = now();
