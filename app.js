const interests = ['Khám phá', 'Nghỉ dưỡng', 'Ẩm thực', 'Chụp ảnh', 'Thiên nhiên', 'Trekking', 'Gia đình', 'Văn hóa'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
let tours = [];
let savedTours = [];
let showSavedTours = false;
let chatConversation = [];
let chatRequestPending = false;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const SAVED_TOURS_KEY = 'vietjourney_saved_tours';

try {
  const saved = JSON.parse(localStorage.getItem(SAVED_TOURS_KEY) || '[]');
  savedTours = Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
} catch {
  savedTours = [];
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
  image.src = item.image || 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80';
  image.onerror = () => {
    image.src = 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80';
  };
  element.append(image);

  const copy = document.createElement('div');
  copy.className = 'tour-copy';
  copy.innerHTML = `
    <div class="tour-meta">${sanitizeText(item.destination)} · ${sanitizeText(String(item.duration || ''))}</div>
    <h3>${sanitizeText(item.name)}</h3>
    <div class="price">${money(item.price_per_person)}<small>/ người</small></div>
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
    : `${filtered.length} hành trình đang mở bán từ VietJourney`;
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
  form.elements.budget.value = tour.price_per_person || '';
  updateBudgetPreview();
  location.hash = 'contact';
  setMessage(form, `Đã chọn “${tour.name}”. Hãy điền thông tin để được tư vấn.`, true);
}

function showDetails(tour) {
  const dialog = $('#tourDialog');
  $('#dialogImage').src = tour.image || 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80';
  $('#dialogImage').alt = tour.name || 'Tour VietJourney';
  $('#dialogMeta').textContent = `${tour.destination || 'Việt Nam'} · ${tour.duration || 'Linh hoạt'}`;
  $('#dialogTitle').textContent = tour.name;
  $('#dialogPrice').textContent = `${money(tour.price_per_person)} / người`;
  $('#dialogOverview').textContent = tour.overview || 'Liên hệ VietJourney để được giới thiệu chi tiết hành trình.';

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
    ['#dialogServices', tour.included_services || [], 'Đội ngũ tư vấn sẽ chia sẻ chi tiết'],
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
  payload.lead_score = Number(payload.lead_score || 0);
  payload.lead_level = payload.lead_level || 'NEW';
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
      ? ' Email xác nhận đã được gửi.'
      : data.notification_status === 'FAILED'
        ? ' n8n báo email chưa gửi được; đội ngũ sẽ kiểm tra lại.'
        : ' Email có thể đã gửi, nhưng hệ thống chưa nhận được xác nhận từ n8n.';
    const messageStatus = data.notification_status === 'SENT'
      ? true
      : data.notification_status === 'PENDING' ? 'warning' : false;
    setMessage(form, `Yêu cầu đã được ghi nhận.${notificationMessage} Mã Lead ID: ${data.lead_id}`, messageStatus);
    form.reset();
    $('#tourName').value = '';
    updateBudgetPreview();
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
getCurrentUtm();
loadTours();
