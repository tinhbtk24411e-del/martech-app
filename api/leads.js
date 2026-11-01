import { clean, list, method, number, send, tours } from './_shared.js';
export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
const supabase = async (endpoint, options = {}) => {
  const base = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('not configured');
  return fetch(`${base}/rest/v1/${endpoint}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
};
export default async function handler(req, res) {
  if (!method(req, res)) return;
  const b = req.body || {};
  if (b.website) return send(res, 200, { lead_id: 'received' }); // honeypot
  const name = clean(b.name, 120), contact = clean(b.contact, 160), destination = clean(b.destination, 100);
  const duration = number(b.duration, 1, 60), budget = number(b.budget, 0, 1_000_000_000), party_size = number(b.party_size, 1, 30);
  if (!name || !contact || !destination || !duration || budget === null || !party_size || b.consent_to_contact !== true) return send(res, 400, { error: 'Vui lòng điền đủ thông tin hợp lệ và đồng ý để chúng tôi liên hệ.' });
  if (contact.length < 6) return send(res, 400, { error: 'Thông tin liên hệ chưa hợp lệ.' });
  const request_id = clean(req.headers['idempotency-key'], 80) || crypto.randomUUID();
  try {
    const active = await tours(); const selected = b.selected_tour_id ? active.find(t => String(t.id) === String(b.selected_tour_id)) : null;
    if (b.selected_tour_id && !selected) return send(res, 400, { error: 'Tour được chọn không còn hợp lệ.' });
    const exists = await supabase(`leads?request_id=eq.${encodeURIComponent(request_id)}&select=lead_id`);
    if (exists.ok) { const prior = await exists.json(); if (prior[0]) return send(res, 200, { lead_id: prior[0].lead_id, duplicate: true }); }
    const row = { request_id, name, contact, destination, duration, budget, party_size, travel_date: clean(b.travel_date, 30) || null, interests: list(b.interests), selected_tour_id: selected?.id || null, selected_tour_name: selected?.name || null, lead_source: 'website', consent_to_contact: true, lead_status: selected ? 'HIGH_PRIORITY' : 'STANDARD', notification_status: 'PENDING', note: clean(b.note, 1000) || null };
    const saved = await supabase('leads', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (!saved.ok) throw new Error('save failed');
    const lead = (await saved.json())[0];
    let notification_status = 'PENDING';
    if (process.env.N8N_WEBHOOK_URL) {
      try { const c = new AbortController(); const timeout = setTimeout(() => c.abort(), 8000); const hook = await fetch(process.env.N8N_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Automation-Secret': process.env.N8N_WEBHOOK_SECRET || '' }, signal: c.signal, body: JSON.stringify({ lead_id: lead.lead_id, name, contact, destination, duration, budget, party_size, travel_date: row.travel_date, interests: row.interests, selected_tour_id: row.selected_tour_id, selected_tour_name: row.selected_tour_name, consent_to_contact: true }) }); clearTimeout(timeout);
        const acknowledgement = hook.ok ? await hook.json().catch(() => ({})) : {}; if (acknowledgement.email_sent === true) { notification_status = 'SENT'; await supabase(`leads?lead_id=eq.${encodeURIComponent(lead.lead_id)}`, { method: 'PATCH', body: JSON.stringify({ notification_status }) }); }
      } catch { /* lead is retained as PENDING for retry by automation */ }
    }
    return send(res, 201, { lead_id: lead.lead_id, notification_status });
  } catch { return send(res, 503, { error: 'Chưa thể ghi nhận yêu cầu. Vui lòng thử lại sau.' }); }
}
