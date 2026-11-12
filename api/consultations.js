import crypto from 'node:crypto';
import { clean, method, number, send, tours, utmFields } from '../lib/_shared.js';
import { supabase, supabaseErrorCode } from '../lib/_supabase.js';
import { deliverLeadCapture, updateNotificationStatus } from '../lib/_notify.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (!method(req, res)) return;
  const b = req.body || {};
  if (b.website) return send(res, 200, { lead_id: 'received' });

  const name = clean(b.name, 120);
  const email = clean(b.email, 160).toLowerCase();
  const consent = b.consent_to_contact === true || b.consent_to_contact === 'true';
  const partySize = b.party_size === undefined || b.party_size === '' ? null : number(b.party_size, 1, 30);
  const requestId = clean(req.headers['idempotency-key'] || b.request_id || '', 80) || crypto.randomUUID();
  const tourId = clean(b.selected_tour_id, 100);
  if (!name || !EMAIL.test(email) || !consent || !tourId ||
      (b.party_size !== undefined && b.party_size !== '' && partySize === null)) {
    return send(res, 400, { error: 'Vui lòng nhập tên, email hợp lệ, chọn tour và đồng ý để Sales liên hệ tư vấn.' });
  }

  try {
    const active = await tours();
    const selected = active.find((tour) => String(tour.id) === tourId);
    if (!selected) return send(res, 400, { error: 'Tour được chọn không còn hợp lệ.' });
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const requestDuplicate = await supabase(
      `leads?request_id=eq.${encodeURIComponent(requestId)}&select=lead_id,notification_status,lead_source`,
    );
    if (!requestDuplicate.ok) return send(res, 503, { error: 'Chưa thể kiểm tra yêu cầu trùng. Vui lòng thử lại.' });
    const [sameRequest] = await requestDuplicate.json();
    if (sameRequest?.lead_source === 'consultation_form') return send(res, 200, {
      lead_id: sameRequest.lead_id,
      lead_priority: 'WARM',
      crm_status: 'NEW',
      notification_status: sameRequest.notification_status || 'PENDING',
      duplicate: true,
    });
    const duplicate = await supabase(
      `leads?contact=eq.${encodeURIComponent(email)}` +
      `&selected_tour_id=eq.${encodeURIComponent(selected.id)}` +
      `&lead_source=eq.consultation_form&created_at=gte.${encodeURIComponent(since)}` +
      '&select=lead_id,notification_status&order=created_at.desc&limit=1',
    );
    if (!duplicate.ok) return send(res, 503, { error: 'Chưa thể kiểm tra yêu cầu trùng. Vui lòng thử lại.' });
    const [existing] = await duplicate.json();
    if (existing) return send(res, 200, {
      lead_id: existing.lead_id,
      notification_status: existing.notification_status || 'PENDING',
      duplicate: true,
    });

    const utm = utmFields(b);
    const rawSource = (utm.utm_source || '').toLowerCase();
    const knownSources = new Set(['facebook', 'tiktok', 'instagram', 'google', 'direct']);
    const row = {
      lead_id: crypto.randomUUID(),
      request_id: requestId,
      name,
      contact: email,
      email,
      destination: clean(selected.destination, 100),
      duration: Number(String(selected.duration || '').match(/\d+/)?.[0]) || null,
      budget: Number(selected.price_per_person) || null,
      party_size: partySize,
      selected_tour_id: selected.id,
      selected_tour_name: clean(selected.name, 200),
      interests: Array.isArray(selected.experience_type) ? selected.experience_type : [],
      lead_status: 'NEW',
      lead_source: 'consultation_form',
      source: 'consultation_form',
      care_priority: 'WARM',
      lead_priority: 'MEDIUM',
      lead_level: 'WARM',
      lead_score: 45,
      consent_to_contact: true,
      nurture_step: 0,
      nurture_opt_out: false,
      notification_status: 'PENDING',
      utm_source: knownSources.has(rawSource) ? rawSource : rawSource ? 'other' : 'direct',
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null,
      utm_content: utm.utm_content || null,
      utm_term: utm.utm_term || null,
      note: clean(b.note, 600) || 'Yêu cầu tư vấn tour; chưa phải yêu cầu đặt tour.',
    };
    const saved = await supabase('leads', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row),
    });
    if (!saved.ok) {
      console.error('[api/consultations] Insert failed', { databaseCode: await supabaseErrorCode(saved) });
      return send(res, 503, { error: 'Chưa thể lưu yêu cầu. Vui lòng thử lại sau.' });
    }
    const [lead] = await saved.json();
    const leadId = lead?.lead_id || row.lead_id;
    const outcome = await deliverLeadCapture({ ...row, lead_id: leadId, created_at: lead?.created_at || null });
    let notificationStatus = 'PENDING';
    if (outcome !== 'PENDING') {
      notificationStatus = await updateNotificationStatus(leadId, outcome) ? outcome : 'PENDING';
    }
    return send(res, 201, { lead_id: leadId, lead_priority: 'WARM', crm_status: 'NEW', notification_status: notificationStatus });
  } catch (error) {
    console.error('[api/consultations] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Chưa thể ghi nhận yêu cầu. Vui lòng thử lại sau.' });
  }
}
