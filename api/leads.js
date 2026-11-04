import { clean, list, method, number, send, tours, utmFields } from './_shared.js';
import { scoreLead, understandCustomer } from './_scoring.js';
import { supabase, supabaseErrorCode } from './_supabase.js';
import { deliverToAutomation, updateNotificationStatus } from './_notify.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const SCORING_COLUMNS = ['score_signals', 'customer_segment', 'customer_traits'];
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeUtm(data) {
  const cleaned = utmFields(data);

  for (const key of UTM_KEYS) {
    if (!cleaned[key] && data[key] === 'direct') {
      cleaned[key] = 'direct';
    }
  }

  if (!cleaned.utm_source && Object.keys(cleaned).length) {
    cleaned.utm_source = 'direct';
  }

  return cleaned;
}

// Delivers to n8n and records the outcome. Lead is already saved, so any
// failure here leaves notification_status = PENDING for the retry job.
async function notifyAndRecord(lead) {
  const status = await deliverToAutomation(lead);
  if (status === 'PENDING') return 'PENDING';
  const recorded = await updateNotificationStatus(lead.lead_id, status);
  return recorded ? status : 'PENDING';
}

export default async function handler(req, res) {
  if (!method(req, res)) return;

  const b = req.body || {};
  if (b.website) {
    return send(res, 200, { lead_id: 'received' });
  }

  const name = clean(b.name, 120);
  const explicitEmail = clean(b.email || '', 160);
  const explicitPhone = clean(b.phone || '', 40);
  const explicitZalo = clean(b.zalo_phone || '', 40);
  const contact = clean(b.contact || explicitPhone || explicitEmail || '', 160);
  let destination = clean(b.destination, 100);
  let duration = number(b.duration, 1, 60);
  let budget = number(b.budget, 0, 1_000_000_000);
  const partySize = number(b.party_size, 1, 30);
  const consent = b.consent_to_contact === true || b.consent_to_contact === 'true';
  const bookingRequest = b.booking_request === true;
  const travelDate = clean(b.travel_date, 10);
  const utm = normalizeUtm(b);
  const voucherCode = clean(b.voucher_code || '', 80);
  const voucherStatus = clean(b.voucher_status || 'PENDING', 30) || 'PENDING';
  const voucherChannel = clean(b.voucher_channel || 'email', 30) || 'email';
  const source = clean(b.source || b.lead_source || utm.utm_source || 'website', 60) || 'website';

  if (!name || (!explicitPhone && !explicitEmail) || !partySize || !consent ||
      (!bookingRequest && (!destination || !duration || budget === null)) ||
      (bookingRequest && (!explicitEmail || !b.selected_tour_id || !travelDate))) {
    return send(res, 400, { error: 'Vui lòng điền đủ thông tin hợp lệ và đồng ý để chúng tôi liên hệ.' });
  }

  if (
    (explicitEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(explicitEmail)) ||
    (explicitPhone && explicitPhone.replace(/\D/g, '').length < 6)
  ) {
    return send(res, 400, { error: 'Email hoặc số điện thoại chưa hợp lệ.' });
  }
  if (bookingRequest) {
    const parsedDate = new Date(`${travelDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate) ||
        !Number.isFinite(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== travelDate ||
        travelDate < new Date().toISOString().slice(0, 10)) {
      return send(res, 400, { error: 'Ngày khởi hành phải là ngày hợp lệ từ hôm nay trở đi.' });
    }
  }

  const requestId = clean(req.headers['idempotency-key'] || b.request_id || '', 80) || crypto.randomUUID();
  const failure = { stage: 'load_tours', status: undefined, databaseCode: undefined };

  try {
    const active = await tours();
    const selected = b.selected_tour_id ? active.find((t) => String(t.id) === String(b.selected_tour_id)) : null;

    if (b.selected_tour_id && !selected) {
      return send(res, 400, { error: 'Tour được chọn không còn hợp lệ.' });
    }
    if (bookingRequest) {
      const listedPrice = number(selected?.price_per_person, 1, 1_000_000_000);
      const listedDuration = Number(String(selected?.duration || '').match(/\d+/)?.[0]);
      if (!listedPrice || !Number.isInteger(listedDuration) || listedDuration < 1 || listedDuration > 60) {
        return send(res, 400, { error: 'Tour chưa có giá hoặc thời lượng hợp lệ để nhận yêu cầu đặt.' });
      }
      destination = clean(selected.destination, 100);
      duration = listedDuration;
      budget = listedPrice;
    }

    const engagement = b.engagement && typeof b.engagement === 'object' && !Array.isArray(b.engagement)
      ? b.engagement
      : {};
    const scored = scoreLead({
      selectedTour: Boolean(selected),
      tourViews: number(engagement.tour_views, 0, 100) ?? 0,
      returnVisit: engagement.return_visit === true,
    });
    const understanding = understandCustomer({
      interests: list(b.interests),
      experienceTypes: selected?.experience_type || [],
      budget,
    });

    // Layer 1: same idempotency key (client retry of the same request).
    failure.stage = 'check_duplicate';
    const existingResponse = await supabase(
      `leads?request_id=eq.${encodeURIComponent(requestId)}&select=lead_id,notification_status`,
    );
    if (!existingResponse.ok) {
      failure.status = existingResponse.status;
      failure.databaseCode = await supabaseErrorCode(existingResponse);
      throw new Error('Supabase duplicate check failed');
    }

    const prior = await existingResponse.json();
    const first = Array.isArray(prior) ? prior[0] : null;
    if (first) {
      return send(res, 200, {
        lead_id: first.lead_id,
        notification_status: first.notification_status || 'PENDING',
        duplicate: true,
      });
    }

    // Layer 2: same contact + destination within 24h (customer resubmits a new form).
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const bookingDuplicateFilter = bookingRequest
      ? `&selected_tour_id=eq.${encodeURIComponent(selected.id)}` +
        `&travel_date=eq.${encodeURIComponent(travelDate)}`
      : '';
    const recentResponse = await supabase(
      `leads?contact=eq.${encodeURIComponent(contact)}` +
        `&destination=eq.${encodeURIComponent(destination)}` +
        bookingDuplicateFilter +
        `&created_at=gte.${encodeURIComponent(since)}` +
        `&select=lead_id,notification_status&order=created_at.desc&limit=1`,
    );
    if (!recentResponse.ok) {
      failure.status = recentResponse.status;
      failure.databaseCode = await supabaseErrorCode(recentResponse);
      throw new Error('Supabase recent-lead check failed');
    }
    const recent = await recentResponse.json();
    if (Array.isArray(recent) && recent[0]) {
      return send(res, 200, {
        lead_id: recent[0].lead_id,
        notification_status: recent[0].notification_status || 'PENDING',
        duplicate: true,
      });
    }

    const row = {
      lead_id: crypto.randomUUID(),
      request_id: requestId,
      name,
      contact,
      email: explicitEmail || null,
      phone: explicitPhone || null,
      zalo_phone: explicitZalo || null,
      destination,
      duration,
      budget,
      party_size: partySize,
      travel_date: travelDate || null,
      interests: list(b.interests),
      selected_tour_id: selected?.id || null,
      selected_tour_name: selected?.name || null,
      lead_status: 'NEW',
      notification_status: 'PENDING',
      note: bookingRequest
        ? [
            `Yêu cầu đặt tour qua website. Giá tham khảo: ${budget} VND/người. Chờ Sales xác nhận ngày khởi hành và tình trạng chỗ.`,
            clean(b.note, 600),
          ].filter(Boolean).join('\n')
        : clean(b.note, 1000) || null,
      consent_to_contact: true,
      source,
      lead_source: bookingRequest ? 'booking_form' : source,
      lead_score: scored.score,
      lead_level: scored.level,
      score_signals: scored.signals,
      customer_segment: understanding.segment,
      customer_traits: understanding.traits,
      voucher_code: voucherCode || null,
      voucher_status: voucherStatus,
      voucher_channel: voucherChannel,
      utm_source: utm.utm_source || 'direct',
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null,
      utm_content: utm.utm_content || null,
      utm_term: utm.utm_term || null,
    };

    failure.stage = 'insert_lead';
    const saveOptions = {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    };
    let saveResponse = await supabase('leads', saveOptions);

    if (!saveResponse.ok) {
      failure.status = saveResponse.status;
      failure.databaseCode = await supabaseErrorCode(saveResponse);

      if (['PGRST204', '42703'].includes(failure.databaseCode)) {
        console.error('[api/leads] Scoring columns unavailable; retrying without optional scoring fields', {
          databaseCode: failure.databaseCode,
        });
        const compatibleRow = { ...row };
        for (const column of SCORING_COLUMNS) delete compatibleRow[column];
        saveResponse = await supabase('leads', {
          ...saveOptions,
          body: JSON.stringify(compatibleRow),
        });
      }

      if (!saveResponse.ok) {
        failure.status = saveResponse.status;
        failure.databaseCode = await supabaseErrorCode(saveResponse);
        throw new Error('Supabase lead insert failed');
      }
    }

    failure.stage = 'read_insert_result';
    const payload = await saveResponse.json();
    const lead = Array.isArray(payload) ? payload[0] : payload;

    if (!lead?.lead_id) {
      throw new Error('Lead ID missing after save');
    }

    const notificationStatus = await notifyAndRecord({ ...row, lead_id: lead.lead_id });

    return send(res, 201, {
      lead_id: lead.lead_id,
      notification_status: notificationStatus,
    });
  } catch (error) {
    console.error('[api/leads] Request failed', {
      stage: failure.stage,
      status: failure.status,
      databaseCode: failure.databaseCode,
      errorCode: error?.code,
    });
    return send(res, 503, { error: 'Chưa thể ghi nhận yêu cầu. Vui lòng thử lại sau.' });
  }
}
