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
const plannerSchedule = [
  [
    { time: '06:20', activity: 'Khởi hành từ sân bay Tân Sơn Nhất', location: 'TP. Hồ Chí Minh', duration: 'Theo vé máy bay', ticket: 0 },
    { time: '08:50', activity: 'Đến sân bay Liên Khương', location: 'Đức Trọng, Lâm Đồng', duration: 'Khoảng 1 giờ 40 phút di chuyển', ticket: 0 },
    { time: '10:30', activity: 'Nhận phòng / gửi hành lý', location: 'Khách sạn trung tâm Đà Lạt', duration: 'Khoảng 30 phút', ticket: 0 },
    { time: '14:00', activity: 'Dạo quanh hồ Xuân Hương', location: 'Trung tâm Đà Lạt', duration: 'Khoảng 2 giờ', ticket: 0 },
  ],
  [
    { time: '08:00', activity: 'Tham quan thác Datanla', location: 'Quốc lộ 20, Đà Lạt', duration: 'Khoảng 2 giờ', ticket: 100000 },
    { time: '11:30', activity: 'Ăn trưa địa phương', location: 'Khu vực trung tâm', duration: 'Khoảng 1 giờ', ticket: 0 },
    { time: '14:00', activity: 'Tham quan đồi chè Cầu Đất', location: 'Xuân Trường, Đà Lạt', duration: 'Khoảng 3 giờ', ticket: 0 },
  ],
  [
    { time: '08:00', activity: 'Dạo chợ Đà Lạt, ăn sáng', location: 'Nguyễn Thị Minh Khai, Đà Lạt', duration: 'Khoảng 1 giờ', ticket: 0 },
    { time: '10:00', activity: 'Tham quan vườn hoa thành phố', location: 'Đường Trần Quốc Toản, Đà Lạt', duration: 'Khoảng 2 giờ', ticket: 0 },
    { time: '14:30', activity: 'Di chuyển ra sân bay Liên Khương', location: 'Đức Trọng, Lâm Đồng', duration: 'Dự phòng khoảng 1 giờ 40 phút', ticket: 0 },
  ],
];
const currencyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
let plannerWeather = [];
let plannerWeatherError = '';
let selectedPlannerDay = 0;
let chatConversation = [];
let chatRequestPending = false;

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
  const guests = Number($('#estimateGuests').value) || 1;
  const rooms = Number($('#estimateRooms').value) || 1;
  $('#plannerGuestLabel').textContent = `${guests} khách`;
  $('#plannerRoomLabel').textContent = `${rooms} ${rooms === 1 ? 'phòng' : 'phòng'}`;
  $('#estimateNightLabel').textContent = `${nights} đêm`;
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
  plannerState.startDate = startDate;
  plannerState.endDate = endDate;
  plannerState.startTime = $('#plannerStartTime').value;
  plannerState.endTime = $('#plannerEndTime').value;
  $('#plannerDateError').textContent = '';
  selectedPlannerDay = Math.min(selectedPlannerDay, dayCount - 1);
  updatePlannerDateLabels();
  updatePlannerCost();
  renderPlannerSchedule(selectedPlannerDay);
  loadPlannerWeather();
  openPlannerDatePicker(false);
});

function renderPlannerSchedule(dayIndex) {
  selectedPlannerDay = dayIndex;
  const dates = dateRange();
  const dayItems = plannerSchedule[dayIndex] || (dayIndex === dates.length - 1
    ? [{ time: plannerState.endTime, activity: 'Kết thúc chuyến đi / di chuyển ra sân bay', location: 'Đà Lạt', duration: 'Kiểm tra giờ và phương tiện trước chuyến đi', ticket: 0 }]
    : []);
  const rows = dayItems.map((item, index) => {
    const row = document.createElement('tr');
    const time = dayIndex === 0 && index === 0
      ? plannerState.startTime
      : dayIndex === dates.length - 1 && index === dayItems.length - 1
        ? plannerState.endTime
        : item.time;
    [time, `${item.activity} · ${item.location}`, item.duration, item.ticket ? `~${formatPlannerMoney(item.ticket)}` : 'Chưa gồm vé'].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'Chưa có hoạt động mẫu cho ngày này. Hãy hỏi trợ lý AI để gợi ý lịch trình phù hợp.';
    row.append(cell);
    rows.push(row);
  }
  $('#plannerScheduleRows').replaceChildren(...rows);
  $('[data-day-date]').textContent = displayDate(dates[dayIndex]);
  $('[data-day-count]').textContent = `${dayItems.length} hoạt động`;
  const dayTicketTotal = dayItems.reduce((total, item) => total + item.ticket, 0);
  $('#dayTicketTotal').textContent = dayTicketTotal
    ? `Vé tham quan ngày này: ~${formatPlannerMoney(dayTicketTotal)}/người`
    : 'Vé tham quan: chưa gồm vé';
  $$('[data-day-panel]').forEach((panel) => { panel.hidden = true; });
  const activityPanel = $(`[data-day-panel="${Math.min(dayIndex, 2)}"]`);
  if (activityPanel) activityPanel.hidden = dayIndex >= plannerSchedule.length;
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
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: '11.9404',
    longitude: '108.4583',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Asia/Ho_Chi_Minh',
    forecast_days: '16',
  }).toString();
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Dịch vụ thời tiết phản hồi mã ${response.status}.`);
    const data = await response.json();
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
    plannerWeatherError = error instanceof Error ? error.message : 'Lỗi không xác định khi tải thời tiết.';
    renderPlannerWeather(selectedPlannerDay);
  }
}

function updatePlannerCost() {
  const fields = ['estimateGuests', 'estimateRooms', 'estimateFlight', 'estimateHotel', 'estimateTransport', 'estimateMeals', 'estimateTickets'];
  const values = fields.map((id) => {
    const field = $(`#${id}`);
    const value = Number(field.value);
    const valid = field.value.trim() !== '' && Number.isFinite(value) && value >= Number(field.min || 0) && value <= Number(field.max || Number.MAX_SAFE_INTEGER);
    field.setAttribute('aria-invalid', String(!valid));
    return valid ? value : null;
  });
  if (values.some((value) => value === null)) {
    $('#estimateTotal').textContent = '—';
    $('#estimatePerGuest').textContent = '—';
    $('#toolbarCost').textContent = 'Chưa đủ dữ liệu';
    $('#costCalcStatus').textContent = 'Nhập số khách, số phòng và các chi phí hợp lệ để tính dự toán.';
    return;
  }
  const [guests, rooms, flight, hotel, transport, meals, tickets] = values;
  const nights = Math.max(0, dateRange().length - 1);
  const total = (flight + transport + meals + tickets) * guests + hotel * nights * rooms;
  const perGuest = Math.ceil(total / guests);
  $('#plannerGuestLabel').textContent = `${guests} khách`;
  $('#plannerRoomLabel').textContent = `${rooms} phòng`;
  $('#estimateNightLabel').textContent = `${nights} đêm`;
  $('#estimateTotal').textContent = formatPlannerMoney(total);
  $('#estimatePerGuest').textContent = formatPlannerMoney(perGuest);
  $('#toolbarCost').textContent = `~${formatPlannerMoney(perGuest)}/người`;
  $('#costCalcStatus').textContent = '';
}

function appendChatMessage(text, sender = 'bot') {
  const message = document.createElement('div');
  message.className = `chat-bubble ${sender}`;
  message.textContent = text;
  $('#chatMessages').append(message);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  return message;
}

function addConsultLink() {
  const link = document.createElement('a');
  link.className = 'chat-consult-link';
  link.href = 'index.html#contact';
  link.textContent = 'Nhờ VietJourney tư vấn hành trình này →';
  $('#chatMessages').append(link);
}

function plannerCustomerContext() {
  const days = dateRange().length;
  return {
    destination: $('.planner-destination h1').textContent.trim(),
    duration: `${days} ngày ${Math.max(0, days - 1)} đêm`,
    budget: $('#estimatePerGuest').textContent.replace(/[^\d]/g, ''),
    budget_basis: 'per_person',
    party_size: $('#estimateGuests').value,
    travel_date: plannerState.startDate,
    interests: [],
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
        message: query,
        history: chatConversation.slice(-10),
        customer: plannerCustomerContext(),
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
    if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('AI chưa tạo được câu trả lời. Bạn thử lại nhé.');
    chatConversation.push(
      { role: 'user', text: query },
      { role: 'assistant', text: data.reply.trim() },
    );
    chatConversation = chatConversation.slice(-10);
    appendChatMessage(data.reply.trim());
    addConsultLink();
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

$$('[data-planner-day]').forEach((button) => {
  button.addEventListener('click', () => renderPlannerSchedule(Number(button.dataset.plannerDay)));
});
$$('#estimateGuests, #estimateRooms, #estimateFlight, #estimateHotel, #estimateTransport, #estimateMeals, #estimateTickets')
  .forEach((field) => field.addEventListener('input', () => {
    updatePlannerCost();
    $('#plannerGuestLabel').textContent = `${$('#estimateGuests').value || 1} khách`;
    $('#plannerRoomLabel').textContent = `${$('#estimateRooms').value || 1} phòng`;
  }));

$('#shareItinerary').addEventListener('click', async () => {
  const shareUrl = `${window.location.origin}${window.location.pathname}#planner-itinerary`;
  const days = dateRange().length;
  const shareData = { title: 'Lịch trình Đà Lạt · VietJourney', text: `Xem lịch trình Đà Lạt ${days} ngày ${Math.max(0, days - 1)} đêm.`, url: shareUrl };
  const status = $('#shareStatus');
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      status.textContent = 'Đã mở tùy chọn chia sẻ.';
    } else {
      await navigator.clipboard.writeText(shareUrl);
      status.textContent = 'Đã sao chép liên kết lịch trình.';
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    status.textContent = 'Không thể chia sẻ tự động. Hãy sao chép địa chỉ trang để gửi.';
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
  $('#mapSearch').value = category === 'Tất cả' ? 'Đà Lạt' : `${category} ở Đà Lạt`;
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
renderPlannerSchedule(0);
updatePlannerCost();
loadPlannerWeather();
