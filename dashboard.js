const $ = (selector) => document.querySelector(selector);
const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 });
const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'BOOKED', 'LOST'];
let liveData = null;

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function renderCards(data) {
  const total = count(data.total);
  const booked = count(data.by_status?.BOOKED);
  const cards = [
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
    share.textContent = `${percentFormat.format(total ? value / total : 0)} tổng lead`;
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
  message.textContent = liveData ? 'Đang cập nhật dữ liệu…' : 'Đang tải dữ liệu lead…';

  try {
    const response = await fetch('/api/kpi', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không tải được dữ liệu KPI.');
    if (!data || !Number.isFinite(Number(data.total)) || !data.by_status ||
        !data.by_level || !data.by_source || !data.by_month) {
      throw new Error('Dữ liệu KPI trả về không đúng định dạng.');
    }

    liveData = data;
    render(data);
    message.textContent = `Đang hiển thị ${numberFormat.format(count(data.total))} lead trong ${count(data.window_days) || 180} ngày gần nhất.`;
  } catch (error) {
    message.className = 'dashboard-message error';
    message.textContent = error instanceof TypeError
      ? 'Không kết nối được với hệ thống dữ liệu. Kiểm tra cấu hình Supabase rồi thử lại.'
      : error.message || 'Không tải được dữ liệu KPI. Vui lòng thử lại.';
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
    ['Nhóm', 'Giá trị', 'Số lead'],
    ...Object.entries(liveData.by_status || {}).map(([key, value]) => ['Trạng thái', key, count(value)]),
    ...Object.entries(liveData.by_level || {}).map(([key, value]) => ['Mức ưu tiên', key, count(value)]),
    ...Object.entries(liveData.by_source || {}).map(([key, value]) => ['Nguồn UTM', key, count(value)]),
    ...Object.entries(liveData.by_month || {}).map(([key, value]) => ['Tháng', key, count(value)]),
  ];
  const content = [
    ['Dữ liệu lead tổng hợp', `180 ngày gần nhất`],
    ['Tổng lead', count(liveData.total)],
    ['Lead có chọn tour', count(liveData.with_selected_tour)],
    [],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'vietjourney-lead-kpi.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#refreshKpi').addEventListener('click', loadKpi);
$('#exportCsv').addEventListener('click', exportCsv);
loadKpi();
