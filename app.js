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
  choose.textContent = 'Tư vấn tour này';
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

function selectTour(tour) {
  const form = $('#leadForm');
  form.elements.selected_tour_id.value = tour.id;
  form.elements.selected_tour_name.value = tour.name;
  $('#tourName').value = tour.name;
  form.elements.destination.value = tour.destination || '';
  const length = duration(tour);
  if (length) form.elements.duration.value = length;
  location.hash = 'contact';
  setMessage(form, `Đã chọn “${tour.name}”. Hãy nhập ngân sách dự kiến của bạn để được tư vấn.`, true);
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

$('#leadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  validateLeadContact();
  if (!form.reportValidity()) return;
  const payload = fieldData(form);
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

  const submitButton = form.querySelector('button');
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

    const notificationMessage = data.notification_status === 'SENT'
      ? ' Thông báo cho đội ngũ đã được gửi.'
      : data.notification_status === 'FAILED'
        ? ' n8n báo thông báo chưa gửi được; đội ngũ sẽ kiểm tra lại.'
        : ' Yêu cầu đã lưu; hệ thống chưa nhận được xác nhận thông báo từ n8n.';
    const messageStatus = data.notification_status === 'SENT'
      ? true
      : data.notification_status === 'PENDING' ? 'warning' : false;
    setMessage(form, `Yêu cầu đã được ghi nhận.${notificationMessage} Mã Lead ID: ${data.lead_id}`, messageStatus);
    form.reset();
    behaviorTrackingField.checked = behaviorTrackingConsent;
    $('#tourName').value = '';
    updateBudgetPreview();
  } catch (error) {
    setMessage(form, error.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.');
  } finally {
    submitButton.disabled = false;
  }
});

const plannerDates = ['07/11/2026', '08/11/2026', '09/11/2026'];
const plannerIsoDates = ['2026-11-07', '2026-11-08', '2026-11-09'];
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

function formatPlannerMoney(amount) {
  return `${currencyFormatter.format(amount)}đ`;
}

function renderPlannerSchedule(dayIndex) {
  selectedPlannerDay = dayIndex;
  const rows = plannerSchedule[dayIndex].map((item) => {
    const row = document.createElement('tr');
    [item.time, `${item.activity} · ${item.location}`, item.duration, item.ticket ? `~${formatPlannerMoney(item.ticket)}` : 'Chưa gồm vé'].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  });
  $('#plannerScheduleRows').replaceChildren(...rows);
  $('[data-day-date]').textContent = plannerDates[dayIndex];
  $('[data-day-count]').textContent = `${plannerSchedule[dayIndex].length} hoạt động`;
  const dayTicketTotal = plannerSchedule[dayIndex].reduce((total, item) => total + item.ticket, 0);
  $('#dayTicketTotal').textContent = dayTicketTotal
    ? `Vé tham quan ngày này: ~${formatPlannerMoney(dayTicketTotal)}/người`
    : 'Vé tham quan: chưa gồm vé';
  $$('[data-day-panel]').forEach((panel) => {
    panel.hidden = Number(panel.dataset.dayPanel) !== dayIndex;
  });
  $$('[data-planner-day]').forEach((button) => {
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
  const day = plannerWeather.find((item) => item.date === plannerIsoDates[dayIndex]);
  if (!day) {
    status.textContent = 'Đang tải dự báo thời tiết…';
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
    })).filter((item) => plannerIsoDates.includes(item.date));
    if (!plannerWeather.length) throw new Error('Dịch vụ chưa có dự báo cho ngày đã chọn.');
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
  const total = (flight + transport + meals + tickets) * guests + hotel * 2 * rooms;
  const perGuest = Math.ceil(total / guests);
  $('#estimateTotal').textContent = formatPlannerMoney(total);
  $('#estimatePerGuest').textContent = formatPlannerMoney(perGuest);
  $('#toolbarCost').textContent = `~${formatPlannerMoney(perGuest)}/người`;
  $('#costCalcStatus').textContent = '';
}

$$('[data-planner-day]').forEach((button) => {
  button.addEventListener('click', () => renderPlannerSchedule(Number(button.dataset.plannerDay)));
});
$$('#estimateGuests, #estimateRooms, #estimateFlight, #estimateHotel, #estimateTransport, #estimateMeals, #estimateTickets')
  .forEach((field) => field.addEventListener('input', updatePlannerCost));

$('#shareItinerary').addEventListener('click', async () => {
  const shareUrl = `${window.location.origin}${window.location.pathname}#planner-itinerary`;
  const shareData = { title: 'Lịch trình Đà Lạt · VietJourney', text: 'Xem lịch trình Đà Lạt 3 ngày 2 đêm.', url: shareUrl };
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

renderPlannerSchedule(0);
updatePlannerCost();
loadPlannerWeather();

$$('.menu, .planner-menu').forEach((button) => {
  button.onclick = (event) => {
    const nav = $('nav');
    const open = nav.classList.toggle('open');
    $$('.menu, .planner-menu').forEach((item) => item.setAttribute('aria-expanded', String(open)));
    event.currentTarget.setAttribute('aria-expanded', String(open));
  };
});

$$('nav a').forEach((link) => {
  link.onclick = () => {
    $('nav').classList.remove('open');
    $$('.menu, .planner-menu').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  };
});

chips('#leadInterests');
getCurrentUtm();
loadTours();
