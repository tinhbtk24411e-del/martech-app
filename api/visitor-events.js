import { clean, method, send } from '../lib/_shared.js';
import { supabase, supabaseErrorCode } from '../lib/_supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = [
  'visit',
  'ai_used',
  'tour_detail_view',
  'pricing_view',
  'engaged_2m',
  'return_visit',
  'compare_or_save',
  'contact_click',
  'booking_started',
];
const SOURCES = new Set(['facebook', 'tiktok', 'instagram', 'google', 'direct']);

export default async function handler(req, res) {
  if (!method(req, res)) return;

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
  const visitorId = clean(body.visitor_id, 36);
  const event = clean(body.event, 30);
  if (!UUID.test(visitorId) || !EVENTS.includes(event)) {
    return send(res, 400, { error: 'Phiên truy cập hoặc sự kiện không hợp lệ.' });
  }

  const source = clean(body.utm_source, 40).toLowerCase();
  const payload = {
    p_visitor_id: visitorId,
    p_event: event,
    p_utm_source: SOURCES.has(source) ? source : source ? 'other' : 'direct',
    p_utm_medium: clean(body.utm_medium, 128) || null,
    p_utm_campaign: clean(body.utm_campaign, 128) || null,
    p_utm_content: clean(body.utm_content, 128) || null,
    p_utm_term: clean(body.utm_term, 128) || null,
    p_lead_id: null,
    p_form_data: {},
  };

  try {
    const response = await supabase('rpc/record_website_visitor', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const databaseCode = await supabaseErrorCode(response);
      console.error('[api/visitor-events] Supabase event insert failed', {
        status: response.status,
        databaseCode,
      });
      return send(res, 503, { error: 'Chưa thể ghi nhận lượt truy cập.' });
    }

    const result = await response.json().catch(() => ({}));
    return send(res, 202, {
      recorded: true,
      score: Number(result?.score) || 0,
      temperature: ['COLD', 'WARM', 'HOT'].includes(result?.temperature)
        ? result.temperature
        : 'COLD',
    });
  } catch (error) {
    console.error('[api/visitor-events] Request failed', {
      errorCode: error?.code || error?.name || 'UNKNOWN',
    });
    return send(res, 503, { error: 'Chưa thể ghi nhận lượt truy cập.' });
  }
}
