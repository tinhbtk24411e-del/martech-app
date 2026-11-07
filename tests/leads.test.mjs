import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/leads.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret',
  N8N_WEBHOOK_URL: 'https://n8n.example.test/webhook',
  N8N_BOOKING_WEBHOOK_URL: 'https://n8n.example.test/webhook/booking',
  N8N_WEBHOOK_SECRET: 'automation-secret',
};

function leadBody(overrides = {}) {
  return {
    name: 'Test Lead',
    email: 'lead@example.test',
    destination: 'Đà Nẵng',
    duration: 4,
    budget: 5_000_000,
    party_size: 2,
    interests: ['Gia đình'],
    selected_tour_id: 'da-nang-hoi-an',
    consent_to_contact: true,
    engagement: { tour_views: 3, return_visit: true },
    ...overrides,
  };
}

function supabaseMock({
  insertedLeads,
  automationPayloads,
  visitorEvents = [],
  automationUrls = [],
  failScoringColumns = false,
  automationAck = { notification_sent: true },
}) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/leads?request_id=')) return json([]);
    if (url.includes('/rest/v1/rpc/record_website_visitor')) {
      visitorEvents.push(JSON.parse(options.body));
      return json(null);
    }
    if (url.includes('/rest/v1/leads?contact=')) {
      const contact = decodeURIComponent(url.match(/contact=eq\.([^&]+)/)[1]);
      const destination = decodeURIComponent(url.match(/destination=eq\.([^&]+)/)[1]);
      const match = insertedLeads.find((l) => l.contact === contact && l.destination === destination);
      return json(match ? [{ lead_id: match.lead_id, notification_status: 'SENT' }] : []);
    }
    if (url.endsWith('/rest/v1/leads') && options.method === 'POST') {
      const lead = JSON.parse(options.body);
      if (failScoringColumns && 'score_signals' in lead) return json({ code: 'PGRST204' }, 400);
      insertedLeads.push(lead);
      return json([{ lead_id: lead.lead_id }], 201);
    }
    if (url.includes('/rest/v1/leads?lead_id=') && options.method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (url === ENV.N8N_WEBHOOK_URL || url === ENV.N8N_BOOKING_WEBHOOK_URL) {
      automationUrls.push(url);
      automationPayloads.push(JSON.parse(options.body));
      return json(automationAck);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function submit(ip, key, body) {
  const res = createResponse();
  return handler({ method: 'POST', headers: { 'idempotency-key': key, 'x-forwarded-for': ip }, body }, res).then(() => res);
}

test('upgrades a tracked visitor to HIGH when a consultation form is saved', async () => {
  const insertedLeads = [];
  const visitorEvents = [];
  const automationPayloads = [];
  const res = await withEnv(ENV, () => withFetch(supabaseMock({
    insertedLeads,
    automationPayloads,
    visitorEvents,
  }), () => submit('192.0.2.12', 'tracked-high-priority', leadBody({
    visitor_id: '6f1d2c3a-1111-4222-8333-444455556666',
    utm_source: 'instagram',
    utm_medium: 'paid_social',
    utm_campaign: 'summer_sale',
  }))));

  assert.equal(res.statusCode, 201);
  assert.equal(insertedLeads[0].lead_priority, 'HIGH');
  assert.equal(insertedLeads[0].visitor_id, '6f1d2c3a-1111-4222-8333-444455556666');
  assert.equal(automationPayloads[0].lead_priority, 'HIGH');
  assert.deepEqual(visitorEvents[0], {
    p_visitor_id: '6f1d2c3a-1111-4222-8333-444455556666',
    p_event: 'consultation_submitted',
    p_utm_source: 'instagram',
    p_utm_medium: 'paid_social',
    p_utm_campaign: 'summer_sale',
    p_utm_content: null,
    p_utm_term: null,
    p_lead_id: insertedLeads[0].lead_id,
  });
});

test('persists server score, NEW status, and sends automation payload', async () => {
  const insertedLeads = [];
  const automationPayloads = [];
  const automationUrls = [];
  await withEnv(ENV, () => withFetch(supabaseMock({ insertedLeads, automationPayloads, automationUrls }), async () => {
    const res = await submit('192.0.2.10', 'lead-test-request', leadBody({ lead_score: 1, lead_level: 'COLD' }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'SENT');
    assert.equal(insertedLeads[0].lead_score, 80);
    assert.equal(insertedLeads[0].lead_level, 'HOT');
    assert.equal(insertedLeads[0].lead_status, 'NEW');
    assert.equal(insertedLeads[0].customer_segment, 'family');
    assert.deepEqual(insertedLeads[0].customer_traits, ['family', 'resort']);
    assert.equal(automationPayloads[0].lead_score, 80);
    assert.equal(automationPayloads[0].notification_status, undefined);
    assert.deepEqual(automationUrls, [ENV.N8N_WEBHOOK_URL]);
  }));
});

test('falls back to compatible insert when scoring columns are missing', async () => {
  const insertedLeads = [];
  await withEnv(ENV, () => withFetch(supabaseMock({ insertedLeads, automationPayloads: [], failScoringColumns: true }), async () => {
    const res = await submit('192.0.2.11', 'lead-test-fallback', leadBody());
    assert.equal(res.statusCode, 201);
    assert.equal('score_signals' in insertedLeads[0], false);
  }));
});

test('does not create a second lead for the same contact and destination within 24h', async () => {
  const insertedLeads = [];
  const automationPayloads = [];
  const automationUrls = [];
  const visitorEvents = [];
  await withEnv(ENV, () => withFetch(supabaseMock({ insertedLeads, automationPayloads, visitorEvents }), async () => {
    const first = await submit('192.0.2.20', 'resubmit-1', leadBody());
    const second = await submit('192.0.2.21', 'resubmit-2', leadBody({
      note: 'bấm gửi lại',
      visitor_id: '6f1d2c3a-1111-4222-8333-444455556666',
    }));
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.lead_id, first.body.lead_id);
    assert.equal(insertedLeads.length, 1);
    assert.equal(automationPayloads.length, 1, 'duplicate must not re-notify Sales');
    assert.equal(visitorEvents[0].p_event, 'consultation_submitted');
  }));
});

test('keeps lead PENDING when n8n does not confirm delivery', async () => {
  const insertedLeads = [];
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url === ENV.N8N_WEBHOOK_URL || url === ENV.N8N_BOOKING_WEBHOOK_URL) return json({ status: 'ok' });
    return supabaseMock({ insertedLeads, automationPayloads: [] })(input, options);
  };
  await withEnv(ENV, () => withFetch(mock, async () => {
    const res = await submit('192.0.2.30', 'pending-case', leadBody());
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'PENDING');
  }));
});

test('stores booking details, notifies Sales, and defers the customer confirmation email', async () => {
  const insertedLeads = [];
  const automationPayloads = [];
  const automationUrls = [];
  const departure = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ack = { sales_email_sent: true };
  await withEnv(ENV, () => withFetch(supabaseMock({
    insertedLeads,
    automationPayloads,
    automationUrls,
    automationAck: ack,
  }), async () => {
    const res = await submit('192.0.2.40', 'booking-test', leadBody({
      booking_request: true,
      email: 'booker@example.test',
      travel_date: departure,
      budget: 1,
      destination: 'Sai điểm đến',
      duration: 1,
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'SENT');
    assert.equal(insertedLeads[0].lead_source, 'booking_form');
    assert.equal(insertedLeads[0].lead_status, 'NEW');
    assert.equal(insertedLeads[0].destination, 'Đà Nẵng');
    assert.equal(insertedLeads[0].duration, 4);
    assert.equal(insertedLeads[0].budget, 7_600_000);
    assert.equal(insertedLeads[0].travel_date, departure);
    assert.match(insertedLeads[0].note, /Chờ Sales xác nhận/);
    assert.equal(automationPayloads[0].booking_request, true);
    assert.equal(automationPayloads[0].booking_status, 'AWAITING_SALES_CONFIRMATION');
    assert.equal(automationPayloads[0].booking_price_per_person, 7_600_000);
    assert.equal(automationPayloads[0].customer_email_confirmation_required, false);
    assert.equal(automationPayloads[0].sales_email_notification_required, true);
    assert.equal(automationPayloads[0].booking_event, undefined);
    assert.deepEqual(automationUrls, [ENV.N8N_BOOKING_WEBHOOK_URL]);
  }));
});

test('routes booking requests to the dedicated booking webhook', async () => {
  const insertedLeads = [];
  const webhookUrls = [];
  const departure = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url === ENV.N8N_WEBHOOK_URL || url === ENV.N8N_BOOKING_WEBHOOK_URL) {
      webhookUrls.push(url);
      return json({ customer_email_sent: true, sales_email_sent: true });
    }
    return supabaseMock({ insertedLeads, automationPayloads: [] })(input, options);
  };

  await withEnv(ENV, () => withFetch(mock, async () => {
    const res = await submit('192.0.2.44', 'booking-dedicated-webhook', leadBody({
      booking_request: true,
      travel_date: departure,
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'SENT');
    assert.deepEqual(webhookUrls, [ENV.N8N_BOOKING_WEBHOOK_URL]);
  }));
});

test('does not confirm booking emails when n8n only acknowledges a generic notification', async () => {
  const insertedLeads = [];
  const automationPayloads = [];
  const departure = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await withEnv(ENV, () => withFetch(supabaseMock({
    insertedLeads,
    automationPayloads,
    automationAck: { notification_sent: true },
  }), async () => {
    const res = await submit('192.0.2.41', 'booking-pending', leadBody({
      booking_request: true,
      travel_date: departure,
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'PENDING');
  }));
});

test('requires a valid email, selected tour, and future date for booking requests', async () => {
  const invalidDate = await submit('192.0.2.42', 'booking-invalid-date', leadBody({
    booking_request: true,
    travel_date: 'not-a-date',
  }));
  assert.equal(invalidDate.statusCode, 400);

  const missingEmail = await submit('192.0.2.43', 'booking-missing-email', leadBody({
    booking_request: true,
    email: '',
    phone: '0909123456',
    travel_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  }));
  assert.equal(missingEmail.statusCode, 400);
});
