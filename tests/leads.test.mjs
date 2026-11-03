import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/leads.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret',
  N8N_WEBHOOK_URL: 'https://n8n.example.test/webhook',
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

function supabaseMock({ insertedLeads, automationPayloads, failScoringColumns = false }) {
  return async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/leads?request_id=')) return json([]);
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
    if (url === ENV.N8N_WEBHOOK_URL) {
      automationPayloads.push(JSON.parse(options.body));
      return json({ notification_sent: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function submit(ip, key, body) {
  const res = createResponse();
  return handler({ method: 'POST', headers: { 'idempotency-key': key, 'x-forwarded-for': ip }, body }, res).then(() => res);
}

test('persists server score, NEW status, and sends automation payload', async () => {
  const insertedLeads = [];
  const automationPayloads = [];
  await withEnv(ENV, () => withFetch(supabaseMock({ insertedLeads, automationPayloads }), async () => {
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
  await withEnv(ENV, () => withFetch(supabaseMock({ insertedLeads, automationPayloads }), async () => {
    const first = await submit('192.0.2.20', 'resubmit-1', leadBody());
    const second = await submit('192.0.2.21', 'resubmit-2', leadBody({ note: 'bấm gửi lại' }));
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.lead_id, first.body.lead_id);
    assert.equal(insertedLeads.length, 1);
    assert.equal(automationPayloads.length, 1, 'duplicate must not re-notify Sales');
  }));
});

test('keeps lead PENDING when n8n does not confirm delivery', async () => {
  const insertedLeads = [];
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url === ENV.N8N_WEBHOOK_URL) return json({ status: 'ok' });
    return supabaseMock({ insertedLeads, automationPayloads: [] })(input, options);
  };
  await withEnv(ENV, () => withFetch(mock, async () => {
    const res = await submit('192.0.2.30', 'pending-case', leadBody());
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'PENDING');
  }));
});
