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
  add column if not exists last_notification_at timestamptz,
  add column if not exists visitor_id uuid,
  add column if not exists lead_priority text not null default 'HIGH';

alter table public.leads
  drop constraint if exists leads_lead_priority_check;

-- Existing lead rows are consultation submissions; normalize legacy values before validation.
update public.leads
set lead_priority = 'HIGH'
where lead_priority is null
   or lead_priority not in ('LOW', 'MEDIUM', 'HIGH');

alter table public.leads
  add constraint leads_lead_priority_check
  check (lead_priority in ('LOW', 'MEDIUM', 'HIGH'));

alter table public.leads
  alter column destination drop not null,
  alter column duration drop not null,
  alter column budget drop not null,
  alter column party_size drop not null;

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

-- ---------------------------------------------------------------
-- v3: anonymous visitor funnel and campaign attribution
-- ---------------------------------------------------------------

create table if not exists public.website_visitors (
  visitor_id uuid primary key,
  utm_source text not null default 'direct',
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  priority text not null default 'LOW' check (priority in ('LOW', 'MEDIUM', 'HIGH')),
  temperature text not null default 'COLD' check (temperature in ('COLD', 'WARM', 'HOT')),
  score integer not null default 0 check (score between 0 and 100),
  score_signals jsonb not null default '{}'::jsonb,
  page_views integer not null default 0 check (page_views >= 0),
  tour_detail_views integer not null default 0 check (tour_detail_views between 0 and 3),
  ai_used boolean not null default false,
  pricing_view boolean not null default false,
  engaged_2m boolean not null default false,
  return_visit boolean not null default false,
  compare_or_save boolean not null default false,
  contact_click boolean not null default false,
  phone_provided boolean not null default false,
  travel_date_near boolean not null default false,
  has_budget boolean not null default false,
  selected_tour boolean not null default false,
  party_size_multiple boolean not null default false,
  booking_started boolean not null default false,
  booking_submitted boolean not null default false,
  lead_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists website_visitors_first_seen_idx
  on public.website_visitors (first_seen_at desc);
create index if not exists website_visitors_source_priority_idx
  on public.website_visitors (utm_source, priority, first_seen_at desc);

alter table public.website_visitors enable row level security;

alter table public.website_visitors
  add column if not exists temperature text not null default 'COLD',
  add column if not exists score integer not null default 0,
  add column if not exists score_signals jsonb not null default '{}'::jsonb,
  add column if not exists tour_detail_views integer not null default 0,
  add column if not exists pricing_view boolean not null default false,
  add column if not exists engaged_2m boolean not null default false,
  add column if not exists return_visit boolean not null default false,
  add column if not exists compare_or_save boolean not null default false,
  add column if not exists contact_click boolean not null default false,
  add column if not exists phone_provided boolean not null default false,
  add column if not exists travel_date_near boolean not null default false,
  add column if not exists has_budget boolean not null default false,
  add column if not exists selected_tour boolean not null default false,
  add column if not exists party_size_multiple boolean not null default false,
  add column if not exists booking_started boolean not null default false,
  add column if not exists booking_submitted boolean not null default false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'website_visitors'
      and column_name = 'consultation_submitted'
  ) then
    execute 'update public.website_visitors
      set booking_submitted = true
      where consultation_submitted = true and booking_submitted = false';
  end if;
end;
$$;

alter table public.website_visitors
  drop constraint if exists website_visitors_temperature_check;
alter table public.website_visitors
  add constraint website_visitors_temperature_check
  check (temperature in ('COLD', 'WARM', 'HOT'));

with visitor_scores as (
  select
    visitor_id,
    least(
      100,
      least(3, tour_detail_views) * 5 +
        pricing_view::integer * 10 +
        engaged_2m::integer * 5 +
        return_visit::integer * 10 +
        compare_or_save::integer * 10 +
        contact_click::integer * 15 +
        ai_used::integer * 15 +
        phone_provided::integer * 10 +
        travel_date_near::integer * 15 +
        has_budget::integer * 10 +
        selected_tour::integer * 10 +
        party_size_multiple::integer * 5
    ) as score
  from public.website_visitors
)
update public.website_visitors as visitors
set score = visitor_scores.score,
    temperature = case
      when visitor_scores.score >= 70 or visitors.booking_started or visitors.booking_submitted then 'HOT'
      when visitor_scores.score >= 40 or visitors.ai_used or visitors.tour_detail_views > 0
        or visitors.pricing_view or visitors.return_visit or visitors.compare_or_save
        or visitors.contact_click then 'WARM'
      else 'COLD'
    end,
    score_signals = jsonb_build_object(
      'tour_detail_views', least(3, visitors.tour_detail_views),
      'pricing_view', visitors.pricing_view,
      'engaged_2m', visitors.engaged_2m,
      'return_visit', visitors.return_visit,
      'compare_or_save', visitors.compare_or_save,
      'contact_click', visitors.contact_click,
      'ai_used', visitors.ai_used,
      'phone_provided', visitors.phone_provided,
      'travel_date_near', visitors.travel_date_near,
      'has_budget', visitors.has_budget,
      'selected_tour', visitors.selected_tour,
      'party_size_multiple', visitors.party_size_multiple,
      'booking_started', visitors.booking_started,
      'booking_submitted', visitors.booking_submitted
    )
from visitor_scores
where visitors.visitor_id = visitor_scores.visitor_id;

drop function if exists public.record_website_visitor(uuid, text, text, text, text, text, text, uuid);

create or replace function public.record_website_visitor(
  p_visitor_id uuid,
  p_event text,
  p_utm_source text default 'direct',
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null,
  p_lead_id uuid default null,
  p_form_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_source text;
  visitor_score integer;
  visitor_temperature text;
  has_booking_intent boolean;
  has_engagement boolean;
begin
  if p_event not in (
    'visit', 'ai_used', 'tour_detail_view', 'pricing_view', 'engaged_2m',
    'return_visit', 'compare_or_save', 'contact_click', 'booking_started', 'booking_submitted'
  ) then
    raise exception 'Unsupported visitor event';
  end if;

  safe_source := case
    when lower(coalesce(p_utm_source, 'direct')) in ('facebook', 'tiktok', 'instagram', 'google', 'direct')
      then lower(coalesce(p_utm_source, 'direct'))
    else 'other'
  end;

  insert into public.website_visitors (
    visitor_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    priority, page_views, ai_used, tour_detail_views, pricing_view, engaged_2m,
    return_visit, compare_or_save, contact_click, phone_provided, travel_date_near,
    has_budget, selected_tour, party_size_multiple, booking_started, booking_submitted, lead_id
  )
  values (
    p_visitor_id, safe_source, p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term,
    case p_event
      when 'booking_submitted' then 'HIGH'
      when 'booking_started' then 'MEDIUM'
      when 'ai_used' then 'MEDIUM'
      else 'LOW'
    end,
    case when p_event = 'visit' then 1 else 0 end,
    p_event = 'ai_used',
    case when p_event = 'tour_detail_view' then 1 else 0 end,
    p_event = 'pricing_view',
    p_event = 'engaged_2m',
    p_event = 'return_visit',
    p_event = 'compare_or_save',
    p_event = 'contact_click',
    coalesce((p_form_data ->> 'phone_provided')::boolean, false),
    coalesce((p_form_data ->> 'travel_date_near')::boolean, false),
    coalesce((p_form_data ->> 'has_budget')::boolean, false),
    coalesce((p_form_data ->> 'selected_tour')::boolean, false),
    coalesce((p_form_data ->> 'party_size_multiple')::boolean, false),
    p_event = 'booking_started',
    p_event = 'booking_submitted',
    p_lead_id
  )
  on conflict (visitor_id) do update set
    utm_source = case
      when public.website_visitors.utm_source = 'direct' and excluded.utm_source <> 'direct'
        then excluded.utm_source
      else public.website_visitors.utm_source
    end,
    utm_medium = coalesce(public.website_visitors.utm_medium, excluded.utm_medium),
    utm_campaign = coalesce(public.website_visitors.utm_campaign, excluded.utm_campaign),
    utm_content = coalesce(public.website_visitors.utm_content, excluded.utm_content),
    utm_term = coalesce(public.website_visitors.utm_term, excluded.utm_term),
    priority = case
      when excluded.priority = 'HIGH' then 'HIGH'
      when excluded.priority = 'MEDIUM' and public.website_visitors.priority = 'LOW' then 'MEDIUM'
      else public.website_visitors.priority
    end,
    page_views = public.website_visitors.page_views + excluded.page_views,
    ai_used = public.website_visitors.ai_used or excluded.ai_used,
    tour_detail_views = least(3, public.website_visitors.tour_detail_views + excluded.tour_detail_views),
    pricing_view = public.website_visitors.pricing_view or excluded.pricing_view,
    engaged_2m = public.website_visitors.engaged_2m or excluded.engaged_2m,
    return_visit = public.website_visitors.return_visit or excluded.return_visit,
    compare_or_save = public.website_visitors.compare_or_save or excluded.compare_or_save,
    contact_click = public.website_visitors.contact_click or excluded.contact_click,
    phone_provided = public.website_visitors.phone_provided or excluded.phone_provided,
    travel_date_near = public.website_visitors.travel_date_near or excluded.travel_date_near,
    has_budget = public.website_visitors.has_budget or excluded.has_budget,
    selected_tour = public.website_visitors.selected_tour or excluded.selected_tour,
    party_size_multiple = public.website_visitors.party_size_multiple or excluded.party_size_multiple,
    booking_started = public.website_visitors.booking_started or excluded.booking_started,
    booking_submitted = public.website_visitors.booking_submitted or excluded.booking_submitted,
    lead_id = coalesce(excluded.lead_id, public.website_visitors.lead_id),
    last_seen_at = now();

  select least(
    100,
    least(3, tour_detail_views) * 5 +
      pricing_view::integer * 10 +
      engaged_2m::integer * 5 +
      return_visit::integer * 10 +
      compare_or_save::integer * 10 +
      contact_click::integer * 15 +
      ai_used::integer * 15 +
      phone_provided::integer * 10 +
      travel_date_near::integer * 15 +
      has_budget::integer * 10 +
      selected_tour::integer * 10 +
      party_size_multiple::integer * 5
  ),
  booking_started or booking_submitted,
  ai_used or tour_detail_views > 0 or pricing_view or return_visit or compare_or_save or contact_click
  into visitor_score, has_booking_intent, has_engagement
  from public.website_visitors
  where visitor_id = p_visitor_id;

  visitor_temperature := case
    when visitor_score >= 70 or has_booking_intent then 'HOT'
    when visitor_score >= 40 or has_engagement then 'WARM'
    else 'COLD'
  end;

  update public.website_visitors
  set score = visitor_score,
      temperature = visitor_temperature,
      score_signals = jsonb_build_object(
        'tour_detail_views', least(3, tour_detail_views),
        'pricing_view', pricing_view,
        'engaged_2m', engaged_2m,
        'return_visit', return_visit,
        'compare_or_save', compare_or_save,
        'contact_click', contact_click,
        'ai_used', ai_used,
        'phone_provided', phone_provided,
        'travel_date_near', travel_date_near,
        'has_budget', has_budget,
        'selected_tour', selected_tour,
        'party_size_multiple', party_size_multiple,
        'booking_started', booking_started,
        'booking_submitted', booking_submitted
      )
  where visitor_id = p_visitor_id;

  return jsonb_build_object(
    'score', visitor_score,
    'temperature', visitor_temperature,
    'signals', (select score_signals from public.website_visitors where visitor_id = p_visitor_id)
  );
end;
$$;

revoke all on function public.record_website_visitor(uuid, text, text, text, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_website_visitor(uuid, text, text, text, text, text, text, uuid, jsonb)
  to service_role;

create or replace function public.get_website_visitor_kpis(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',
      (select count(*) from public.website_visitors where first_seen_at >= p_since),
    'by_priority',
      coalesce((
        select jsonb_object_agg(priority, total)
        from (
          select priority, count(*) as total
          from public.website_visitors
          where first_seen_at >= p_since
          group by priority
        ) counts
      ), '{}'::jsonb),
    'by_source',
      coalesce((
        select jsonb_object_agg(utm_source, total)
        from (
          select utm_source, count(*) as total
          from public.website_visitors
          where first_seen_at >= p_since
          group by utm_source
        ) counts
      ), '{}'::jsonb)
    ,
    'by_temperature',
      coalesce((
        select jsonb_object_agg(temperature, total)
        from (
          select temperature, count(*) as total
          from public.website_visitors
          where first_seen_at >= p_since
          group by temperature
        ) counts
      ), '{}'::jsonb),
    'funnel',
      jsonb_build_object(
        'visitors',
          (select count(*) from public.website_visitors where first_seen_at >= p_since),
        'engaged',
          (select count(*) from public.website_visitors
            where first_seen_at >= p_since
              and (tour_detail_views > 0 or pricing_view or ai_used or compare_or_save)),
        'booking_started',
          (select count(*) from public.website_visitors
            where first_seen_at >= p_since and booking_started),
        'booking_submitted',
          (select count(*) from public.website_visitors
            where first_seen_at >= p_since and booking_submitted)
      )
  );
$$;

revoke all on function public.get_website_visitor_kpis(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_website_visitor_kpis(timestamptz)
  to service_role;
