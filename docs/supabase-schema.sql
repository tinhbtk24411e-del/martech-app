-- Run in Supabase SQL Editor. Keep SUPABASE_SECRET_KEY only in Vercel server variables.
create extension if not exists pgcrypto;

create table if not exists public.leads (
  lead_id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  name text not null,
  contact text not null,
  email text,
  phone text,
  zalo_phone text,
  destination text not null,
  duration integer not null check (duration between 1 and 60),
  budget numeric not null check (budget >= 0),
  party_size integer not null check (party_size between 1 and 30),
  travel_date text,
  interests jsonb not null default '[]'::jsonb,
  selected_tour_id text,
  selected_tour_name text,
  lead_source text not null default 'website',
  source text default 'website',
  lead_score integer not null default 0 check (lead_score between 0 and 100),
  lead_level text not null default 'NEW',
  score_signals jsonb not null default '{}'::jsonb,
  customer_segment text not null default 'general',
  customer_traits jsonb not null default '[]'::jsonb,
  voucher_code text,
  voucher_status text not null default 'PENDING',
  voucher_channel text default 'email',
  consent_to_contact boolean not null,
  lead_status text not null default 'NEW',
  notification_status text not null default 'PENDING',
  booking_confirmation_status text not null default 'NOT_READY',
  booking_confirmation_attempts integer not null default 0,
  last_booking_confirmation_at timestamptz,
  note text,
  utm_source text default 'direct',
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads
  add column if not exists request_id text,
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists zalo_phone text,
  add column if not exists destination text,
  add column if not exists duration integer,
  add column if not exists budget numeric,
  add column if not exists party_size integer,
  add column if not exists travel_date text,
  add column if not exists interests jsonb not null default '[]'::jsonb,
  add column if not exists source text default 'website',
  add column if not exists selected_tour_name text,
  add column if not exists lead_source text not null default 'website',
  add column if not exists note text,
  add column if not exists consent_to_contact boolean not null default false,
  add column if not exists lead_score integer default 0,
  add column if not exists lead_level text default 'NEW',
  add column if not exists score_signals jsonb not null default '{}'::jsonb,
  add column if not exists customer_segment text not null default 'general',
  add column if not exists customer_traits jsonb not null default '[]'::jsonb,
  add column if not exists voucher_code text,
  add column if not exists voucher_status text default 'PENDING',
  add column if not exists voucher_channel text default 'email',
  add column if not exists lead_status text not null default 'NEW',
  add column if not exists notification_status text not null default 'PENDING',
  add column if not exists booking_confirmation_status text not null default 'NOT_READY',
  add column if not exists booking_confirmation_attempts integer not null default 0,
  add column if not exists last_booking_confirmation_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists utm_source text default 'direct',
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

update public.leads
set request_id = gen_random_uuid()::text
where request_id is null;

alter table public.leads
  alter column request_id set not null;

create unique index if not exists leads_request_id_key on public.leads (request_id);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (lead_status, notification_status);
create index if not exists leads_utm_idx on public.leads (utm_source, utm_campaign, utm_medium);
create index if not exists leads_source_idx on public.leads (source, lead_level, voucher_status);

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

update public.leads
set utm_source = coalesce(utm_source, 'direct')
where utm_source is null;

update public.leads
set source = coalesce(source, 'website')
where source is null;

update public.leads
set lead_level = coalesce(lead_level, 'NEW')
where lead_level is null;

update public.leads
set voucher_status = coalesce(voucher_status, 'PENDING')
where voucher_status is null;

-- ---------------------------------------------------------------
-- v2: Sales lifecycle, notification retry, duplicate lookup
-- ---------------------------------------------------------------

alter table public.leads
  add column if not exists sales_note text,
  add column if not exists notification_attempts integer not null default 0,
  add column if not exists last_notification_at timestamptz;

-- Normalise legacy priority values written by earlier versions into the team's status set.
update public.leads
set lead_status = 'NEW'
where lead_status not in ('NEW', 'CONTACTED', 'QUOTED', 'BOOKED', 'LOST');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_lead_status_check'
  ) then
    alter table public.leads
      add constraint leads_lead_status_check
      check (lead_status in ('NEW', 'CONTACTED', 'QUOTED', 'BOOKED', 'LOST'));
  end if;
end $$;

create index if not exists leads_contact_destination_created_idx
  on public.leads (contact, destination, created_at desc);

create index if not exists leads_notification_retry_idx
  on public.leads (notification_status, notification_attempts, created_at);

create index if not exists leads_booking_confirmation_retry_idx
  on public.leads (booking_confirmation_status, booking_confirmation_attempts, created_at)
  where lead_status = 'BOOKED' and lead_source = 'booking_form';

alter table public.leads
  drop constraint if exists leads_booking_confirmation_status_check;

alter table public.leads
  add constraint leads_booking_confirmation_status_check
  check (booking_confirmation_status in ('NOT_READY', 'PENDING', 'PROCESSING', 'FAILED', 'SENT'));
