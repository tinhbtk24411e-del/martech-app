const BOOKINGS_PER_CUSTOMER_LIFETIME = 1.25;
const monthlyData = [
  { month: '2026-05', visitors: 8500, leads: 285, mql: 144, sql: 69, customers: 26, revenue: 260_000_000, marketingSpend: 65_000_000 },
  { month: '2026-06', visitors: 9200, leads: 312, mql: 162, sql: 78, customers: 30, revenue: 300_000_000, marketingSpend: 72_000_000 },
  { month: '2026-07', visitors: 11800, leads: 402, mql: 213, sql: 102, customers: 39, revenue: 390_000_000, marketingSpend: 88_000_000 },
  { month: '2026-08', visitors: 12600, leads: 435, mql: 235, sql: 114, customers: 44, revenue: 440_000_000, marketingSpend: 96_000_000 },
  { month: '2026-09', visitors: 10500, leads: 356, mql: 184, sql: 87, customers: 33, revenue: 330_000_000, marketingSpend: 76_000_000 },
  { month: '2026-10', visitors: 14100, leads: 492, mql: 270, sql: 130, customers: 50, revenue: 500_000_000, marketingSpend: 110_000_000 },
];
const numberFormat = new Intl.NumberFormat('vi-VN');
const moneyFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const $ = (selector) => document.querySelector(selector);

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function percent(value, total) {
  return total ? `${(value / total * 100).toFixed(1)}%` : '—';
}

function metrics(row) {
  const leadConversion = percent(row.leads, row.visitors);
  const bookingConversion = percent(row.customers, row.leads);
  const averageRevenue = row.customers ? row.revenue / row.customers : 0;
  return {
    leadConversion,
    bookingConversion,
    cac: row.customers ? row.marketingSpend / row.customers : 0,
    ltv: averageRevenue * BOOKINGS_PER_CUSTOMER_LIFETIME,
  };
}

function aggregate(rows) {
  return Object.fromEntries(
    ['visitors', 'leads', 'mql', 'sql', 'customers', 'revenue', 'marketingSpend']
      .map((key) => [key, sum(rows, key)]),
  );
}

function renderKpis(total) {
  const result = metrics(total);
  const cards = [
    ['Website visitors', numberFormat.format(total.visitors), 'Lượt truy cập giả lập'],
    ['Leads', numberFormat.format(total.leads), `Lead Conversion ${result.leadConversion}`],
    ['MQL → SQL', `${numberFormat.format(total.mql)} → ${numberFormat.format(total.sql)}`, 'Lead đủ điều kiện → Sales tiếp nhận'],
    ['Customers', numberFormat.format(total.customers), `Booking Conversion ${result.bookingConversion}`],
    ['Revenue', `${moneyFormat.format(total.revenue)} ₫`, 'Doanh thu mô phỏng'],
    ['Estimated CAC', `${moneyFormat.format(result.cac)} ₫`, 'Chi phí marketing / khách đặt tour'],
    ['Estimated LTV', `${moneyFormat.format(result.ltv)} ₫`, `Giả định ${BOOKINGS_PER_CUSTOMER_LIFETIME} lượt đặt / khách`],
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

function renderFunnel(total, period) {
  const stages = [
    ['Visitors', total.visitors],
    ['Leads', total.leads],
    ['MQL', total.mql],
    ['SQL', total.sql],
    ['Customers', total.customers],
  ];
  const max = total.visitors || 1;
  $('#funnelPeriod').textContent = period;
  $('#funnel').replaceChildren(...stages.map(([label, value], index) => {
    const row = document.createElement('div');
    row.className = 'funnel-row';
    const title = document.createElement('span');
    title.className = 'funnel-label';
    title.textContent = label;
    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${label}: ${numberFormat.format(value)}`);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${Math.max(1, value / max * 100)}%`;
    track.append(bar);
    const count = document.createElement('span');
    count.className = 'funnel-count';
    count.textContent = numberFormat.format(value);
    const rate = document.createElement('span');
    rate.className = 'funnel-rate';
    rate.textContent = index === 0 ? '100%' : percent(value, stages[index - 1][1]);
    row.append(title, track, count, rate);
    return row;
  }));
}

function renderTable(rows) {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  $('#monthlyRows').replaceChildren(...sorted.map((row) => {
    const result = metrics(row);
    const values = [
      row.month,
      numberFormat.format(row.visitors),
      numberFormat.format(row.leads),
      numberFormat.format(row.mql),
      numberFormat.format(row.sql),
      numberFormat.format(row.customers),
      result.leadConversion,
      result.bookingConversion,
      `${moneyFormat.format(row.revenue)} ₫`,
      `${moneyFormat.format(result.cac)} ₫`,
      `${moneyFormat.format(result.ltv)} ₫`,
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

function selectedRows() {
  const period = $('#periodFilter').value;
  return period === 'all' ? monthlyData : monthlyData.filter((row) => row.month === period);
}

function render() {
  const rows = selectedRows();
  const total = aggregate(rows);
  const period = $('#periodFilter').value === 'all' ? '6 tháng' : $('#periodFilter').value;
  renderKpis(total);
  renderFunnel(total, period);
  renderTable(rows);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportCsv() {
  const rows = selectedRows().map((row) => {
    const result = metrics(row);
    return [
      row.month, row.visitors, row.leads, row.mql, row.sql, row.customers,
      `${(row.leads / row.visitors * 100).toFixed(2)}%`,
      `${(row.customers / row.leads * 100).toFixed(2)}%`,
      row.revenue, row.marketingSpend, Math.round(result.cac), Math.round(result.ltv),
    ];
  });
  const content = [
    ['Dataset', 'Dữ liệu giả lập, không phải dữ liệu CRM thực'],
    ['CAC', 'Chi phí marketing / Customers'],
    ['LTV', `Revenue / Customers x ${BOOKINGS_PER_CUSTOMER_LIFETIME} lượt đặt giả định`],
    [],
    ['Tháng', 'Visitors', 'Leads', 'MQL', 'SQL', 'Customers', 'Lead Conversion', 'Booking Conversion', 'Revenue (VND)', 'Marketing Spend (VND)', 'Estimated CAC (VND)', 'Estimated LTV (VND)'],
    ...rows,
  ].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = 'vietjourney-kpi-demo.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

monthlyData.forEach(({ month }) => {
  const option = document.createElement('option');
  option.value = option.textContent = month;
  $('#periodFilter').append(option);
});
$('#periodFilter').addEventListener('change', render);
$('#exportCsv').addEventListener('click', exportCsv);
render();
