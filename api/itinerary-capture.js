import { careTier, scoreLead, understandCustomer } from '../lib/_scoring.js';
import { clean, method, number, send, utmFields } from '../lib/_shared.js';
import { supabase, supabaseErrorCode } from '../lib/_supabase.js';
import { deliverNurture } from '../lib/_nurture.js';
import { updateNotificationStatus } from '../lib/_notify.js';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lead magnet from AI Planner: "gửi lịch trình về email".
// Not a consultation request. Creates a COLD lead that enters the nurture sequence.
export default async function handler(req, res) {
  if (!method(req, res)) return;

  const b = req.body || {};
  if (b.website) return send(res, 200, { lead_id: 'received' });

  const name = clean(b.name, 120);
  const email = clean(b.email, 160).toLowerCase();
  const destination = clean(b.destination, 100);
  const days = number(b.duration_days, 1, 30);
  const budget = b.budget === undefined || b.budget === '' ? null : number(b.budget, 0, 1_000_000_000);
  const partySize = b.party_size === undefined || b.party_size === '' ? 1 : number(b.party_size, 1, 30);
  const planSummary = clean(b.plan_summary, 2000);
  const consent = b.consent_to_contact === true;
  // Keep acquisition attribution separate from the AI Planner capture channel.
  const utm = utmFields(b);
  const sourceValue = (utm.utm_source || '').toLowerCase();
  const knownSources = new Set(['facebook', 'tiktok', 'instagram', 'google', 'direct']);
  utm.utm_source = knownSources.has(sourceValue) ? sourceValue : sourceValue ? 'other' : 'direct';

  if (!name || !EMAIL.test(email) || !destination || !days || !consent || partySize === null || budget === undefined) {
    return send(res, 400, { error: 'Vui lòng nhập họ tên, email hợp lệ, điểm đến, số ngày, và đồng ý nhận lịch trình.' });
  }

  try {
    // Same email + destination within 24h: do not create or re-send.
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const recent = await supabase(
      `leads?contact=eq.${encodeURIComponent(email)}` +
        `&destination=eq.${encodeURIComponent(destination)}` +
        `&lead_source=eq.itinerary_capture` +
        `&created_at=gte.${encodeURIComponent(since)}` +
        `&select=lead_id,notification_status&order=created_at.desc&limit=1`,
    );
    if (!recent.ok) return send(res, 503, { error: 'Chưa thể gửi lịch trình. Vui lòng thử lại sau.' });
    const [existing] = await recent.json();
    if (existing) {
      return send(res, 200, { lead_id: existing.lead_id, notification_status: existing.notification_status || 'PENDING', duplicate: true });
    }

    const scored = scoreLead({ selectedTour: false, tourViews: 0, returnVisit: false });
    const understanding = understandCustomer({ interests: [], experienceTypes: [], budget });
    const care = careTier({ bookingRequest: false, selectedTourId: null });

    // `request_id` is required by the shared leads schema. A planner capture is
    // its own request, so generate it alongside the lead id before persistence.
    const row = {
      lead_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      name,
      contact: email,
      email,
      destination,
      duration: days,
      budget,
      party_size: partySize,
      consent_to_contact: true,
      lead_status: 'NEW',
      lead_source: 'itinerary_capture',
      source: 'itinerary_capture',
      utm_source: utm.utm_source || 'direct',
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null,
      utm_content: utm.utm_content || null,
      utm_term: utm.utm_term || null,
      lead_score: scored.score,
      lead_level: scored.level,
      care_priority: care,
      customer_segment: understanding.segment,
      customer_traits: understanding.traits,
      nurture_step: 0,
      nurture_opt_out: false,
      notification_status: 'PENDING',
      note: planSummary || null,
    };

    const saved = await supabase('leads', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!saved.ok) {
      console.error('[api/itinerary-capture] Insert failed', { databaseCode: await supabaseErrorCode(saved) });
      return send(res, 503, { error: 'Chưa thể lưu yêu cầu. Vui lòng thử lại sau.' });
    }
    const [lead] = await saved.json();
    const leadId = lead?.lead_id || row.lead_id;

    // Send the itinerary now through the nurture webhook (action = itinerary_delivery, step 0).
    const delivered = await deliverNurture(
      { ...row, lead_id: leadId, created_at: lead?.created_at || null, plan_summary: planSummary },
      { step: 0, action: 'itinerary_delivery' },
    );
    let notificationStatus = 'PENDING';
    if (delivered) {
      const recorded = await updateNotificationStatus(leadId, 'SENT');
      notificationStatus = recorded ? 'SENT' : 'PENDING';
    }

    return send(res, 201, { lead_id: leadId, notification_status: notificationStatus });
  } catch (error) {
    console.error('[api/itinerary-capture] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Chưa thể gửi lịch trình. Vui lòng thử lại sau.' });
  }
}
