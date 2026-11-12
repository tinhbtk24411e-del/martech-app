-- STAGING ONLY. Do not run in production: inserts synthetic rows into public.leads.
-- request_id uses a DEMO prefix; the operational KPI API excludes this prefix.
-- lead_id stays a UUID to match the production schema.
begin;

with seed as (
  select
    i,
    (array[
      'Nguyen Minh Anh', 'Tran Gia Bao', 'Le Hoang Yen', 'Pham Duc Minh',
      'Vo Ngoc Ha', 'Dang Quoc Huy', 'Bui Thanh Truc', 'Do Khanh Linh',
      'Hoang Tuan Kiet', 'Ngo Mai Phuong', 'Duong Bao Chau', 'Ly Thanh Nam',
      'Truong Ngoc Han', 'Dinh Minh Quan', 'Huynh Thu Trang', 'Phan Gia Han',
      'Mai Anh Khoa', 'Cao Nhat Vy', 'Vu Hoai Thu', 'Ta Quang Vinh'
    ])[((i - 1) % 20) + 1] as person_name,
    (array[
      'Da Lat', 'Da Nang', 'Phu Quoc', 'Nha Trang', 'Ha Giang',
      'Hoi An', 'Sapa', 'Hue', 'Quy Nhon', 'Can Tho'
    ])[((i - 1) % 10) + 1] as destination_name,
    case (i - 1) % 6
      when 0 then 'planner'
      when 1 then 'direct'
      when 2 then 'facebook'
      when 3 then 'google'
      when 4 then 'tiktok'
      else 'instagram'
    end as traffic_source,
    case (i - 1) % 5
      when 0 then 'family'
      when 1 then 'budget'
      when 2 then 'resort'
      when 3 then 'explorer'
      else 'general'
    end as segment,
    case
      when i <= 25 then 'HOT'
      when i <= 60 then 'WARM'
      else 'COLD'
    end as priority,
    case
      when i <= 25 then 75 + (i % 2) * 5
      when i <= 60 then 55 + (i % 3) * 5
      else 35 + (i % 2) * 5
    end as score,
    case
      when i % 10 in (0, 1, 2, 3) then 'NEW'
      when i % 10 in (4, 5) then 'CONTACTED'
      when i % 10 = 6 then 'QUOTED'
      when i % 10 = 7 then 'BOOKED'
      else 'LOST'
    end as status
  from generate_series(1, 100) as generated(i)
),
classified as (
  select
    *,
    case
      when segment = 'family' then jsonb_build_array('family')
      when segment = 'budget' then jsonb_build_array('budget')
      when segment = 'resort' then jsonb_build_array('resort')
      when segment = 'explorer' then jsonb_build_array('explorer')
      else jsonb_build_array('general')
    end as traits,
    case
      when segment = 'family' then jsonb_build_array('Du lịch gia đình')
      when segment = 'budget' then jsonb_build_array('Tiết kiệm')
      when segment = 'resort' then jsonb_build_array('Nghỉ dưỡng')
      when segment = 'explorer' then jsonb_build_array('Khám phá', 'Thiên nhiên')
      else jsonb_build_array('Tham quan')
    end as preferences,
    case
      when priority = 'HOT' then jsonb_build_object(
        'booking_request', true, 'selected_tour', true,
        'tour_views', 2 + (i % 2), 'return_visit', true
      )
      when priority = 'WARM' then jsonb_build_object(
        'booking_request', false, 'selected_tour', true,
        'tour_views', i % 3, 'return_visit', false
      )
      else jsonb_build_object(
        'booking_request', false, 'selected_tour', false,
        'tour_views', i % 2, 'return_visit', false
      )
    end as signals
  from seed
)
insert into public.leads (
  lead_id, request_id, name, contact, email, phone, destination, duration, budget,
  party_size, travel_date, interests, selected_tour_id, selected_tour_name,
  lead_source, source, lead_score, lead_level, score_signals,
  customer_segment, customer_traits, consent_to_contact, lead_status,
  notification_status, booking_confirmation_status, note, utm_source,
  utm_medium, utm_campaign, created_at, updated_at, care_priority,
  nurture_step, nurture_opt_out
)
select
  gen_random_uuid(),
  'DEMO-20261108-' || lpad(i::text, 3, '0'),
  person_name,
  lower(replace(person_name, ' ', '.')) || lpad(i::text, 3, '0') || '@example.invalid',
  lower(replace(person_name, ' ', '.')) || lpad(i::text, 3, '0') || '@example.invalid',
  '090' || lpad(i::text, 7, '0'),
  destination_name,
  2 + (i % 8),
  1500000 + (i % 15) * 500000,
  1 + (i % 8),
  to_char(current_date + (i % 120) + 1, 'YYYY-MM-DD'),
  preferences,
  case when priority = 'COLD' then null else 'tour-' || lpad(i::text, 3, '0') end,
  case when priority = 'COLD' then null else 'Tour tham khảo - ' || destination_name end,
  'website',
  'website',
  score,
  case when score >= 70 then 'HOT' when score >= 45 then 'WARM' else 'COLD' end,
  signals,
  segment,
  traits,
  false,
  status,
  'PENDING',
  'NOT_READY',
  'Yêu cầu du lịch ' || destination_name || ', nhóm ' || segment || '.',
  traffic_source,
  case
    when traffic_source in ('facebook', 'tiktok', 'instagram') then 'paid_social'
    when traffic_source = 'google' then 'organic_search'
    when traffic_source = 'planner' then 'ai_planner'
    else 'none'
  end,
  'summer_trip_planning_2026',
  now() - (i * interval '1 day'),
  now() - (i * interval '1 day'),
  priority,
  0,
  true
from classified
on conflict (request_id) do update
set phone = excluded.phone;

commit;

-- Verification: should show 100 rows total, split 25 HOT / 35 WARM / 40 COLD.
select care_priority, lead_level, lead_status, utm_source, count(*) as leads
from public.leads
where request_id like 'DEMO-20261108-%'
group by care_priority, lead_level, lead_status, utm_source
order by care_priority, lead_level, lead_status, utm_source;

-- To remove only this demo batch later:
-- delete from public.leads where request_id like 'DEMO-20261108-%';
