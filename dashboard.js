import { computeScenario, projectTrend, SCENARIO_ORDER } from './kpi-model.js';

const $ = (selector) => document.querySelector(selector);
const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const vnd = (value) => `${integerFormat.format(Math.round(value))} ₫`;

let assumptions = null;
let trendRows = [];

function selectedInputs() {
  return assumptions.scenarios[$('#scenarioFilter').value];
}

function renderKpis(s, inputs) {
  const cards = [
    ['Lượt truy cập / tháng', integerFormat.format(s.visitors), 'Giả lập, kịch bản đang chọn'],
    ['Leads', numberFormat.format(s.leads), `Lead rate ${pct(s.leadRate)}`],
    ['MQL → SQL', `${numberFormat.format(s.mql)} → ${numberFormat.format(s.sql)}`, `SQL/MQL ${pct(s.sqlRate)}`],
    ['Khách đặt tour', numberFormat.format(s.customers), `Customer / Lead ${pct(s.customerPerLead)}`],
    ['Doanh thu mô phỏng', vnd(s.revenue), 'Khách × giá trung bình tour'],
    ['CAC ước tính', vnd(s.cac), `Chi phí ${vnd(s.spend)} / khách`],
    ['LTV ước tính', vnd(s.ltv), `Giả định ${inputs.purchases_per_customer} lượt mua / khách`],
    ['LTV : CAC', `${numberFormat.format(s.ltvToCac)} : 1`, 'Chưa trừ giá vốn tour'],
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

function renderFunnel(s, label) {
  const stages = [
    ['Visitors', s.visitors],
    ['Leads', s.leads],
    ['MQL', s.mql],
    ['SQL', s.sql],
    ['Customers', s.customers],
  ];
  const max = s.visitors || 1;
  $('#funnelPeriod').textContent = label;
  $('#funnel').replaceChildren(...stages.map(([name, value], index) => {
    const row = document.createElement('div');
    row.className = 'funnel-row';
    const title = document.createElement('span');
    title.className = 'funnel-label';
    title.textContent = name;
    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${name}: ${numberFormat.format(value)}`);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${Math.max(1, value / max * 100)}%`;
    track.append(bar);
    const count = document.createElement('span');
    count.className = 'funnel-count';
    count.textContent = numberFormat.format(value);
    const rate = document.createElement('span');
    rate.className = 'funnel-rate';
    rate.textContent = index === 0 ? '100%' : pct(value / stages[index - 1][1] || 0);
    row.append(title, track, count, rate);
    return row;
  }));
}

function renderTrend(rows) {
  $('#monthlyRows').replaceChildren(...rows.map((row) => {
    const values = [
      `Tháng ${row.month}`,
      integerFormat.format(Math.round(row.visitors)),
      numberFormat.format(row.leads),
      numberFormat.format(row.mql),
      numberFormat.format(row.sql),
      numberFormat.format(row.customers),
      pct(row.customerPerLead),
      vnd(row.revenue),
      vnd(row.cac),
      vnd(row.ltv),
    ];
    const tr = document.createElement('tr');
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.append(cell);
    });
    return tr;
  }));
}

function render() {
  const inputs = selectedInputs();
  const s = computeScenario(inputs);
  trendRows = projectTrend(inputs, 6);
  renderKpis(s, inputs);
  renderFunnel(s, inputs.label);
  renderTrend(trendRows);
  $('#assumptionsList').replaceChildren(...[
    `Lượt truy cập: ${integerFormat.format(inputs.visitors_per_month)} / tháng, tăng ${pct(inputs.monthly_growth)} mỗi tháng trong phần dự phóng.`,
    `Lead rate ${pct(inputs.lead_rate)} · MQL ${pct(inputs.mql_rate)} của lead · SQL ${pct(inputs.sql_rate)} của MQL · Khách đặt tour ${pct(inputs.customer_rate)} của SQL.`,
    `Giá trung bình tour ${vnd(inputs.avg_booking_value)} (trung bình 10 tour trong catalog); ${inputs.purchases_per_customer} lượt mua / khách.`,
    `Chi phí marketing cố định ${vnd(inputs.marketing_spend_per_month)} / tháng.`,
    'Toàn bộ số liệu là mô phỏng. Nguồn duy nhất: data/kpi-assumptions.json, cùng công thức với file Excel.',
  ].map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

async function loadLiveSummary() {
  try {
    const response = await fetch('/api/kpi', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const rows = Object.entries(data.by_status || {}).map(([status, count]) => `${status}: ${count}`);
    $('#liveTotal').textContent = numberFormat.format(data.total);
    $('#liveStatus').textContent = rows.length ? rows.join(' · ') : 'Chưa có lead';
    $('#liveTour').textContent = numberFormat.format(data.with_selected_tour || 0);
    $('#liveBlock').hidden = false;
  } catch {
    // Live block stays hidden when the API is not configured.
  }
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportCsv() {
  const scenario = $('#scenarioFilter').value;
  const header = ['Tháng', 'Visitors', 'Leads', 'MQL', 'SQL', 'Customers', 'Customer/Lead', 'Revenue (VND)', 'CAC (VND)', 'LTV (VND)'];
  const rows = trendRows.map((row) => [
    row.month, Math.round(row.visitors), row.leads.toFixed(1), row.mql.toFixed(1), row.sql.toFixed(1),
    row.customers.toFixed(2), pct(row.customerPerLead), Math.round(row.revenue), Math.round(row.cac), Math.round(row.ltv),
  ]);
  const content = [
    ['Dataset', assumptions.dataset],
    ['Kịch bản', assumptions.scenarios[scenario].label],
    ['Nguồn số liệu', 'data/kpi-assumptions.json (cùng công thức với file Excel mô phỏng)'],
    [],
    header,
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `vietjourney-kpi-${scenario}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  const response = await fetch('data/kpi-assumptions.json', { cache: 'no-store' });
  assumptions = await response.json();
  const select = $('#scenarioFilter');
  select.replaceChildren(...SCENARIO_ORDER.map((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = assumptions.scenarios[key].label;
    return option;
  }));
  select.addEventListener('change', render);
  $('#exportCsv').addEventListener('click', exportCsv);
  render();
  loadLiveSummary();
}

init();
