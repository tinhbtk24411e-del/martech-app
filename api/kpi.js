import { send } from '../lib/_shared.js';
import { tierOutcomes } from '../lib/_outcomes.js';
import { leadQuality } from '../lib/_outcomes_quality.js';
import { supabase } from '../lib/_supabase.js';

const WINDOW_DAYS = 180;
const PAGE_SIZE = 1000;

async function loadRows(resource, dateColumn, since, select, order) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await supabase(
      `${resource}?${dateColumn}=gte.${encodeURIComponent(since)}` +
        `&select=${select}&order=${order}`,
      {
        headers: {
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
          'Range-Unit': 'items',
        },
      },
    );
    if (!response.ok) {
      console.error(`[api/kpi] Could not read ${resource}`, { status: response.status });
      return null;
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      console.error(`[api/kpi] Supabase returned an invalid ${resource} page`);
      return null;
    }
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// Aggregate-only endpoint for the dashboard. Returns counts, never contact details.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Chỉ hỗ trợ GET.' });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [rows, visitorResponse] = await Promise.all([
      loadRows(
        'leads',
        'created_at',
        since,
        'lead_id,created_at,lead_status,lead_level,utm_source,selected_tour_id,lead_source',
        'created_at.asc,lead_id.asc',
      ),
      supabase('rpc/get_website_visitor_kpis', {
        method: 'POST',
        body: JSON.stringify({ p_since: since }),
      }),
    ]);
    if (!rows || !visitorResponse.ok) {
      if (visitorResponse && !visitorResponse.ok) {
        console.error('[api/kpi] Could not aggregate visitor data', { status: visitorResponse.status });
      }
      return send(res, 503, { error: 'Chưa đọc được dữ liệu KPI.' });
    }

    const visitorStats = await visitorResponse.json();
    if (!visitorStats || !Number.isFinite(Number(visitorStats.total)) ||
        !visitorStats.by_priority || typeof visitorStats.by_priority !== 'object' ||
        Array.isArray(visitorStats.by_priority) || !visitorStats.by_source ||
        typeof visitorStats.by_source !== 'object' || Array.isArray(visitorStats.by_source) ||
        !visitorStats.by_temperature || typeof visitorStats.by_temperature !== 'object' ||
        Array.isArray(visitorStats.by_temperature) ||
        !visitorStats.funnel || typeof visitorStats.funnel !== 'object' ||
        Array.isArray(visitorStats.funnel) ||
        ['visitors', 'engaged', 'booking_started', 'booking_submitted'].some((key) =>
          !Number.isFinite(Number(visitorStats.funnel[key])) || Number(visitorStats.funnel[key]) < 0)) {
      console.error('[api/kpi] Supabase returned invalid visitor aggregates');
      return send(res, 503, { error: 'Dữ liệu KPI không đúng định dạng.' });
    }

    const countBy = (key) => rows.reduce((acc, row) => {
      const value = row[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
    const byMonth = rows.reduce((acc, row) => {
      const month = String(row.created_at).slice(0, 7);
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    }, {});

    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, {
      generated_at: new Date().toISOString(),
      window_days: WINDOW_DAYS,
      total: rows.length,
      visitor_total: Number(visitorStats.total),
      with_selected_tour: rows.filter((row) => row.selected_tour_id).length,
      by_status: countBy('lead_status'),
      by_level: countBy('lead_level'),
      by_source: countBy('utm_source'),
      funnel_by_tier: tierOutcomes(rows),
      lead_quality: leadQuality(rows),
      visitor_by_priority: visitorStats.by_priority,
      visitor_by_source: visitorStats.by_source,
      visitor_by_temperature: visitorStats.by_temperature,
      visitor_funnel: visitorStats.funnel,
      by_month: byMonth,
      note: 'Tổng hợp visitor ẩn danh và lead; không chứa thông tin liên hệ.',
    });
  } catch (error) {
    console.error('[api/kpi] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Chưa đọc được dữ liệu KPI.' });
  }
}
