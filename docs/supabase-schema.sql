-- Run in Supabase SQL Editor. Keep SUPABASE_SECRET_KEY only in Vercel server variables.
create extension if not exists pgcrypto;

create table if not exists public.leads (
  lead_id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  name text not null,
  contact text not null,
  destination text not null,
  duration integer not null check (duration between 1 and 60),
  budget numeric not null check (budget >= 0),
  party_size integer not null check (party_size between 1 and 30),
  travel_date text,
  interests jsonb not null default '[]'::jsonb,
  selected_tour_id text,
  selected_tour_name text,
  lead_source text not null default 'website',
  consent_to_contact boolean not null,
  lead_status text not null default 'NEW',
  notification_status text not null default 'PENDING',
  note text,
  utm_source text default 'direct',
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (lead_status, notification_status);
create index if not exists leads_utm_idx on public.leads (utm_source, utm_campaign, utm_medium);

alter table public.leads enable row level security;

create or replace function public.touch_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads for each row execute function public.touch_leads_updated_at();

alter table public.leads
  add column if not exists utm_source text default 'direct',
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

update public.leads
set utm_source = coalesce(utm_source, 'direct')
where utm_source is null;
