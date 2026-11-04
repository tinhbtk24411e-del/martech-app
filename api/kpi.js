import { send } from './_shared.js';
import { supabase } from './_supabase.js';

const WINDOW_DAYS = 180;
const PAGE_SIZE = 1000;

// Aggregate-only endpoint for the dashboard. Returns counts, never contact details.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Chỉ hỗ trợ GET.' });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const response = await supabase(
        `leads?created_at=gte.${encodeURIComponent(since)}` +
          `&select=lead_id,created_at,lead_status,lead_level,utm_source,selected_tour_id&order=created_at.asc,lead_id.asc`,
        {
          headers: {
            Range: `${offset}-${offset + PAGE_SIZE - 1}`,
            'Range-Unit': 'items',
          },
        },
      );
      if (!response.ok) return send(res, 503, { error: 'Chưa đọc được dữ liệu KPI.' });

      const page = await response.json();
      if (!Array.isArray(page)) {
        console.error('[api/kpi] Supabase returned an invalid lead page');
        return send(res, 503, { error: 'Dữ liệu KPI không đúng định dạng.' });
      }
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
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
      with_selected_tour: rows.filter((row) => row.selected_tour_id).length,
      by_status: countBy('lead_status'),
      by_level: countBy('lead_level'),
      by_source: countBy('utm_source'),
      by_month: byMonth,
      note: 'Tổng hợp ẩn danh, không chứa thông tin liên hệ.',
    });
  } catch (error) {
    console.error('[api/kpi] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Chưa đọc được dữ liệu KPI.' });
  }
}
