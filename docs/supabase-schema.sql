-- Run in Supabase SQL Editor. Keep SUPABASE_SECRET_KEY only in Vercel server variables.
create extension if not exists pgcrypto;
create table if not exists public.leads (
  lead_id uuid primary key default gen_random_uuid(), request_id text not null unique,
  name text not null, contact text not null, destination text not null,
  duration integer not null check (duration between 1 and 60), budget numeric not null check (budget >= 0), party_size integer not null check (party_size between 1 and 30),
  travel_date text, interests jsonb not null default '[]'::jsonb, selected_tour_id text, selected_tour_name text,
  lead_source text not null default 'website', consent_to_contact boolean not null,
  lead_status text not null default 'NEW', notification_status text not null default 'PENDING', note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (lead_status, notification_status);
alter table public.leads enable row level security;
-- No browser policies: browser never accesses this table. Server uses the secret/service key.
create or replace function public.touch_leads_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads for each row execute function public.touch_leads_updated_at();
