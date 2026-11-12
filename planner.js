import { getVisitorUtm, recordVisitorEvent } from './visitor-tracking.js';
import { showPromotion } from './promo-offers.js';
recordVisitorEvent('visit');

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const today = new Date();
const todayIso = toLocalIsoDate(today);
const initialStartDate = new Date(today);
initialStartDate.setDate(initialStartDate.getDate() + 4);
const plannerState = {
  startDate: toLocalIsoDate(initialStartDate),
  endDate: '',
  startTime: '06:20',
  endTime: '14:30',
};
const initialEndDate = new Date(`${plannerState.startDate}T12:00:00`);
initialEndDate.setDate(initialEndDate.getDate() + 2);
plannerState.endDate = toLocalIsoDate(initialEndDate);
const currencyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
let plannerWeather = [];
let plannerWeatherError = '';
let selectedPlannerDay = 0;
let chatConversation = [];
let chatRequestPending = false;
let currentPlan = null;

function formatPlannerMoney(amount) {
  return `${currencyFormatter.format(amount)}đ`;
}

function dateRange() {
  const start = new Date(`${plannerState.startDate}T12:00:00`);
  const end = new Date(`${plannerState.endDate}T12:00:00`);
  const days = Math.round((end - start) / 86400000) + 1;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toLocalIsoDate(date);
  });
}

function displayDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function updatePlannerDateLabels() {
  const dates = dateRange();
  const start = displayDate(plannerState.startDate);
  const end = displayDate(plannerState.endDate);
  const nights = Math.max(0, dates.length - 1);
  $('#plannerDateLabel').textContent = `${start} – ${end} · ${plannerState.startTime}–${plannerState.endTime}`;
  $('#plannerDestinationDates').textContent = `${start} – ${end} · ${dates.length} ngày ${nights} đêm`;
  $('#plannerStartDate').value = plannerState.startDate;
  $('#plannerEndDate').value = plannerState.endDate;
  $('#plannerEndDate').min = plannerState.startDate;
  $('#plannerStartTime').value = plannerState.startTime;
  $('#plannerEndTime').value = plannerState.endTime;
  renderPlannerDayTabs(dates.length);
  const startField = $('#plannerStartDate');
  startField.min = todayIso;
  const guests = Number($('#plannerGuestCount').value) || 1;
  const rooms = Math.ceil(guests / 2);
  $('#plannerGuestLabel').textContent = `${guests} khách`;
  $('#plannerRoomLabel').textContent = `${rooms} ${rooms === 1 ? 'phòng' : 'phòng'}`;
  if (currentPlan) $('#plannerDestinationDates').textContent = `${start} – ${end} · ${dates.length} ngày ${nights} đêm`;
}

function renderPlannerDayTabs(dayCount) {
  const selectedDay = Math.min(selectedPlannerDay, dayCount - 1);
  const tabs = Array.from({ length: dayCount }, (_, index) => {
    const button = document.createElement('button');
    button.className = index === selectedDay ? 'active' : '';
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(index === selectedDay));
    button.dataset.plannerDay = String(index);
    button.textContent = `Ngày ${index + 1}`;
    button.addEventListener('click', () => renderPlannerSchedule(index));
    return button;
  });
  $('#plannerDayTabs').replaceChildren(...tabs);
  return selectedDay;
}

function openPlannerDatePicker(open) {
  if (open) updatePlannerDateLabels();
  $('#plannerDatePicker').hidden = !open;
  $('#plannerDateToggle').setAttribute('aria-expanded', String(open));
  if (open) $('#plannerStartDate').focus();
}

$('#plannerDateToggle').addEventListener('click', () => {
  openPlannerDatePicker($('#plannerDatePicker').hidden);
});

$('#plannerStartDate').addEventListener('change', () => {
  const start = new Date(`${$('#plannerStartDate').value}T12:00:00`);
  const end = new Date(`${$('#plannerEndDate').value}T12:00:00`);
  if (!$('#plannerEndDate').value || end < start) {
    start.setDate(start.getDate() + 2);
    $('#plannerEndDate').value = toLocalIsoDate(start);
  }
});

$('#plannerDatePicker').addEventListener('submit', (event) => {
  event.preventDefault();
  if (chatRequestPending) {
    $('#plannerDateError').textContent = 'Vui lòng đợi AI tạo lịch trình xong rồi cập nhật thông tin.';
    return;
  }
  const startDate = $('#plannerStartDate').value;
  const endDate = $('#plannerEndDate').value;
  const dayCount = Math.round((new Date(`${endDate}T12:00:00`) - new Date(`${startDate}T12:00:00`)) / 86400000) + 1;
  if (!startDate || !endDate || dayCount < 1) {
    $('#plannerDateError').textContent = 'Ngày về phải bằng hoặc sau ngày đi.';
    return;
  }
  if (startDate < todayIso) {
    $('#plannerDateError').textContent = 'Ngày đi không thể ở trong quá khứ.';
    return;
  }
  if (dayCount > 14) {
    $('#plannerDateError').textContent = 'Lịch trình demo hỗ trợ tối đa 14 ngày.';
    return;
  }
  if (dayCount === 1 && $('#plannerEndTime').value < $('#plannerStartTime').value) {
    $('#plannerDateError').textContent = 'Giờ kết thúc phải sau giờ khởi hành trong chuyến đi một ngày.';
    return;
  }
  if (!$('#plannerGuestCount').validity.valid) {
    $('#plannerDateError').textContent = 'Số khách phải từ 1 đến 30.';
    return;
  }
  plannerState.startDate = startDate;
  plannerState.endDate = endDate;
  plannerState.startTime = $('#plannerStartTime').value;
  plannerState.endTime = $('#plannerEndTime').value;
  currentPlan = null;
  plannerWeather = [];
  $('#plannerResults').hidden = true;
  $('#plannerEmptyState').hidden = false;
  $('#toolbarCost').textContent = 'Chưa tạo lịch trình';
  $('#shareItinerary').disabled = true;
  $('#plannerDateError').textContent = '';
  selectedPlannerDay = Math.min(selectedPlannerDay, dayCount - 1);
  updatePlannerDateLabels();
  openPlannerDatePicker(false);
});

function renderPlannerSchedule(dayIndex) {
  selectedPlannerDay = dayIndex;
  const dates = dateRange();
  const dayItems = currentPlan?.days?.[dayIndex]?.activities || [];
  const rows = dayItems.map((item, index) => {
    const row = document.createElement('tr');
    [item.time, `${item.name} · ${item.location}`, item.duration, item.ticket_per_person ? `~${formatPlannerMoney(item.ticket_per_person)}` : 'Miễn phí / không gồm vé'].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  });
  $('#plannerScheduleRows').replaceChildren(...rows);
  const cards = dayItems.map((item, index) => {
    const card = document.createElement('article');
    card.className = 'activity-card generated';
    const time = document.createElement('time');
    time.textContent = item.time;
    const number = document.createElement('span');
    number.className = 'activity-number';
    number.textContent = String(index + 1);
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = item.name;
    const location = document.createElement('small');
    location.textContent = item.location;
    const duration = document.createElement('small');
    duration.textContent = item.duration;
    const cost = document.createElement('p');
    cost.textContent = item.ticket_per_person
      ? `Vé tham khảo: ~${formatPlannerMoney(item.ticket_per_person)}/người`
      : 'Không có vé tham quan tính riêng';
    details.append(name, location, duration, cost);
    card.append(time, number, details);
    return card;
  });
  $('#plannerActivities').replaceChildren(...cards);
  $('[data-day-date]').textContent = displayDate(dates[dayIndex]);
  $('#plannerDayCount').textContent = `${dayItems.length} hoạt động`;
  const dayTicketTotal = dayItems.reduce((total, item) => total + item.ticket_per_person, 0);
  $('#dayTicketTotal').textContent = dayTicketTotal
    ? `Vé tham quan ngày này: ~${formatPlannerMoney(dayTicketTotal)}/người`
    : 'Vé tham quan ngày này: miễn phí / chưa gồm vé';
  $('#plannerDayTabs').querySelectorAll('[data-planner-day]').forEach((button) => {
    const active = Number(button.dataset.plannerDay) === dayIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  renderPlannerWeather(dayIndex);
}

function weatherLabel(code) {
  if ([0].includes(code)) return 'Trời quang';
  if ([1, 2].includes(code)) return 'Có mây';
  if ([3].includes(code)) return 'Nhiều mây';
  if ([45, 48].includes(code)) return 'Sương mù';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Mưa phùn';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Có mưa';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Mưa tuyết';
  if ([95, 96, 99].includes(code)) return 'Dông';
  return 'Chưa có mô tả';
}

function renderPlannerWeather(dayIndex) {
  const status = $('#weatherStatus');
  if (plannerWeatherError) {
    status.textContent = 'Chưa tải được dự báo thời tiết trực tiếp. Vui lòng thử lại sau.';
    status.title = plannerWeatherError;
    return;
  }
  const day = plannerWeather.find((item) => item.date === dateRange()[dayIndex]);
  if (!day) {
    status.textContent = 'Chưa có dự báo cho ngày này; dữ liệu thường khả dụng trong 16 ngày tới.';
    return;
  }
  status.textContent = `☁ ${weatherLabel(day.code)} · ${Math.round(day.min)}°–${Math.round(day.max)}° · Khả năng mưa ${day.rain}%`;
  status.title = 'Dự báo từ Open-Meteo; thời tiết thực tế có thể thay đổi.';
}

async function loadPlannerWeather() {
  if (!currentPlan) return;
  const destination = currentPlan.destination;
  const status = $('#weatherStatus');
  status.textContent = 'Đang tìm dự báo thời tiết cho điểm đến…';
  try {
    const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
    geocodingUrl.search = new URLSearchParams({
      name: destination,
      count: '1',
      language: 'vi',
      format: 'json',
    }).toString();
    const geocodingResponse = await fetch(geocodingUrl);
    if (!geocodingResponse.ok) throw new Error(`Dịch vụ định vị phản hồi mã ${geocodingResponse.status}.`);
    const geocoding = await geocodingResponse.json();
    if (currentPlan?.destination !== destination) return;
    const result = geocoding?.results?.[0];
    if (!Number.isFinite(result?.latitude) || !Number.isFinite(result?.longitude)) {
      throw new Error('Không tìm thấy vị trí thời tiết cho điểm đến này.');
    }
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(result.latitude),
      longitude: String(result.longitude),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '16',
    }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Dịch vụ thời tiết phản hồi mã ${response.status}.`);
    const data = await response.json();
    if (currentPlan?.destination !== destination) return;
    const daily = data?.daily;
    if (!Array.isArray(daily?.time) || !Array.isArray(daily?.weather_code) ||
        !Array.isArray(daily?.temperature_2m_max) || !Array.isArray(daily?.temperature_2m_min) ||
        !Array.isArray(daily?.precipitation_probability_max)) {
      throw new Error('Dữ liệu dự báo thời tiết không đúng định dạng.');
    }
    plannerWeather = daily.time.map((date, index) => ({
      date,
      code: Number(daily.weather_code[index]),
      max: Number(daily.temperature_2m_max[index]),
      min: Number(daily.temperature_2m_min[index]),
      rain: Number(daily.precipitation_probability_max[index]),
    })).filter((item) => dateRange().includes(item.date));
    plannerWeatherError = '';
    renderPlannerWeather(selectedPlannerDay);
  } catch (error) {
    if (currentPlan?.destination !== destination) return;
    plannerWeatherError = error instanceof Error ? error.message : 'Lỗi không xác định khi tải thời tiết.';
    renderPlannerWeather(selectedPlannerDay);
  }
}

function renderPlannerPlan(plan) {
  currentPlan = plan;
  plannerState.guests = Number($('#plannerGuestCount').value);
  const dates = dateRange();
  $('#plannerEmptyState').hidden = true;
  $('#plannerResults').hidden = false;
  $('#plannerDestinationName').textContent = plan.destination;
  $('#plannerDestinationDates').textContent = `${displayDate(plannerState.startDate)} – ${displayDate(plannerState.endDate)} · ${dates.length} ngày ${dates.length - 1} đêm`;
  $('#plannerDestinationSummary').textContent = plan.summary;
  $('#plannerGuestLabel').textContent = `${plannerState.guests} khách`;
  $('#plannerRoomLabel').textContent = `${plan.room_count} phòng`;
  $('#estimateTotal').textContent = formatPlannerMoney(plan.costs.total);
  $('#estimatePerGuest').textContent = formatPlannerMoney(plan.costs.per_person);
  $('#toolbarCost').textContent = `~${formatPlannerMoney(plan.costs.per_person)}/người`;
  $('#shareItinerary').disabled = false;

  const serviceDetails = [
    { title: 'Vé máy bay / di chuyển liên tỉnh', value: plan.services.flight, unit: `${formatPlannerMoney(plan.services.flight.price_per_person)}/khách khứ hồi`, total: plan.costs.flight },
    { title: 'Khách sạn', value: plan.services.hotel, unit: `${formatPlannerMoney(plan.services.hotel.price_per_room_per_night)}/phòng/đêm`, total: plan.costs.hotel },
    { title: 'Di chuyển địa phương', value: plan.services.transport, unit: `${formatPlannerMoney(plan.services.transport.price_per_person)}/khách`, total: plan.costs.transport },
    { title: 'Ăn uống', value: plan.services.meals, unit: `${formatPlannerMoney(plan.services.meals.price_per_person)}/khách`, total: plan.costs.meals },
    { title: 'Vé tham quan', value: { name: 'Tổng vé các hoạt động trong lịch trình' }, unit: `${formatPlannerMoney(Math.ceil(plan.costs.tickets / plannerState.guests))}/khách`, total: plan.costs.tickets },
  ];
  const serviceCards = serviceDetails.map((service) => {
    const card = document.createElement('article');
    card.className = 'service-card';
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = service.title;
    const provider = document.createElement('small');
    provider.textContent = service.value.name;
    const estimate = document.createElement('small');
    estimate.textContent = `Đơn giá tham khảo: ${service.unit}`;
    const total = document.createElement('b');
    total.textContent = `Tổng khoản: ${formatPlannerMoney(service.total)}`;
    details.append(heading, provider, estimate, total);
    card.append(details);
    return card;
  });
  $('#plannerServiceCards').replaceChildren(...serviceCards);

  const costRows = [
    ['Vé máy bay / di chuyển liên tỉnh', plan.costs.flight],
    [`Khách sạn (${dates.length - 1} đêm · ${plan.room_count} phòng)`, plan.costs.hotel],
    ['Di chuyển địa phương', plan.costs.transport],
    ['Ăn uống', plan.costs.meals],
    ['Vé tham quan', plan.costs.tickets],
  ].map(([label, amount]) => {
    const row = document.createElement('div');
    row.className = 'planner-cost-line';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('strong');
    value.textContent = formatPlannerMoney(amount);
    row.append(name, value);
    return row;
  });
  $('#plannerCostLines').replaceChildren(...costRows);

  const assumptions = document.createElement('ul');
  assumptions.className = 'planner-assumptions';
  plan.assumptions.forEach((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    assumptions.append(item);
  });
  $('#plannerCostLines').append(assumptions);

  const mapQuery = `${plan.destination}, Vietnam`;
  const encodedQuery = encodeURIComponent(mapQuery);
  $('#mapSearch').value = mapQuery;
  $('#plannerMapFrame').src = `https://maps.google.com/maps?q=${encodedQuery}&output=embed`;
  $('#plannerGoogleMaps').href = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
  $('#plannerMapLink').href = `https://www.openstreetmap.org/search?query=${encodedQuery}`;
  $('#plannerMapFrame').title = `Bản đồ khu vực ${plan.destination}`;
  plannerWeather = [];
  plannerWeatherError = '';
  selectedPlannerDay = 0;
  renderPlannerDayTabs(dates.length);
  renderPlannerSchedule(0);
  loadPlannerWeather();
}

function appendChatMessage(text, sender = 'bot') {
  const message = document.createElement('div');
  message.className = `chat-bubble ${sender}`;
  message.textContent = text;
  $('#chatMessages').append(message);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  return message;
}

function continueWithPromotion(voucherCode) {
  try {
    sessionStorage.setItem('vietjourney_voucher_code', voucherCode);
  } catch (error) {
    console.error('[planner] Could not save promotion code', error);
  }
  window.location.href = `index.html#contact`;
}

function plannerTripContext() {
  return {
    start_date: plannerState.startDate,
    end_date: plannerState.endDate,
    start_time: plannerState.startTime,
    end_time: plannerState.endTime,
    guests: Number($('#plannerGuestCount').value),
    budget: $('#plannerBudget').value.trim() ? Number($('#plannerBudget').value) : null,
  };
}

async function sendChatMessage(query) {
  if (chatRequestPending) return;
  appendChatMessage(query, 'user');
  const loadingMessage = appendChatMessage('Đang nghĩ câu trả lời…');
  loadingMessage.setAttribute('aria-label', 'Đang chờ trợ lý AI');
  chatRequestPending = true;
  const input = $('#chatInput');
  const sendButton = $('#chatForm button[type="submit"]');
  $('#chatMessages').setAttribute('aria-busy', 'true');
  input.disabled = true;
  sendButton.disabled = true;
  $$('[data-chat-prompt]').forEach((button) => { button.disabled = true; });

  try {
    const response = await fetch('/api/aichat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'planner',
        message: query,
        history: chatConversation.slice(-10),
        trip: plannerTripContext(),
      }),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('AI trả về phản hồi không hợp lệ. Bạn thử lại nhé.');
    }
    if (!data || typeof data !== 'object') throw new Error('AI trả về phản hồi không hợp lệ. Bạn thử lại nhé.');
    if (!response.ok) throw new Error(data.error || 'AI chưa thể trả lời lúc này. Bạn thử lại nhé.');
    if (!data.plan || typeof data.plan.destination !== 'string' ||
        !Array.isArray(data.plan.days) || !data.plan.costs) {
      throw new Error('AI chưa tạo được lịch trình hợp lệ. Bạn thử lại nhé.');
    }
    renderPlannerPlan(data.plan);
    const budgetNote = data.plan.budget_status === 'over_budget'
      ? ' Dự toán đang vượt ngân sách bạn đặt; xem phần giả định và chi phí để cân nhắc.'
      : '';
    const reply = `${data.plan.destination}: ${data.plan.summary} Dự toán khoảng ${formatPlannerMoney(data.plan.costs.per_person)}/người, ${formatPlannerMoney(data.plan.costs.total)} cho cả đoàn. Giá mô phỏng tham khảo, chưa xác nhận.${budgetNote}`;
    chatConversation.push(
      { role: 'user', text: query },
      { role: 'assistant', text: reply },
    );
    chatConversation = chatConversation.slice(-10);
    appendChatMessage(reply);
    const visitor = await recordVisitorEvent('ai_used');
    showPromotion(visitor?.temperature || 'WARM', continueWithPromotion);
  } catch (error) {
    const message = error instanceof TypeError
      ? 'Không kết nối được với AI. Bạn thử lại sau nhé.'
      : error.message || 'Không kết nối được với AI. Bạn thử lại sau nhé.';
    appendChatMessage(message);
  } finally {
    loadingMessage.remove();
    chatRequestPending = false;
    $('#chatMessages').setAttribute('aria-busy', 'false');
    input.disabled = false;
    sendButton.disabled = false;
    $$('[data-chat-prompt]').forEach((button) => { button.disabled = false; });
    input.focus();
  }
}

$('#shareItinerary').addEventListener('click', async () => {
  if (!currentPlan) return;
  const days = dateRange().length;
  const destination = currentPlan.destination;
  const itinerary = currentPlan.days.map((day, index) => (
    `Ngày ${index + 1}: ${day.activities.map((activity) => `${activity.time} ${activity.name} (${activity.location})`).join('; ')}`
  )).join('\n');
  const shareText = `${destination} · ${days} ngày ${Math.max(0, days - 1)} đêm\n${itinerary}\nDự toán: ${formatPlannerMoney(currentPlan.costs.per_person)}/người, ${formatPlannerMoney(currentPlan.costs.total)} cả đoàn. Giá mô phỏng tham khảo, chưa xác nhận.`;
  const shareData = { title: `Lịch trình ${destination} · VietJourney`, text: shareText };
  const status = $('#shareStatus');
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      status.textContent = 'Đã mở tùy chọn chia sẻ.';
    } else {
      await navigator.clipboard.writeText(shareText);
      status.textContent = 'Đã sao chép nội dung lịch trình.';
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    status.textContent = 'Không thể chia sẻ tự động. Hãy sao chép nội dung lịch trình.';
  }
});

$$('.planner-tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.planner-tabs [role="tab"]').forEach((item) => item.classList.toggle('active', item === tab));
  });
});

function searchPlannerMap() {
  const query = $('#mapSearch').value.trim();
  if (!query) return;
  const mapUrl = new URL('https://maps.google.com/maps');
  mapUrl.search = new URLSearchParams({ q: query, output: 'embed' }).toString();
  $('#plannerMapFrame').src = mapUrl.toString();
}

$('#mapSearch').addEventListener('change', searchPlannerMap);
$('#mapSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchPlannerMap();
  }
});
$('#mapFilter').addEventListener('change', (event) => {
  const category = event.currentTarget.value;
  const destination = currentPlan?.destination;
  if (!destination) return;
  $('#mapSearch').value = category === 'Tất cả' ? destination : `${category} ở ${destination}`;
  searchPlannerMap();
});

$('#chatToggle').addEventListener('click', (event) => {
  const panel = $('#chatPanel');
  panel.hidden = !panel.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) $('#chatInput').focus();
});

$('#chatClose').addEventListener('click', () => {
  $('#chatPanel').hidden = true;
  $('#chatToggle').setAttribute('aria-expanded', 'false');
  $('#chatToggle').focus();
});

$('#chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#chatInput');
  const query = input.value.trim();
  if (!query || chatRequestPending) return;
  input.value = '';
  sendChatMessage(query);
});

$$('[data-chat-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    const query = button.dataset.chatPrompt;
    if (!chatRequestPending) sendChatMessage(query);
  });
});

$('.menu').addEventListener('click', (event) => {
  const open = $('nav').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

$('.planner-menu').addEventListener('click', () => {
  const menu = $('.menu');
  menu.click();
});

$$('nav a').forEach((link) => {
  link.addEventListener('click', () => {
    $('nav').classList.remove('open');
    $('.menu').setAttribute('aria-expanded', 'false');
  });
});

updatePlannerDateLabels();

// Lead magnet: send this itinerary to the visitor's email (creates a COLD nurture lead).
function itineraryText(plan) {
  const days = dateRange().length;
  const lines = plan.days.map((day, index) => (
    `Ngày ${index + 1}: ${day.activities.map((a) => `${a.time} ${a.name}`).join('; ')}`
  ));
  return `${plan.destination} · ${days} ngày ${Math.max(0, days - 1)} đêm\n${lines.join('\n')}\n` +
    `Dự toán (mô phỏng, chưa xác nhận): ${formatPlannerMoney(plan.costs.total)} cả đoàn.`;
}

$('#itineraryEmailForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentPlan) return;
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const status = $('#itineraryStatus');
  const days = dateRange().length;
  submit.disabled = true;
  status.textContent = 'Đang gửi lịch trình...';
  try {
    const response = await fetch('/api/itinerary-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('#itineraryName').value.trim(),
        email: $('#itineraryEmail').value.trim(),
        consent_to_contact: $('#itineraryConsent').checked,
        destination: currentPlan.destination,
        duration_days: days,
        budget: Number($('#plannerBudget').value) || null,
        party_size: Number($('#plannerGuestCount').value) || 1,
        plan_summary: itineraryText(currentPlan),
        ...getVisitorUtm(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'failed');
    status.textContent = data.duplicate
      ? 'Bạn đã yêu cầu lịch trình này gần đây. Kiểm tra hộp thư của bạn.'
      : (data.notification_status === 'SENT'
        ? 'Đã gửi lịch trình. Hãy kiểm tra hộp thư của bạn.'
        : 'Đã ghi nhận. Lịch trình sẽ được gửi trong ít phút.');
  } catch (error) {
    status.textContent = error.message && error.message !== 'failed'
      ? error.message : 'Chưa gửi được lịch trình. Vui lòng thử lại.';
  } finally {
    submit.disabled = false;
  }
});
