import { clean, list, method, number, send, tours, utmFields } from './_shared.js';
import { scoreLead, understandCustomer } from './_scoring.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const SCORING_COLUMNS = ['score_signals', 'customer_segment', 'customer_traits'];

const supabase = async (endpoint, options = {}) => {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!base || !key) {
    const error = new Error('Supabase is not configured');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }

  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  return fetch(`${base.replace(/\/$/, '')}/rest/v1/${endpoint}`, { ...options, headers });
};

async function supabaseErrorCode(response) {
  try {
    const body = await response.clone().json();
    return typeof body.code === 'string' && /^[A-Z0-9]{1,12}$/i.test(body.code) ? body.code : undefined;
  } catch {
    return undefined;
  }
}

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
  const destination = clean(b.destination, 100);
  const duration = number(b.duration, 1, 60);
  const budget = number(b.budget, 0, 1_000_000_000);
  const partySize = number(b.party_size, 1, 30);
  const consent = b.consent_to_contact === true || b.consent_to_contact === 'true';
  const utm = normalizeUtm(b);
  const voucherCode = clean(b.voucher_code || '', 80);
  const voucherStatus = clean(b.voucher_status || 'PENDING', 30) || 'PENDING';
  const voucherChannel = clean(b.voucher_channel || 'email', 30) || 'email';
  const source = clean(b.source || b.lead_source || utm.utm_source || 'website', 60) || 'website';

  if (!name || (!explicitPhone && !explicitEmail) || !destination || !duration || budget === null || !partySize || !consent) {
    return send(res, 400, { error: 'Vui lòng điền đủ thông tin hợp lệ và đồng ý để chúng tôi liên hệ.' });
  }

  if (
    (explicitEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(explicitEmail)) ||
    (explicitPhone && explicitPhone.replace(/\D/g, '').length < 6)
  ) {
    return send(res, 400, { error: 'Email hoặc số điện thoại chưa hợp lệ.' });
  }

  const requestId = clean(req.headers['idempotency-key'] || b.request_id || '', 80) || crypto.randomUUID();

  const failure = { stage: 'load_tours', status: undefined, databaseCode: undefined };

  try {
    const active = await tours();
    const selected = b.selected_tour_id ? active.find((t) => String(t.id) === String(b.selected_tour_id)) : null;

    if (b.selected_tour_id && !selected) {
      return send(res, 400, { error: 'Tour được chọn không còn hợp lệ.' });
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

    failure.stage = 'check_duplicate';
    const existingResponse = await supabase(`leads?request_id=eq.${encodeURIComponent(requestId)}&select=lead_id,notification_status`);
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
      travel_date: clean(b.travel_date, 30) || null,
      interests: list(b.interests),
      selected_tour_id: selected?.id || null,
      selected_tour_name: selected?.name || null,
      lead_source: source,
      lead_status: selected ? 'HIGH_PRIORITY' : 'STANDARD',
      notification_status: 'PENDING',
      note: clean(b.note, 1000) || null,
      consent_to_contact: true,
      source,
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

    let notificationStatus = 'PENDING';

    if (process.env.N8N_WEBHOOK_URL) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let webhook;

      try {
        webhook = await fetch(process.env.N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Automation-Secret': process.env.N8N_WEBHOOK_SECRET || '',
          },
          signal: controller.signal,
          body: JSON.stringify({
            lead_id: lead.lead_id,
            name,
            contact,
            email: explicitEmail || null,
            phone: explicitPhone || null,
            zalo_phone: explicitZalo || null,
            destination,
            duration,
            budget,
            party_size: partySize,
            travel_date: row.travel_date,
            interests: row.interests,
            selected_tour_id: row.selected_tour_id,
            selected_tour_name: row.selected_tour_name,
            note: row.note,
            consent_to_contact: true,
            lead_source: row.lead_source,
            source: row.source,
            lead_score: row.lead_score,
            lead_level: row.lead_level,
            score_signals: row.score_signals,
            customer_segment: row.customer_segment,
            customer_traits: row.customer_traits,
            voucher_code: row.voucher_code,
            voucher_status: row.voucher_status,
            voucher_channel: row.voucher_channel,
            utm_source: row.utm_source,
            utm_medium: row.utm_medium,
            utm_campaign: row.utm_campaign,
            utm_content: row.utm_content,
            utm_term: row.utm_term,
          }),
        });
      } catch (error) {
        console.error('[api/leads] Notification webhook request failed', {
          errorCode: error?.name || 'UNKNOWN',
        });
      } finally {
        clearTimeout(timer);
      }

      if (webhook) {
        if (!webhook.ok) {
          console.error('[api/leads] Notification webhook returned an error', {
            status: webhook.status,
          });
        }
        const ackPayload = webhook.ok ? await webhook.json().catch(() => ({})) : {};
        const ack = ackPayload && typeof ackPayload === 'object' && !Array.isArray(ackPayload)
          ? ackPayload
          : {};
        const notificationSent = ack.notification_sent ?? ack.email_sent;
        if (notificationSent === true) {
          notificationStatus = 'SENT';
        } else if (notificationSent === false) {
          notificationStatus = 'FAILED';
        } else {
          console.error('[api/leads] Notification webhook response did not confirm delivery', {
            status: webhook.status,
          });
        }

        if (notificationStatus !== 'PENDING') {
          try {
            const updateResponse = await supabase(`leads?lead_id=eq.${encodeURIComponent(lead.lead_id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ notification_status: notificationStatus }),
            });
            if (!updateResponse.ok) {
              console.error('[api/leads] Notification status update failed', {
                status: updateResponse.status,
                databaseCode: await supabaseErrorCode(updateResponse),
              });
              notificationStatus = 'PENDING';
            }
          } catch (error) {
            console.error('[api/leads] Notification status update failed', {
              errorCode: error?.name || 'UNKNOWN',
            });
            notificationStatus = 'PENDING';
          }
        }
      }
    } else {
      console.error('[api/leads] Notification webhook is not configured');
    }

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
