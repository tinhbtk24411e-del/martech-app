const interests = ['Khám phá', 'Nghỉ dưỡng', 'Ẩm thực', 'Chụp ảnh', 'Thiên nhiên', 'Trekking', 'Gia đình', 'Văn hóa'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
let tours = [];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const money = (value) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));

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

function setMessage(form, text, ok = false) {
  const element = form.querySelector('.form-message');
  element.textContent = text;
  element.className = 'form-message ' + (ok ? 'success' : 'error');
}

function duration(item) {
  const match = Number(String(item.duration || '').match(/\d+/)?.[0]);
  return match || 0;
}

function card(item) {
  const element = document.createElement('article');
  element.className = 'tour-card';

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

  const filtered = tours.filter((tour) => {
    const length = duration(tour);
    const price = Number(tour.price_per_person);

    return (
      (!destination || tour.destination === destination) &&
      (!type || (tour.experience_type || []).includes(type)) &&
      (!durationFilter ||
        (durationFilter === 'short' ? length <= 3 : durationFilter === 'medium' ? length >= 4 && length <= 6 : length >= 7)) &&
      (!budgetFilter ||
        (budgetFilter === 'under5' ? price < 5_000_000 : budgetFilter === '5to10' ? price >= 5_000_000 && price <= 10_000_000 : price > 10_000_000))
    );
  });

  const grid = $('#tourGrid');
  grid.replaceChildren(
    ...(filtered.length
      ? filtered.map((tour) => card(tour))
      : [emptyState('Chưa có hành trình phù hợp với bộ lọc này. Hãy thử lựa chọn khác hoặc gửi yêu cầu để được tư vấn.')])
  );
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

  $$('.filters select').forEach((select) => {
    select.onchange = renderTours;
  });
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
  location.hash = 'contact';
  setMessage(form, `Đã chọn “${tour.name}”. Hãy điền thông tin để được tư vấn.`, true);
}

function showDetails(tour) {
  const details = [
    `Điểm đến: ${tour.destination || '—'}`,
    `Thời lượng: ${tour.duration || '—'}`,
    `Dịch vụ gồm: ${(tour.included_services || []).join(', ') || 'Xem tư vấn'}`,
    `Điểm nổi bật: ${(tour.highlights || []).join(', ') || '—'}`,
  ].join('\n');

  alert(`${tour.name}\n\n${details}`);
}

async function loadTours() {
  renderSkeleton();

  try {
    const response = await fetch('data/tours.json');
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

    setMessage(form, `Yêu cầu đã được ghi nhận. Mã Lead ID: ${data.lead_id}`, true);
    form.reset();
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
getCurrentUtm();
loadTours();
