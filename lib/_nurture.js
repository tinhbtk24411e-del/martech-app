import crypto from 'node:crypto';

// Nurture plan: only leads that are NOT yet owned by Sales get automated messages.
// HOT (booking requests) go straight to Sales and are not nurtured.
export const NURTURE_PLAN = {
  HOT: [],
  WARM: [
    { step: 1, day: 1, action: 'tour_suggestions' },
    { step: 2, day: 5, action: 'trip_checklist' },
  ],
  COLD: [
    { step: 1, day: 1, action: 'tour_suggestions' },
    { step: 2, day: 3, action: 'destination_guide' },
    { step: 3, day: 7, action: 'intent_check' },
    { step: 4, day: 14, action: 'close_file' },
  ],
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Decides whether a lead should receive its next nurture message now.
// Pure function: no I/O, so the rules can be tested directly.
export function nextNurtureStep(lead, now = Date.now()) {
  if (lead.lead_status !== 'NEW') return { due: false, reason: 'sales_owned' };
  if (lead.nurture_opt_out === true) return { due: false, reason: 'opted_out' };
  if (lead.consent_to_contact !== true) return { due: false, reason: 'no_consent' };

  const plan = NURTURE_PLAN[lead.care_priority] || [];
  const current = Number(lead.nurture_step || 0);
  const next = plan.find((s) => s.step === current + 1);
  if (!next) return { due: false, reason: 'plan_complete' };

  const createdAt = new Date(lead.created_at).getTime();
  if (!Number.isFinite(createdAt)) return { due: false, reason: 'invalid_created_at' };

  const dueAt = createdAt + next.day * DAY_MS;
  if (now < dueAt) return { due: false, reason: 'not_yet', due_at: new Date(dueAt).toISOString() };
  return { due: true, step: next.step, action: next.action };
}

export function signOptOut(leadId, secret) {
  return crypto.createHmac('sha256', secret).update(`optout:${leadId}`).digest('base64url');
}

export function verifyOptOut(leadId, sig, secret) {
  if (!secret || !leadId || typeof sig !== 'string' || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signOptOut(leadId, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Sends one nurture message through n8n. n8n renders the email for the action
// and must acknowledge with { email_sent: true } only after the email was accepted.
export async function deliverNurture(lead, decision, env = process.env) {
  const url = env.N8N_NURTURE_WEBHOOK_URL;
  if (!url) return false;
  const origin = (env.APP_ORIGIN || '').replace(/\/$/, '');
  const sig = signOptOut(lead.lead_id, env.NURTURE_SECRET || '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Automation-Secret': env.N8N_WEBHOOK_SECRET || '' },
      signal: controller.signal,
      body: JSON.stringify({
        lead_id: lead.lead_id,
        step: decision.step,
        action: decision.action,
        care_priority: lead.care_priority,
        customer_segment: lead.customer_segment || 'general',
        name: lead.name,
        email: lead.email,
        destination: lead.destination,
        selected_tour_name: lead.selected_tour_name || null,
        plan_summary: lead.plan_summary || null,
        budget: lead.budget ?? null,
        party_size: lead.party_size ?? null,
        opt_out_url: `${origin}/api/optout?lead_id=${encodeURIComponent(lead.lead_id)}&sig=${sig}`,
      }),
    });
    if (!response.ok) return false;
    const ack = await response.json().catch(() => ({}));
    return ack?.email_sent === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
