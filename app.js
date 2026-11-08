import { getVisitorId, getVisitorUtm, recordVisitorEvent, setBehaviorTrackingConsent } from './visitor-tracking.js';
import { showPromotion } from './promo-offers.js';

const interests = ['Tiết kiệm', 'Khám phá', 'Nghỉ dưỡng', 'Ẩm thực', 'Chụp ảnh', 'Thiên nhiên', 'Trekking', 'Gia đình', 'Văn hóa'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
let tours = [];
let savedTours = [];
let showSavedTours = false;
let chatConversation = [];
let chatRequestPending = false;
let behaviorTrackingConsent = false;
let tourViewCount = 0;
let bookingIntent = false;
let bookingStartedTracked = false;
let activeVoucherCode = '';
try {
  activeVoucherCode = sessionStorage.getItem('vietjourney_voucher_code') || '';
} catch (error) {
  console.error('[app] Could not restore promotion code', error);
}
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const SAVED_TOURS_KEY = 'vietjourney_saved_tours';
const TRACKING_CONSENT_KEY = 'vietjourney_behavior_consent';
const FALLBACK_TOUR_IMAGE = 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80';

try {
  const saved = JSON.parse(localStorage.getItem(SAVED_TOURS_KEY) || '[]');
  savedTours = Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
} catch {
  savedTours = [];
}

try {
  behaviorTrackingConsent = localStorage.getItem(TRACKING_CONSENT_KEY) === 'true';
} catch {
  behaviorTrackingConsent = false;
}

const money = (value) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0))} đồng`;

function sanitizeText(value, max = 200) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, max);
}

function getPersistedUtm() {
  try {
    const raw = sessionStorage.getItem('vietjourney_utm');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getCurrentUtm() {
  const params = new URLSearchParams(window.location.search);
  const query = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) query[key] = sanitizeText(value, 128);
  }

  const merged = { ...getPersistedUtm(), ...query };
  if (!merged.utm_source && Object.keys(merged).length) merged.utm_source = 'direct';
  if (!Object.keys(merged).length) merged.utm_source = 'direct';

  try {
    sessionStorage.setItem('vietjourney_utm', JSON.stringify(merged));
  } catch {
    // no-op: storage may be unavailable in a restricted browser context
  }

  return merged;
}

function chips(target) {
  const el = $(target);
  interests.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = item;
    button.onclick = () => button.classList.toggle('active');
    el.append(button);
  });
}

function values(selector) {
  return $$(selector + ' .chip.active').map((item) => item.textContent);
}

function normalizedText(text) {
  return text.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

function setMessage(form, text, status = false) {
  const element = form.querySelector('.form-message');
  element.textContent = text;
  const messageStatus = status === true ? 'success' : status === 'warning' ? 'warning' : 'error';
  element.className = `form-message ${messageStatus}`;
}

function updateFunnelExperience(stage) {
  const stages = {
    COLD: {
      label: 'KHÁM PHÁ ĐIỂM ĐẾN',
      title: 'Đang khám phá? Bắt đầu từ điểm đến bạn thích.',
      copy: 'Khám phá tour theo điểm đến, ngân sách và trải nghiệm phù hợp với bạn.',
      cta: 'Khám phá tour',
      href: '#tours',
    },
    WARM: {
      label: 'TÌM HIỂU HÀNH TRÌNH',
      title: 'Đã thấy hành trình hợp gu?',
      copy: 'Xem lịch trình, giá tham khảo và thông tin tour trước khi chọn ngày đi.',
      cta: 'Xem chi tiết tour',
      href: '#tours',
    },
    HOT: {
      label: 'BƯỚC ĐẶT TOUR',
      title: 'Sẵn sàng lên kế hoạch cho chuyến đi?',
      copy: 'Chọn ngày dự kiến và số khách; Sales sẽ xác nhận giá, ngày khởi hành và tình trạng chỗ.',
      cta: 'Gửi yêu cầu đặt tour',
      href: '#contact',
    },
  };
  const selected = stages[stage] || stages.COLD;
  $('#journeyStage').textContent = selected.label;
  $('#journeyNudgeTitle').textContent = selected.title;
  $('#journeyNudgeCopy').textContent = selected.copy;
  $('#journeyNudgeCta').firstChild.textContent = `${selected.cta} `;
  $('#journeyNudgeCta').href = selected.href;
  $('#journeyNudge').dataset.stage = stage in stages ? stage : 'COLD';
}

function markBookingStarted() {
  bookingIntent = true;
  updateFunnelExperience('HOT');
  if (!behaviorTrackingConsent || bookingStartedTracked) return;
  bookingStartedTracked = true;
  recordVisitorEvent('booking_started');
}

function duration(item) {
  const match = Number(String(item.duration || '').match(/\d+/)?.[0]);
  return match || 0;
}

function card(item) {
  const element = document.createElement('article');
  element.className = 'tour-card';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'tour-save';
  save.setAttribute('aria-pressed', savedTours.includes(String(item.id)));
  save.setAttribute('aria-label', savedTours.includes(String(item.id)) ? `Bỏ lưu ${item.name}` : `Lưu ${item.name}`);
  save.textContent = savedTours.includes(String(item.id)) ? '♥' : '♡';
  save.onclick = () => toggleSavedTour(item);
  element.append(save);

  const image = document.createElement('img');
  image.loading = 'lazy';
  image.alt = item.name || 'Tour VietJourney';
  image.src = item.image || FALLBACK_TOUR_IMAGE;
  image.onerror = () => {
    image.onerror = null;
    image.src = FALLBACK_TOUR_IMAGE;
  };
  element.append(image);

  const copy = document.createElement('div');
  copy.className = 'tour-copy';
  copy.innerHTML = `
    <div class="tour-meta">${sanitizeText(item.destination)} · ${sanitizeText(String(item.duration || ''))}</div>
    <h3>${sanitizeText(item.name)}</h3>
    <div class="price">Giá tham khảo: ${money(item.price_per_person)}<small>/ người</small></div>
    <div>${(item.experience_type || item.highlights || []).slice(0, 3).map((value) => `<span class="tag">${sanitizeText(value)}</span>`).join('')}</div>
  `;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const detail = document.createElement('button');
  detail.textContent = 'Khám phá tour';
  detail.onclick = () => showDetails(item);

  const choose = document.createElement('button');
  choose.textContent = 'Đặt tour';
  choose.onclick = () => selectTour(item);

  actions.append(detail, choose);
  copy.append(actions);
  element.append(copy);
  return element;
}

function emptyState(text) {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

function renderSkeleton() {
  const grid = $('#tourGrid');
  grid.replaceChildren(
    ...Array.from({ length: 3 }, () => {
      const skeleton = document.createElement('article');
      skeleton.className = 'tour-card skeleton-card';
      skeleton.innerHTML = `
        <div class="skeleton skeleton-image"></div>
        <div class="tour-copy">
          <i class="skeleton skeleton-line short"></i>
          <i class="skeleton skeleton-line"></i>
          <i class="skeleton skeleton-line medium"></i>
          <i class="skeleton skeleton-button"></i>
        </div>
      `;
      return skeleton;
    })
  );
}

function renderTours() {
  const destination = $('#destinationFilter').value;
  const type = $('#typeFilter').value;
  const durationFilter = $('#durationFilter').value;
  const budgetFilter = $('#budgetFilter').value;
  const query = normalizedText($('#tourSearch').value.trim()).split(/\s+/).filter(Boolean);

  const filtered = tours.filter((tour) => {
    const length = duration(tour);
    const price = Number(tour.price_per_person);
    const searchable = normalizedText([
      tour.name,
      tour.destination,
      ...(tour.experience_type || []),
      ...(tour.highlights || []),
    ].join(' '));

    return (
      (!query.length || query.every((term) => searchable.includes(term))) &&
      (!showSavedTours || savedTours.includes(String(tour.id))) &&
      (!destination || tour.destination === destination) &&
      (!type || (tour.experience_type || []).includes(type)) &&
      (!durationFilter ||
        (durationFilter === 'short' ? length <= 3 : durationFilter === 'medium' ? length >= 4 && length <= 6 : length >= 7)) &&
      matchesBudget(price, budgetFilter)
    );
  });

  const grid = $('#tourGrid');
  $('#tourCount').textContent = showSavedTours
    ? `${filtered.length} chuyến đi bạn đã lưu`
    : `${filtered.length} tour tham khảo; giá và lịch khởi hành cần xác nhận`;
  $('#savedCount').textContent = savedTours.length;
  grid.replaceChildren(
    ...(filtered.length
      ? filtered.map((tour) => card(tour))
      : [emptyState('Chưa có hành trình phù hợp với bộ lọc này. Hãy thử lựa chọn khác hoặc hỏi trợ lý chuyến đi.')])
  );
}

function matchesBudget(price, range) {
  switch (range) {
    case 'under2': return price < 2_000_000;
    case '2to5': return price >= 2_000_000 && price <= 5_000_000;
    case '5to8': return price > 5_000_000 && price <= 8_000_000;
    case '8to12': return price > 8_000_000 && price <= 12_000_000;
    case 'over12': return price > 12_000_000;
    default: return true;
  }
}

function populateFilters() {
  const destinations = [...new Set(tours.map((tour) => tour.destination).filter(Boolean))];
  const types = [...new Set(tours.flatMap((tour) => tour.experience_type || []))];

  for (const [selector, valuesList] of [['#destinationFilter', destinations], ['#typeFilter', types]]) {
    const select = $(selector);
    valuesList.forEach((value) => {
      const option = document.createElement('option');
      option.value = option.textContent = value;
      select.append(option);
    });
  }

  const destinationSearch = $('#destinationQuery');
  destinations.forEach((value) => {
    const option = document.createElement('option');
    option.value = option.textContent = value;
    destinationSearch.append(option);
  });

  const shortcuts = $('#experienceShortcuts');
  const all = document.createElement('button');
  all.type = 'button';
  all.textContent = 'Tất cả';
  all.setAttribute('aria-pressed', 'true');
  all.onclick = () => setExperienceFilter('');
  shortcuts.append(all);
  types.forEach((type) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = type;
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => setExperienceFilter(type);
    shortcuts.append(button);
  });

  $$('.filters select').forEach((select) => {
    select.onchange = () => {
      if (select.id === 'typeFilter') {
        const selected = select.value || 'Tất cả';
        $$('#experienceShortcuts button').forEach((button) => {
          button.setAttribute('aria-pressed', String(button.textContent === selected));
        });
      }
      renderTours();
    };
  });
}

function setExperienceFilter(type) {
  $('#typeFilter').value = type;
  $$('#experienceShortcuts button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.textContent === (type || 'Tất cả')));
  });
  renderTours();
}

function toggleSavedTour(tour) {
  const id = String(tour.id);
  savedTours = savedTours.includes(id)
    ? savedTours.filter((savedId) => savedId !== id)
    : [...savedTours, id];
  try {
    localStorage.setItem(SAVED_TOURS_KEY, JSON.stringify(savedTours));
  } catch {
    // Saving remains available for this page view when browser storage is disabled.
  }
  if (savedTours.includes(id)) {
    updateFunnelExperience('WARM');
    recordVisitorEvent('compare_or_save');
  }
  renderTours();
}

function configureBookingForm() {
  const tripDetails = $('#tripDetails');
  tripDetails.open = true;
  const travelDateInput = $('#travelDateField').querySelector('input');
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  travelDateInput.min = today.toISOString().slice(0, 10);
}

function selectTour(tour) {
  const form = $('#leadForm');
  $('#tripDetails').open = true;
  form.elements.selected_tour_id.value = tour.id;
  form.elements.selected_tour_name.value = tour.name;
  $('#tourName').value = tour.name;
  markBookingStarted();
  setMessage(form, `Đang đặt: ${tour.name}. Giá hiển thị là giá tham khảo; ngày đi và chỗ còn sẽ được Sales xác nhận.`, 'warning');
  location.hash = 'contact';
}

function showDetails(tour) {
  if (behaviorTrackingConsent) tourViewCount = Math.min(tourViewCount + 1, 3);
  updateFunnelExperience('WARM');
  recordVisitorEvent('tour_detail_view');
  recordVisitorEvent('pricing_view');
  const dialog = $('#tourDialog');
  const dialogImage = $('#dialogImage');
  dialogImage.onerror = () => { dialogImage.onerror = null; dialogImage.src = FALLBACK_TOUR_IMAGE; };
  dialogImage.src = tour.image || FALLBACK_TOUR_IMAGE;
  $('#dialogImage').alt = tour.name || 'Tour VietJourney';
  $('#dialogMeta').textContent = `${tour.destination || 'Việt Nam'} · ${tour.duration || 'Linh hoạt'}`;
  $('#dialogTitle').textContent = tour.name;
  $('#dialogPrice').textContent = `Giá tham khảo: ${money(tour.price_per_person)} / người`;
  $('#dialogOverview').textContent = tour.overview || 'Liên hệ VietJourney để được giới thiệu chi tiết hành trình.';
  const departures = Array.isArray(tour.departures) ? tour.departures : [];
  $('#dialogDeparture').textContent = departures.length
    ? `Lịch khởi hành tham khảo: ${departures.map((item) => typeof item === 'string' ? item : [item.date, item.status].filter(Boolean).join(' – ')).filter(Boolean).join(', ')}. Vui lòng xác nhận ngày và tình trạng chỗ với VietJourney.`
    : 'Chưa có dữ liệu lịch khởi hành; vui lòng xác nhận với VietJourney.';

  const itinerary = Array.isArray(tour.itinerary) ? tour.itinerary : [];
  $('#dialogItinerary').replaceChildren(...(itinerary.length ? itinerary : [{
    day: 'Lịch trình',
    title: 'Lịch trình tham khảo',
    activities: ['Đội ngũ VietJourney sẽ xác nhận lịch trình phù hợp trước khi bạn đặt tour.'],
  }]).map((day) => {
    const article = document.createElement('article');
    article.className = 'dialog-day';
    const label = document.createElement('p');
    label.className = 'eyebrow';
    label.textContent = day.day || '';
    const title = document.createElement('h4');
    title.textContent = day.title || '';
    const list = document.createElement('ul');
    (Array.isArray(day.activities) ? day.activities : []).forEach((activity) => {
      const item = document.createElement('li');
      item.textContent = activity;
      list.append(item);
    });
    article.append(label, title, list);
    return article;
  }));

  for (const [selector, items, fallback] of [
    ['#dialogHighlights', tour.highlights || [], 'Liên hệ để tìm hiểu thêm'],
    ['#dialogSuitableFor', tour.suitable_for || [], 'Chưa có dữ liệu; cần xác nhận với VietJourney'],
    ['#dialogServices', tour.included_services || [], 'Chưa có dữ liệu; cần xác nhận với VietJourney'],
    ['#dialogExcludedServices', tour.excluded_services || [], 'Chưa có dữ liệu; cần xác nhận với VietJourney'],
  ]) {
    const list = $(selector);
    list.replaceChildren(...(items.length ? items : [fallback]).map((value) => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
  }

  $('#dialogChoose').textContent = 'Đặt tour này';
  $('#dialogChoose').onclick = () => {
    dialog.close();
    selectTour(tour);
  };
  dialog.showModal();
}

async function loadTours() {
  renderSkeleton();

  try {
    const response = await fetch('data/tours.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('failed');

    const data = await response.json();
    tours = Array.isArray(data) ? data.filter((tour) => tour.tour_status === 'active') : [];
    populateFilters();
    renderTours();
  } catch {
    const grid = $('#tourGrid');
    grid.replaceChildren(emptyState('Không thể tải danh sách tour lúc này. Vui lòng tải lại trang hoặc thử lại sau.'));
  }
}

function fieldData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

const behaviorTrackingField = $('#leadForm').elements.behavior_tracking;
behaviorTrackingField.checked = behaviorTrackingConsent;
behaviorTrackingField.addEventListener('change', () => {
  behaviorTrackingConsent = behaviorTrackingField.checked;
  setBehaviorTrackingConsent(behaviorTrackingConsent);
  tourViewCount = 0;
  if (behaviorTrackingConsent && bookingIntent) markBookingStarted();
});

$('#destinationSearch').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#destinationFilter').value = $('#destinationQuery').value;
  $('#budgetFilter').value = $('#budgetQuery').value;
  $('#tourSearch').value = '';
  showSavedTours = false;
  $('#savedToggle').setAttribute('aria-pressed', 'false');
  renderTours();
  if ($('#destinationQuery').value || $('#budgetQuery').value) updateFunnelExperience('WARM');
  $('#tours').scrollIntoView({ behavior: 'smooth' });
});

document.addEventListener('click', (event) => {
  if (event.target.closest('a[href="#contact"]')) {
    updateFunnelExperience('HOT');
    recordVisitorEvent('contact_click');
  }
});

$('#leadForm').addEventListener('focusin', markBookingStarted, { once: true });

$('#budgetFilter').addEventListener('change', () => recordVisitorEvent('pricing_view'));
function continueWithPromotion(voucherCode) {
  activeVoucherCode = voucherCode;
  try {
    sessionStorage.setItem('vietjourney_voucher_code', voucherCode);
  } catch (error) {
    console.error('[app] Could not save promotion code', error);
  }
  $('#tours').scrollIntoView({ behavior: 'smooth' });
}

$('#tourSearch').addEventListener('input', () => {
  showSavedTours = false;
  $('#savedToggle').setAttribute('aria-pressed', 'false');
  renderTours();
});

$('#savedToggle').addEventListener('click', (event) => {
  showSavedTours = !showSavedTours;
  event.currentTarget.setAttribute('aria-pressed', String(showSavedTours));
  renderTours();
});

function appendChatMessage(text, sender = 'bot') {
  const message = document.createElement('div');
  message.className = `chat-bubble ${sender}`;
  message.textContent = text;
  $('#chatMessages').append(message);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  return message;
}

function chatCustomerContext() {
  const form = $('#leadForm');
  const fieldValue = (name) => {
    const field = form.elements.namedItem(name);
    return sanitizeText(field?.value || '', 100);
  };
  const selectedTour = tours.find((tour) =>
    String(tour.id) === String(form.elements.selected_tour_id.value));

  return {
    destination: selectedTour?.destination || '',
    duration: duration(selectedTour || {}),
    budget: selectedTour?.price_per_person || '',
    budget_basis: selectedTour ? 'per_person' : '',
    party_size: fieldValue('party_size'),
    travel_date: fieldValue('travel_date'),
    interests: values('#leadInterests'),
  };
}

function addChatLeadAction() {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'chat-consult-link';
  action.textContent = 'Xem tour để đặt →';
  action.addEventListener('click', () => {
    location.hash = 'tours';
    $('#tours').scrollIntoView({ behavior: 'smooth' });
  });
  $('#chatMessages').append(action);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}

async function sendChatMessage(query) {
  if (chatRequestPending) return;

  appendChatMessage(query, 'user');
  const loadingMessage = document.createElement('div');
  loadingMessage.className = 'chat-bubble bot';
  loadingMessage.textContent = 'Đang nghĩ câu trả lời…';
  loadingMessage.setAttribute('aria-label', 'Đang chờ trợ lý AI');
  $('#chatMessages').append(loadingMessage);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;

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
        customer: chatCustomerContext(),
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('AI trả về phản hồi không hợp lệ. Bạn thử lại nhé.');
    }

    if (!data || typeof data !== 'object') {
      throw new Error('AI trả về phản hồi không hợp lệ. Bạn thử lại nhé.');
    }

    if (!response.ok) {
      throw new Error(data.error || 'AI chưa thể trả lời lúc này. Bạn thử lại nhé.');
    }

    if (typeof data.reply !== 'string' || !data.reply.trim()) {
      throw new Error('AI chưa tạo được câu trả lời. Bạn thử lại nhé.');
    }

    chatConversation.push(
      { role: 'user', text: query },
      { role: 'assistant', text: data.reply.trim() },
    );
    chatConversation = chatConversation.slice(-10);
    appendChatMessage(data.reply.trim());
    addChatLeadAction();
    const visitor = await recordVisitorEvent('ai_used');
    updateFunnelExperience('WARM');
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

$('#leadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const payload = fieldData(form);
  payload.visitor_id = getVisitorId();
  payload.booking_request = true;
  payload.consent_to_contact = form.elements.consent_to_contact.checked;
  payload.interests = values('#leadInterests');
  if (!payload.selected_tour_id) {
    setMessage(form, 'Vui lòng chọn tour trước khi gửi yêu cầu đặt.', 'warning');
    $('#tours').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  markBookingStarted();

  const email = String(payload.email || '').trim();
  const phone = String(payload.phone || '').trim();
  const contact = String(payload.contact || '').trim();
  payload.email = email;
  payload.phone = phone;
  payload.zalo_phone = String(payload.zalo_phone || '').trim();
  payload.contact = contact || phone || email || '';

  const utm = { ...getCurrentUtm(), ...getVisitorUtm() };
  Object.assign(payload, utm);
  payload.source = payload.source || utm.utm_source || 'website';
  payload.engagement = {
    tour_views: behaviorTrackingConsent ? tourViewCount : 0,
  };
  payload.voucher_status = payload.voucher_status || 'PENDING';
  payload.voucher_channel = payload.voucher_channel || 'email';
  payload.voucher_code = activeVoucherCode;

  const submitButton = $('#leadSubmit');
  submitButton.disabled = true;
  setMessage(form, 'Đang gửi yêu cầu…', true);

  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không thể gửi yêu cầu. Vui lòng thử lại.');

    const emailMessage = data.notification_status === 'SENT'
      ? ' Sales đã nhận yêu cầu; email xác nhận cho bạn sẽ được gửi sau khi Sales chốt booking.'
      : data.notification_status === 'FAILED'
        ? ' Yêu cầu đã lưu nhưng chưa gửi được thông báo cho Sales; hệ thống sẽ thử lại.'
        : ' Yêu cầu đã lưu; đang chờ xác nhận thông báo tới Sales.';
    setMessage(
      form,
      `Đã ghi nhận yêu cầu đặt tour. Ngày đi và tình trạng chỗ vẫn cần Sales xác nhận.${emailMessage} Mã yêu cầu: ${data.lead_id}`,
      data.notification_status === 'SENT' ? true : 'warning',
    );
    updateFunnelExperience('HOT');
    form.reset();
    activeVoucherCode = '';
    try {
      sessionStorage.removeItem('vietjourney_voucher_code');
    } catch (error) {
      console.error('[app] Could not clear promotion code', error);
    }
    behaviorTrackingField.checked = behaviorTrackingConsent;
    $('#tourName').value = '';
  } catch (error) {
    setMessage(form, error.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.');
  } finally {
    submitButton.disabled = false;
  }
});

$('.menu').onclick = (event) => {
  const nav = $('nav');
  const open = nav.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', open);
};

$$('nav a').forEach((link) => {
  link.onclick = () => {
    $('nav').classList.remove('open');
    $('.menu').setAttribute('aria-expanded', 'false');
  };
});

chips('#leadInterests');
configureBookingForm();
getCurrentUtm();
loadTours();
updateFunnelExperience('COLD');
recordVisitorEvent('visit').then((visitor) => {
  if (behaviorTrackingConsent && ['COLD', 'WARM', 'HOT'].includes(visitor?.temperature)) {
    updateFunnelExperience(visitor.temperature);
  }
});
