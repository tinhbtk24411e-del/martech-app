import { verifyOptOut } from '../lib/_nurture.js';
import { supabase } from '../lib/_supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(res, status, title, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:0 20px">` +
    `<h1>${title}</h1><p>${text}</p></body>`);
}

// Link in every nurture email. Signed with NURTURE_SECRET so nobody can opt out others.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return page(res, 405, 'Không hỗ trợ', 'Yêu cầu không hợp lệ.');
  }

  const leadId = String(req.query?.lead_id || '');
  const sig = String(req.query?.sig || '');
  if (!UUID.test(leadId) || !verifyOptOut(leadId, sig, process.env.NURTURE_SECRET)) {
    return page(res, 400, 'Liên kết không hợp lệ', 'Liên kết này không đúng hoặc đã hết hiệu lực.');
  }

  try {
    const response = await supabase(`leads?lead_id=eq.${leadId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ nurture_opt_out: true }),
    });
    if (!response.ok) {
      return page(res, 503, 'Chưa xử lý được', 'Vui lòng thử lại sau hoặc trả lời email này để được hỗ trợ.');
    }
    return page(res, 200, 'Đã hủy nhận email', 'Bạn sẽ không nhận thêm email nuôi dưỡng từ VietJourney. Nếu cần tư vấn, hãy trả lời email gần nhất.');
  } catch (error) {
    console.error('[api/optout] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return page(res, 503, 'Chưa xử lý được', 'Vui lòng thử lại sau.');
  }
}
