-- Cole isso no Supabase (SQL Editor) e rode.
-- Modo "funcionar hoje": SEM RLS (rápido).
-- Depois a gente fecha com auth/policies.

create table if not exists public.wants (
  id uuid primary key default gen_random_uuid(),
  portal_id text not null,
  card_name text not null,
  qty integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists wants_portal_id_idx on public.wants(portal_id);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  portal_id text not null,
  guild text not null,
  wants jsonb not null,
  total_qty integer not null,
  unit_price_brl numeric(12,2) not null,
  total_brl numeric(12,2) not null,
  bonus_cards integer not null default 0,
  shipping jsonb,
  mp_preference_id text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create index if not exists orders_portal_id_idx on public.orders(portal_id);
