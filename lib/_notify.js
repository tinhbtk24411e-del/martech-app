import { supabase } from './_supabase.js';

const TIMEOUT_MS = 15_000;

export function automationPayload(row) {
  return {
    lead_id: row.lead_id,
    created_at: row.created_at || null,
    booking_request: true,
    booking_status: 'AWAITING_SALES_CONFIRMATION',
    booking_price_per_person: row.budget,
    customer_email_confirmation_required: false,
    customer_booking_request_email_required: true,
    sales_email_notification_required: true,
    name: row.name,
    contact: row.contact,
    email: row.email || null,
    phone: row.phone || null,
    zalo_phone: row.zalo_phone || null,
    destination: row.destination,
    duration: row.duration,
    budget: row.budget,
    party_size: row.party_size,
    travel_date: row.travel_date || null,
    interests: row.interests || [],
    selected_tour_id: row.selected_tour_id || null,
    selected_tour_name: row.selected_tour_name || null,
    note: row.note || null,
    consent_to_contact: true,
    lead_source: row.lead_source,
    source: row.source,
    lead_score: row.lead_score,
    lead_level: row.lead_level,
    care_priority: row.care_priority || null,
    lead_priority: row.lead_priority || 'HIGH',
    score_signals: row.score_signals,
    customer_segment: row.customer_segment,
    customer_traits: row.customer_traits,
    voucher_code: row.voucher_code || null,
    voucher_status: row.voucher_status,
    voucher_channel: row.voucher_channel,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    utm_content: row.utm_content,
    utm_term: row.utm_term,
  };
}

// Returns 'SENT' | 'FAILED' | 'PENDING'. Only n8n's explicit acknowledgment
// produces SENT or FAILED; anything else stays PENDING for the retry job.
export async function deliverToAutomation(lead) {
  const url = process.env.N8N_BOOKING_WEBHOOK_URL;
  if (!url) {
    console.error('[notify] Automation webhook is not configured', {
      workflow: 'booking',
    });
    return 'PENDING';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let webhook;

  try {
    webhook = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Secret': process.env.N8N_WEBHOOK_SECRET || '',
      },
      signal: controller.signal,
      body: JSON.stringify(automationPayload(lead)),
    });
  } catch (error) {
    console.error('[notify] Notification webhook request failed', { errorCode: error?.name || 'UNKNOWN' });
    return 'PENDING';
  } finally {
    clearTimeout(timer);
  }

  if (!webhook.ok) {
    console.error('[notify] Notification webhook returned an error', { status: webhook.status });
    return 'PENDING';
  }

  const ack = await webhook.json().catch(() => ({}));
  const body = ack && typeof ack === 'object' && !Array.isArray(ack) ? ack : {};
  if (body.sales_email_sent === true && body.customer_request_email_sent === true) return 'SENT';
  if (body.sales_email_sent === false || body.customer_request_email_sent === false) return 'FAILED';

  console.error('[notify] Booking request emails were not confirmed', { status: webhook.status });
  return 'PENDING';
}

// Consultation leads use the existing non-booking n8n workflow. They are
// persisted in Supabase first and only marked SENT on an explicit workflow ack.
export async function deliverLeadCapture(lead) {
  const url = process.env.N8N_LEAD_WEBHOOK_URL;
  if (!url) return 'PENDING';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Secret': process.env.N8N_WEBHOOK_SECRET || '',
      },
      signal: controller.signal,
      body: JSON.stringify({
        ...lead,
        booking_request: false,
        capture_channel: 'consultation_form',
        consent_to_contact: lead.consent_to_contact === true,
      }),
    });
    if (!response.ok) return 'PENDING';
    const ack = await response.json().catch(() => ({}));
    if (ack?.notification_sent === true && ack?.lead_id === lead.lead_id) return 'SENT';
    if (ack?.notification_sent === false) return 'FAILED';
    return 'PENDING';
  } catch {
    return 'PENDING';
  } finally {
    clearTimeout(timer);
  }
}

export async function deliverBookingConfirmation(lead) {
  const url = process.env.N8N_BOOKING_WEBHOOK_URL;
  if (!url) {
    console.error('[notify] Booking webhook is not configured', { workflow: 'booking_confirmation' });
    return 'PENDING';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let webhook;

  try {
    webhook = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Automation-Secret': process.env.N8N_WEBHOOK_SECRET || '',
      },
      signal: controller.signal,
      body: JSON.stringify({
        ...automationPayload(lead),
        booking_event: 'sales_confirmed',
        booking_status: 'CONFIRMED',
        customer_email_confirmation_required: true,
        sales_email_notification_required: false,
      }),
    });
  } catch (error) {
    console.error('[notify] Booking confirmation webhook request failed', {
      errorCode: error?.name || 'UNKNOWN',
    });
    return 'PENDING';
  } finally {
    clearTimeout(timer);
  }

  if (!webhook.ok) {
    console.error('[notify] Booking confirmation webhook returned an error', { status: webhook.status });
    return 'PENDING';
  }

  const ack = await webhook.json().catch(() => ({}));
  const body = ack && typeof ack === 'object' && !Array.isArray(ack) ? ack : {};
  if (body.customer_email_sent === true) return 'SENT';
  if (body.customer_email_sent === false) return 'FAILED';

  console.error('[notify] Booking confirmation email was not confirmed', { status: webhook.status });
  return 'PENDING';
}

export async function claimBookingConfirmation(lead, recoverStale = false) {
  const attempts = Number(lead.booking_confirmation_attempts || 0);
  const statusFilter = recoverStale
    ? `&booking_confirmation_status=eq.PROCESSING` +
      `&last_booking_confirmation_at=eq.${encodeURIComponent(lead.last_booking_confirmation_at)}`
    : '&booking_confirmation_status=in.(PENDING,FAILED)';
  const response = await supabase(
    `leads?lead_id=eq.${encodeURIComponent(lead.lead_id)}` +
      `&lead_status=eq.BOOKED${statusFilter}` +
      `&booking_confirmation_attempts=eq.${attempts}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        booking_confirmation_status: 'PROCESSING',
        booking_confirmation_attempts: attempts + 1,
        last_booking_confirmation_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    console.error('[notify] Booking confirmation claim failed', { status: response.status });
    return null;
  }

  const claimed = await response.json();
  return Array.isArray(claimed) ? claimed[0] || false : false;
}

export async function updateBookingConfirmationStatus(leadId, status) {
  try {
    const response = await supabase(`leads?lead_id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_confirmation_status: status }),
    });
    if (!response.ok) {
      console.error('[notify] Booking confirmation status update failed', { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error('[notify] Booking confirmation status update failed', {
      errorCode: error?.name || 'UNKNOWN',
    });
    return false;
  }
}

export async function updateNotificationStatus(leadId, status) {
  try {
    const response = await supabase(`leads?lead_id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification_status: status }),
    });
    if (!response.ok) {
      console.error('[notify] Notification status update failed', { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error('[notify] Notification status update failed', { errorCode: error?.name || 'UNKNOWN' });
    return false;
  }
}
