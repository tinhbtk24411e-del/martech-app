const interests = ['Tiết kiệm', 'Khám phá', 'Nghỉ dưỡng', 'Ẩm thực', 'Chụp ảnh', 'Thiên nhiên', 'Trekking', 'Gia đình', 'Văn hóa'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
let tours = [];
let savedTours = [];
let showSavedTours = false;
let chatConversation = [];
let chatRequestPending = false;
let behaviorTrackingConsent = false;
let returnVisit = false;
let tourViewCount = 0;
let bookingMode = false;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const SAVED_TOURS_KEY = 'vietjourney_saved_tours';
const TRACKING_CONSENT_KEY = 'vietjourney_behavior_consent';
const VISITOR_SEEN_KEY = 'vietjourney_seen';
const FALLBACK_TOUR_IMAGE = 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80';

try {
  const saved = JSON.parse(localStorage.getItem(SAVED_TOURS_KEY) || '[]');
  savedTours = Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
} catch {
  savedTours = [];
}

try {
  behaviorTrackingConsent = localStorage.getItem(TRACKING_CONSENT_KEY) === 'true';
  returnVisit = behaviorTrackingConsent && localStorage.getItem(VISITOR_SEEN_KEY) === 'true';
  if (behaviorTrackingConsent) localStorage.setItem(VISITOR_SEEN_KEY, 'true');
} catch {
  behaviorTrackingConsent = false;
  returnVisit = false;
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

function setMessage(form, text, status = false) {
  const element = form.querySelector('.form-message');
  element.textContent = text;
  const messageStatus = status === true ? 'success' : status === 'warning' ? 'warning' : 'error';
  element.className = `form-message ${messageStatus}`;
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
  choose.onclick = () => selectTour(item, true);

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
      : [emptyState('Chưa có hành trình phù hợp với bộ lọc này. Hãy thử lựa chọn khác hoặc gửi yêu cầu để được tư vấn.')])
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
  renderTours();
}

function setBookingMode(enabled) {
  bookingMode = enabled;
  const form = $('#leadForm');
  $('#contactTitle').innerHTML = enabled
    ? 'Gửi thông tin<br>đặt tour của bạn.'
    : 'Kể tụi mình nghe<br>bạn đang mong chuyến đi thế nào.';
  $('#contactDescription').textContent = enabled
    ? 'Tụi mình sẽ gửi email xác nhận đã nhận yêu cầu và liên hệ để xác nhận lịch, chỗ trước khi booking có hiệu lực.'
    : 'Để lại vài thông tin cơ bản thôi. Đội ngũ VietJourney sẽ cùng bạn tìm phương án phù hợp.';
  $('#contactReassurance').innerHTML = enabled
    ? '<strong>Giá và chỗ còn cần xác nhận.</strong><br>Email xác nhận chỉ xác nhận đã nhận yêu cầu đặt tour.'
    : '<strong>Không cần chốt tour ngay.</strong><br>Cứ hỏi trước, bạn quyết định sau nhé.';
  $('#contactHint').textContent = enabled
    ? 'Email bắt buộc để gửi xác nhận; số điện thoại giúp Sales liên hệ.'
    : 'Bạn chỉ cần cung cấp email hoặc số điện thoại.';
  $('#contactConsentText').textContent = enabled
    ? 'Tôi đồng ý để VietJourney xử lý yêu cầu đặt tour và liên hệ xác nhận.'
    : 'Tôi đồng ý để VietJourney liên hệ tư vấn về yêu cầu này.';
  $('#leadSubmit').textContent = enabled ? 'Gửi yêu cầu đặt tour' : 'Gửi yêu cầu tư vấn';
  $('#switchToInquiry').hidden = !enabled;
  $('#emailField').querySelector('input').required = enabled;
  const travelDateInput = $('#travelDateField').querySelector('input');
  travelDateInput.required = enabled;
  if (enabled) {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    travelDateInput.min = today.toISOString().slice(0, 10);
  } else {
    travelDateInput.removeAttribute('min');
  }
  $('#destinationField').hidden = enabled;
  $('#durationField').hidden = enabled;
  $('#budgetField').hidden = enabled;
  $('#interestsField').hidden = enabled;
  $('#trackingConsent').hidden = enabled;
  if (!enabled) {
    form.elements.email.setCustomValidity('');
    form.elements.phone.setCustomValidity('');
  }
}

function selectTour(tour, booking = false) {
  const form = $('#leadForm');
  form.elements.selected_tour_id.value = tour.id;
  form.elements.selected_tour_name.value = tour.name;
  $('#tourName').value = tour.name;
  form.elements.destination.value = tour.destination || '';
  const length = duration(tour);
  if (length) form.elements.duration.value = length;
  if (booking) {
    form.elements.budget.value = String(Number(tour.price_per_person) || 0);
    setBookingMode(true);
    setMessage(form, `Đang đặt: ${tour.name}. Giá hiển thị là giá tham khảo; ngày đi và chỗ còn sẽ được Sales xác nhận.`, 'warning');
  } else {
    setBookingMode(false);
    setMessage(form, `Đã chọn “${tour.name}”. Hãy nhập ngân sách dự kiến của bạn để được tư vấn.`, true);
  }
  location.hash = 'contact';
}

function showDetails(tour) {
  if (behaviorTrackingConsent) tourViewCount = Math.min(tourViewCount + 1, 3);
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
    title: 'Tư vấn theo nhu cầu của bạn',
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
    selectTour(tour, true);
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

function updateBudgetPreview() {
  const value = Number($('#leadForm').elements.budget.value);
  $('#budgetPreview').textContent = Number.isFinite(value) && value >= 0
    ? `Ngân sách của bạn: ${money(value)}/người.`
    : 'Ví dụ: 2,000,000 đồng/người.';
}

$('#leadForm').elements.budget.addEventListener('input', updateBudgetPreview);

const behaviorTrackingField = $('#leadForm').elements.behavior_tracking;
behaviorTrackingField.checked = behaviorTrackingConsent;
behaviorTrackingField.addEventListener('change', () => {
  behaviorTrackingConsent = behaviorTrackingField.checked;
  returnVisit = false;
  tourViewCount = 0;

  try {
    if (behaviorTrackingConsent) {
      localStorage.setItem(TRACKING_CONSENT_KEY, 'true');
      localStorage.setItem(VISITOR_SEEN_KEY, 'true');
    } else {
      localStorage.removeItem(TRACKING_CONSENT_KEY);
      localStorage.removeItem(VISITOR_SEEN_KEY);
    }
  } catch {
    behaviorTrackingConsent = behaviorTrackingField.checked;
  }
});

const leadEmail = $('#leadForm').elements.email;
const leadPhone = $('#leadForm').elements.phone;
const validateLeadContact = () => {
  const missingContact = !leadEmail.value.trim() && !leadPhone.value.trim();
  leadEmail.setCustomValidity(missingContact ? 'Vui lòng nhập email hoặc số điện thoại.' : '');
  leadPhone.setCustomValidity(missingContact ? 'Vui lòng nhập email hoặc số điện thoại.' : '');
};
leadEmail.addEventListener('input', validateLeadContact);
leadPhone.addEventListener('input', validateLeadContact);

$('#destinationSearch').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#destinationFilter').value = $('#destinationQuery').value;
  $('#budgetFilter').value = $('#budgetQuery').value;
  $('#tourSearch').value = '';
  showSavedTours = false;
  $('#savedToggle').setAttribute('aria-pressed', 'false');
  renderTours();
  $('#tours').scrollIntoView({ behavior: 'smooth' });
});

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

function normalizedText(text) {
  return text.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

function chatCustomerContext() {
  const form = $('#leadForm');
  const fieldValue = (name) => {
    const field = form.elements.namedItem(name);
    return sanitizeText(field?.value || '', 100);
  };

  return {
    destination: fieldValue('destination'),
    duration: fieldValue('duration'),
    budget: fieldValue('budget'),
    budget_basis: fieldValue('budget') ? 'per_person' : '',
    party_size: fieldValue('party_size'),
    travel_date: fieldValue('travel_date'),
    interests: values('#leadInterests'),
  };
}

function addChatLeadAction(question, answer) {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'chat-consult-link';
  action.textContent = 'Yêu cầu tư vấn hành trình này →';
  action.addEventListener('click', () => prefillLeadFromChat(question, answer));
  $('#chatMessages').append(action);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}

function prefillLeadFromChat(question, answer) {
  const form = $('#leadForm');
  setBookingMode(false);
  const recentMessages = chatConversation
    .filter((item) => item.role === 'user')
    .slice(-5)
    .map((item) => item.text);
  const destinationMessages = [...recentMessages].reverse();
  const normalizedMessages = destinationMessages.map(normalizedText);
  let matchedTour;
  for (const text of normalizedMessages) {
    matchedTour = tours.find((tour) => text.includes(normalizedText(tour.name))) ||
      tours.find((tour) => text.includes(normalizedText(tour.destination)));
    if (matchedTour) break;
  }
  const setIfEmpty = (fieldName, value) => {
    const field = form.elements.namedItem(fieldName);
    if (field && !field.value && value) field.value = value;
  };

  if (matchedTour) {
    setIfEmpty('destination', matchedTour.destination);
    if (normalizedMessages.some((text) => text.includes(normalizedText(matchedTour.name)))) {
      form.elements.selected_tour_id.value = matchedTour.id;
      form.elements.selected_tour_name.value = matchedTour.name;
      $('#tourName').value = matchedTour.name;
    }
  }

  for (const text of destinationMessages) {
    const normalized = normalizedText(text);
    const durationMatch = normalized.match(/\b(\d{1,2})\s*ngay\b/i);
    const partyMatch = normalized.match(/\b(\d{1,2})\s*(?:nguoi|khach)\b/i);
    setIfEmpty('duration', durationMatch?.[1]);
    setIfEmpty('party_size', partyMatch?.[1]);

    const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (dateMatch && !form.elements.travel_date.value) {
      const date = dateMatch[1].includes('/')
        ? dateMatch[1].split('/').reverse().map((part, index) => index === 0 ? part : part.padStart(2, '0')).join('-')
        : dateMatch[1];
      setIfEmpty('travel_date', date);
    }

    const perPersonBudget = normalized.match(/(\d+(?:[.,]\d+)*)\s*(trieu|tr|m|vnd|dong|d)\s*(?:\/\s*(?:nguoi|khach)|moi\s*(?:nguoi|khach))/i);
    if (perPersonBudget && !form.elements.budget.value) {
      const rawAmount = perPersonBudget[1];
      const unit = perPersonBudget[2];
      const amount = /^(triệu|tr|m)$/.test(unit)
        ? Number(rawAmount.replace(',', '.')) * 1_000_000
        : Number(rawAmount.replace(/[.,]/g, ''));
      if (Number.isFinite(amount) && amount > 0) {
        setIfEmpty('budget', String(Math.round(amount)));
        updateBudgetPreview();
      }
    }

    for (const interest of interests) {
      if (normalized.includes(normalizedText(interest))) {
        const chip = [...$('#leadInterests').querySelectorAll('.chip')]
          .find((item) => item.textContent === interest);
        chip?.classList.add('active');
      }
    }
  }

  if (matchedTour) {
    const days = Number(String(matchedTour.duration).match(/\d+/)?.[0]);
    setIfEmpty('duration', String(days || ''));
  }

  const transcript = [
    'Nội dung tư vấn AI (tham khảo, cần VietJourney xác nhận):',
    `Khách hỏi: ${sanitizeText(question, 180)}`,
    `Đề xuất AI: ${sanitizeText(answer, 600)}`,
  ].join('\n');
  const note = form.elements.namedItem('note');
  const existingNote = note.value.trim();
  note.value = [
    existingNote ? sanitizeText(existingNote, 150) : '',
    transcript,
  ].filter(Boolean).join('\n\n').slice(0, 1000);
  setMessage(form, 'Đã điền nội dung tư vấn vào form. Bạn kiểm tra thông tin, bổ sung liên hệ và đồng ý trước khi gửi nhé.', 'warning');
  location.hash = 'contact';
  $('#contact').scrollIntoView({ behavior: 'smooth' });
  const missingField = ['name', 'email', 'phone', 'destination', 'duration', 'budget']
    .map((name) => form.elements.namedItem(name))
    .find((field) => field && !field.value);
  (missingField || form.elements.namedItem('name')).focus({ preventScroll: true });
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
    addChatLeadAction(query, data.reply.trim());
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
  validateLeadContact();
  if (!form.reportValidity()) return;
  const payload = fieldData(form);
  payload.booking_request = bookingMode;
  payload.consent_to_contact = form.elements.consent_to_contact.checked;
  payload.interests = values('#leadInterests');

  const email = String(payload.email || '').trim();
  const phone = String(payload.phone || '').trim();
  const contact = String(payload.contact || '').trim();
  payload.email = email;
  payload.phone = phone;
  payload.zalo_phone = String(payload.zalo_phone || '').trim();
  payload.contact = contact || phone || email || '';

  const utm = getCurrentUtm();
  Object.assign(payload, utm);
  payload.source = payload.source || utm.utm_source || 'website';
  payload.engagement = {
    tour_views: behaviorTrackingConsent ? tourViewCount : 0,
    return_visit: behaviorTrackingConsent && returnVisit,
  };
  payload.voucher_status = payload.voucher_status || 'PENDING';
  payload.voucher_channel = payload.voucher_channel || 'email';

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

    if (bookingMode) {
      const emailMessage = data.notification_status === 'SENT'
        ? ` Email xác nhận đã gửi đến ${email}; Sales cũng đã nhận thông tin.`
        : ' Yêu cầu đã lưu nhưng email chưa được xác nhận gửi; hệ thống sẽ thử thông báo lại.';
      setMessage(
        form,
        `Đã ghi nhận yêu cầu đặt tour. Ngày đi và tình trạng chỗ vẫn cần Sales xác nhận.${emailMessage} Mã yêu cầu: ${data.lead_id}`,
        data.notification_status === 'SENT' ? true : 'warning',
      );
    } else {
      const notificationMessage = data.notification_status === 'SENT'
        ? ' Thông báo cho đội ngũ đã được gửi.'
        : data.notification_status === 'FAILED'
          ? ' n8n báo thông báo chưa gửi được; đội ngũ sẽ kiểm tra lại.'
          : ' Yêu cầu đã lưu; hệ thống chưa nhận được xác nhận thông báo từ n8n.';
      const messageStatus = data.notification_status === 'SENT'
        ? true
        : data.notification_status === 'PENDING' ? 'warning' : false;
      setMessage(form, `Yêu cầu đã được ghi nhận.${notificationMessage} Mã Lead ID: ${data.lead_id}`, messageStatus);
    }
    form.reset();
    behaviorTrackingField.checked = behaviorTrackingConsent;
    $('#tourName').value = '';
    setBookingMode(false);
    updateBudgetPreview();
  } catch (error) {
    setMessage(form, error.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.');
  } finally {
    submitButton.disabled = false;
  }
});

$('#switchToInquiry').addEventListener('click', () => {
  setBookingMode(false);
  setMessage($('#leadForm'), 'Bạn đang gửi yêu cầu tư vấn, chưa phải yêu cầu đặt tour.', 'warning');
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
getCurrentUtm();
loadTours();
