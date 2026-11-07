const $ = (selector) => document.querySelector(selector);
const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 });
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'BOOKED', 'LOST'];
const SALES_STATUS_LABELS = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  QUOTED: 'Đã báo giá',
  BOOKED: 'Đã xác nhận',
  LOST: 'Đã đóng',
};
let liveData = null;
let salesSecret = '';

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function renderCards(data) {
  const total = count(data.total);
  const booked = count(data.by_status?.BOOKED);
  const cards = [
    ['Khách truy cập', numberFormat.format(count(data.visitor_total)), 'Mã hết hạn sau 7 ngày không truy cập'],
    ['Visitor lạnh', numberFormat.format(count(data.visitor_by_temperature?.COLD)), 'Điểm dưới 40'],
    ['Visitor ấm', numberFormat.format(count(data.visitor_by_temperature?.WARM)), 'Điểm 40–69 hoặc đã chat AI'],
    ['Visitor nóng', numberFormat.format(count(data.visitor_by_temperature?.HOT)), 'Điểm từ 70'],
    ['Đã gửi tư vấn', numberFormat.format(count(data.visitor_by_priority?.HIGH)), 'Ưu tiên form HIGH'],
    ['Tổng lead', numberFormat.format(total), 'Trong 180 ngày gần nhất'],
    ['Đã đặt tour', numberFormat.format(booked), 'Trạng thái BOOKED'],
    ['Tỷ lệ đặt tour', percentFormat.format(total ? booked / total : 0), 'Đặt tour / tổng lead'],
    ['Có chọn tour', numberFormat.format(count(data.with_selected_tour)), 'Lead đã chọn tour cụ thể'],
    ['Lead HOT', numberFormat.format(count(data.by_level?.HOT)), 'Theo điểm ưu tiên hiện tại'],
  ];
  $('#kpiGrid').replaceChildren(...cards.map(([label, value, note]) => {
    const card = document.createElement('article');
    card.className = 'kpi-card';
    const title = document.createElement('p');
    title.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = value;
    const detail = document.createElement('small');
    detail.textContent = note;
    card.append(title, amount, detail);
    return card;
  }));
}

function renderBreakdown(target, values, order) {
  const entries = order
    .filter((key) => Object.hasOwn(values, key))
    .map((key) => [key, count(values[key])]);
  Object.entries(values)
    .filter(([key]) => !order.includes(key))
    .forEach(([key, value]) => entries.push([key, count(value)]));
  entries.sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  $(target).replaceChildren(...(entries.length ? entries : [['Chưa có dữ liệu', 0]]).map(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    const heading = document.createElement('div');
    heading.className = 'breakdown-heading';
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = numberFormat.format(value);
    heading.append(name, amount);
    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${label}: ${numberFormat.format(value)}`);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${value ? Math.max(2, value / max * 100) : 0}%`;
    track.append(bar);
    const share = document.createElement('small');
    share.textContent = `${percentFormat.format(total ? value / total : 0)} tổng nhóm`;
    row.append(heading, track, share);
    return row;
  }));
}

function formatMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, value - 1, 1)));
}

function renderMonths(byMonth) {
  const entries = Object.entries(byMonth)
    .sort(([a], [b]) => b.localeCompare(a));
  $('#monthlyRows').replaceChildren(...(entries.length ? entries : [['', 0]]).map(([month, value]) => {
    const row = document.createElement('tr');
    const monthCell = document.createElement('td');
    monthCell.textContent = month ? formatMonth(month) : 'Chưa có dữ liệu';
    const countCell = document.createElement('td');
    countCell.textContent = numberFormat.format(count(value));
    row.append(monthCell, countCell);
    return row;
  }));
}

function render(data) {
  renderCards(data);
  renderBreakdown('#statusBreakdown', data.by_status || {}, LEAD_STATUSES);
  renderBreakdown('#visitorSourceBreakdown', data.visitor_by_source || {}, ['facebook', 'tiktok', 'instagram']);
  renderBreakdown('#sourceBreakdown', data.by_source || {}, []);
  renderMonths(data.by_month || {});
  $('#lastUpdated').textContent = data.generated_at
    ? `Cập nhật ${new Date(data.generated_at).toLocaleString('vi-VN')}`
    : '';
  $('#dashboardContent').hidden = false;
  $('#exportCsv').disabled = false;
}

async function loadKpi() {
  const button = $('#refreshKpi');
  const message = $('#dashboardMessage');
  button.disabled = true;
  message.className = 'dashboard-message';
  message.textContent = liveData ? 'Đang cập nhật dữ liệu…' : 'Đang tải dữ liệu visitor và lead…';

  try {
    const response = await fetch('/api/kpi', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không tải được dữ liệu KPI.');
    if (!data || !Number.isFinite(Number(data.total)) || !Number.isFinite(Number(data.visitor_total)) ||
        !data.by_status || !data.by_level || !data.by_source || !data.visitor_by_priority ||
        !data.visitor_by_source || !data.visitor_by_temperature || !data.by_month) {
      throw new Error('Dữ liệu KPI trả về không đúng định dạng.');
    }

    liveData = data;
    render(data);
    message.textContent = `Đang hiển thị ${numberFormat.format(count(data.visitor_total))} visitor và ${numberFormat.format(count(data.total))} lead trong ${count(data.window_days) || 180} ngày gần nhất.`;
  } catch (error) {
    message.className = 'dashboard-message error';
    message.textContent = error instanceof TypeError
      ? 'Không kết nối được với hệ thống dữ liệu. Kiểm tra cấu hình Supabase rồi thử lại.'
      : error.message || 'Không tải được dữ liệu KPI. Vui lòng thử lại.';
  } finally {
    button.disabled = false;
  }
}

function salesRequestOptions(method = 'GET', body) {
  return {
    method,
    cache: 'no-store',
    headers: {
      'X-Sales-Secret': salesSecret,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

function bookingAction(status) {
  if (status === 'NEW') return ['CONTACTED', 'Đánh dấu đã liên hệ'];
  if (status === 'CONTACTED') return ['QUOTED', 'Đánh dấu đã báo giá'];
  if (status === 'QUOTED') return ['BOOKED', 'Xác nhận booking & gửi email'];
  return null;
}

function bookingDetail(label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value || 'Chưa có';
  wrapper.append(term, description);
  return wrapper;
}

function renderBookings(bookings) {
  const container = $('#salesBookings');
  if (!bookings.length) {
    const empty = document.createElement('p');
    empty.className = 'dashboard-message';
    empty.textContent = 'Chưa có yêu cầu đặt tour nào.';
    container.replaceChildren(empty);
    container.hidden = false;
    return;
  }

  container.replaceChildren(...bookings.map((booking) => {
    const card = document.createElement('article');
    card.className = 'booking-card';

    const heading = document.createElement('div');
    heading.className = 'booking-card-heading';
    const title = document.createElement('h3');
    title.textContent = booking.name || 'Khách đặt tour';
    const status = document.createElement('span');
    status.className = 'booking-status';
    status.textContent = SALES_STATUS_LABELS[booking.lead_status] || booking.lead_status || 'Chưa rõ';
    heading.append(title, status);

    const details = document.createElement('dl');
    details.className = 'booking-details';
    details.append(
      bookingDetail('Tour', booking.selected_tour_name),
      bookingDetail('Điểm đến', booking.destination),
      bookingDetail('Ngày đi', booking.travel_date),
      bookingDetail('Số khách', booking.party_size ? String(booking.party_size) : ''),
      bookingDetail('Email', booking.email),
      bookingDetail('Điện thoại', booking.phone || booking.contact),
      bookingDetail('Mã yêu cầu', booking.lead_id),
    );

    card.append(heading, details);
    if (booking.lead_status === 'BOOKED') {
      const state = document.createElement('p');
      state.className = 'booking-confirmation-state';
      const confirmationStatus = booking.booking_confirmation_status || 'PENDING';
      state.textContent = confirmationStatus === 'SENT'
        ? 'Email xác nhận đã gửi cho khách.'
        : confirmationStatus === 'PROCESSING'
          ? 'Đang gửi email xác nhận cho khách…'
        : confirmationStatus === 'FAILED'
          ? 'Gửi email thất bại; hệ thống sẽ thử lại.'
          : 'Đang chờ xác nhận gửi email; hệ thống sẽ thử lại nếu cần.';
      card.append(state);
    }

    const action = bookingAction(booking.lead_status);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'booking-action';
      button.dataset.leadId = booking.lead_id;
      button.dataset.nextStatus = action[0];
      button.textContent = action[1];
      card.append(button);
    }
    return card;
  }));
  container.hidden = false;
}

function setSalesMessage(text, kind = '') {
  const message = $('#salesMessage');
  message.textContent = text;
  message.className = `dashboard-message${kind ? ` ${kind}` : ''}`;
  message.hidden = false;
}

async function loadSalesBookings() {
  const response = await fetch('/api/sales-bookings', salesRequestOptions());
  const data = await response.json();
  if (response.status === 401) {
    salesSecret = '';
    throw new Error('Mã truy cập Sales không đúng hoặc đã hết hiệu lực.');
  }
  if (!response.ok) throw new Error(data.error || 'Không tải được danh sách booking.');
  if (!Array.isArray(data.bookings)) throw new Error('Danh sách booking trả về không đúng định dạng.');
  renderBookings(data.bookings);
  setSalesMessage(`Đang hiển thị ${numberFormat.format(data.bookings.length)} booking gần nhất.`, 'success');
}

async function connectSales(event) {
  event.preventDefault();
  const input = $('#salesSecret');
  const button = $('#salesConnect');
  salesSecret = input.value;
  button.disabled = true;
  $('#salesBookings').hidden = true;
  setSalesMessage('Đang xác thực và tải booking…');
  try {
    await loadSalesBookings();
    input.value = '';
  } catch (error) {
    setSalesMessage(error.message || 'Không tải được booking.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function updateBooking(event) {
  const button = event.target.closest('button[data-lead-id][data-next-status]');
  if (!button) return;
  const { leadId, nextStatus } = button.dataset;
  if (nextStatus === 'BOOKED' &&
      !window.confirm('Xác nhận booking? Hệ thống sẽ gửi email xác nhận cho khách.')) return;

  button.disabled = true;
  setSalesMessage(nextStatus === 'BOOKED' ? 'Đang xác nhận booking và gửi email…' : 'Đang cập nhật trạng thái…');
  try {
    const response = await fetch('/api/lead-status', salesRequestOptions('POST', {
      lead_id: leadId,
      lead_status: nextStatus,
    }));
    const data = await response.json();
    if (response.status === 401) {
      salesSecret = '';
      throw new Error('Mã truy cập Sales không đúng hoặc đã hết hiệu lực.');
    }
    if (!response.ok) throw new Error(data.error || 'Không cập nhật được booking.');

    await loadSalesBookings();
    if (nextStatus === 'BOOKED' && data.booking_confirmation_status !== 'SENT') {
      setSalesMessage(
        'Booking đã xác nhận nhưng email chưa được xác nhận gửi; hệ thống sẽ thử lại theo lịch.',
        'error',
      );
    } else {
      setSalesMessage(
        nextStatus === 'BOOKED' ? 'Đã xác nhận booking và gửi email cho khách.' : 'Đã cập nhật trạng thái booking.',
        'success',
      );
    }
  } catch (error) {
    setSalesMessage(error.message || 'Không cập nhật được booking.', 'error');
  } finally {
    button.disabled = false;
  }
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!liveData) return;
  const rows = [
    ['Nhóm', 'Giá trị', 'Số lượng'],
    ...Object.entries(liveData.visitor_by_priority || {}).map(([key, value]) => ['Ưu tiên visitor', key, count(value)]),
    ...Object.entries(liveData.visitor_by_temperature || {}).map(([key, value]) => ['Phân loại visitor', key, count(value)]),
    ...Object.entries(liveData.visitor_by_source || {}).map(([key, value]) => ['Nguồn visitor UTM', key, count(value)]),
    ...Object.entries(liveData.by_status || {}).map(([key, value]) => ['Trạng thái', key, count(value)]),
    ...Object.entries(liveData.by_level || {}).map(([key, value]) => ['Mức ưu tiên', key, count(value)]),
    ...Object.entries(liveData.by_source || {}).map(([key, value]) => ['Nguồn UTM', key, count(value)]),
    ...Object.entries(liveData.by_month || {}).map(([key, value]) => ['Tháng', key, count(value)]),
  ];
  const content = [
    ['Dữ liệu visitor và lead tổng hợp', `180 ngày gần nhất`],
    ['Khách truy cập', count(liveData.visitor_total)],
    ['Tổng lead', count(liveData.total)],
    ['Lead có chọn tour', count(liveData.with_selected_tour)],
    [],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'vietjourney-visitor-lead-kpi.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#refreshKpi').addEventListener('click', loadKpi);
$('#exportCsv').addEventListener('click', exportCsv);
$('#salesAuthForm').addEventListener('submit', connectSales);
$('#salesBookings').addEventListener('click', updateBooking);
loadKpi();
