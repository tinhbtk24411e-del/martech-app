import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/leads.js';

test('persists server-computed lead score and customer traits before n8n acknowledgment', async () => {
  const savedEnvironment = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
    N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET,
  };
  const originalFetch = globalThis.fetch;
  const insertedLeads = [];
  let automationPayload;
  let simulateMissingScoringColumns = false;

  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-secret';
  process.env.N8N_WEBHOOK_URL = 'https://n8n.example.test/webhook';
  process.env.N8N_WEBHOOK_SECRET = 'automation-secret';

  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/leads?request_id=')) {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/rest/v1/leads') && options.method === 'POST') {
      const lead = JSON.parse(options.body);
      if (simulateMissingScoringColumns && 'score_signals' in lead) {
        return new Response(JSON.stringify({ code: 'PGRST204' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      insertedLeads.push(lead);
      return new Response(JSON.stringify([{ lead_id: 'lead-test-1' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/rest/v1/leads?lead_id=') && options.method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (url === process.env.N8N_WEBHOOK_URL) {
      automationPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ notification_sent: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const createResponse = () => ({
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader() {},
    end() {},
  });
  const response = createResponse();
  let fallbackResponse;

  try {
    await handler({
      method: 'POST',
      headers: { 'idempotency-key': 'lead-test-request', 'x-forwarded-for': '192.0.2.10' },
      body: {
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
        lead_score: 1,
        lead_level: 'COLD',
      },
    }, response);
    simulateMissingScoringColumns = true;
    fallbackResponse = createResponse();
    await handler({
      method: 'POST',
      headers: { 'idempotency-key': 'lead-test-fallback', 'x-forwarded-for': '192.0.2.11' },
      body: {
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
      },
    }, fallbackResponse);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.notification_status, 'SENT');
  assert.equal(insertedLeads[0].lead_score, 80);
  assert.equal(insertedLeads[0].lead_level, 'HOT');
  assert.equal(insertedLeads[0].customer_segment, 'family');
  assert.deepEqual(insertedLeads[0].customer_traits, ['family', 'resort']);
  assert.equal(automationPayload.lead_score, 80);
  assert.equal(automationPayload.notification_status, undefined);
  assert.equal(fallbackResponse.statusCode, 201);
  assert.equal('score_signals' in insertedLeads[1], false);
});
