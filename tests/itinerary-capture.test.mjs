import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/itinerary-capture.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SECRET_KEY: 'k',
  N8N_NURTURE_WEBHOOK_URL: 'https://n8n.test/nurture', N8N_WEBHOOK_SECRET: 's',
  NURTURE_SECRET: 'nsec', APP_ORIGIN: 'https://app.test',
  VERCEL_URL: 'martech-8g21wc5yx-tinhbui.vercel.app',
};

const body = (over = {}) => ({
  name: 'Lan Test', email: 'Lan@Example.test', destination: 'Đà Lạt', duration_days: 3,
  budget: 3000000, party_size: 2, plan_summary: 'Ngày 1: Hồ Xuân Hương', consent_to_contact: true, ...over,
});

function run(ip, payload, mock, origin) {
  const res = createResponse();
  return withEnv(ENV, () => withFetch(mock, () =>
    handler({
      method: 'POST',
      headers: {
        'x-forwarded-for': ip,
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      body: payload,
    }, res)))
    .then(() => res);
}

function mockFor({ inserted, webhookAck = { email_sent: true }, existing = [] }) {
  const patches = [];
  const webhookPayloads = [];
  const fn = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/leads?contact=')) return json(existing);
    if (url.endsWith('/rest/v1/leads') && options.method === 'POST') {
      const row = JSON.parse(options.body);
      inserted.push(row);
      return json([{ lead_id: row.lead_id }], 201);
    }
    if (url.includes('/rest/v1/leads?lead_id=') && options.method === 'PATCH') {
      patches.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    if (url === ENV.N8N_NURTURE_WEBHOOK_URL) {
      webhookPayloads.push(JSON.parse(options.body));
      return json(webhookAck);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { fn, patches, webhookPayloads };
}

test('valid request creates a COLD nurture lead and delivers the itinerary', async () => {
  const inserted = [];
  const m = mockFor({ inserted });
  const res = await run('10.1.0.1', body(), m.fn);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.notification_status, 'SENT');
  assert.equal(inserted[0].care_priority, 'COLD');
  assert.equal(inserted[0].lead_source, 'itinerary_capture');
  assert.match(inserted[0].request_id, /^[0-9a-f-]{36}$/i);
  assert.equal(inserted[0].contact, 'lan@example.test', 'email is normalised to lowercase');
  assert.equal(inserted[0].nurture_step, 0);
  assert.equal(m.webhookPayloads[0].action, 'itinerary_delivery');
  assert.equal(m.webhookPayloads[0].step, 0);
  assert.match(m.webhookPayloads[0].plan_summary, /Hồ Xuân Hương/);
  assert.equal(m.patches.at(-1).notification_status, 'SENT');
});

test('allows the current Vercel deployment origin but rejects other origins', async () => {
  const inserted = [];
  const m = mockFor({ inserted });
  const deploymentOrigin = `https://${ENV.VERCEL_URL}`;
  const accepted = await run('10.1.0.6', body(), m.fn, deploymentOrigin);
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.headers['access-control-allow-origin'], deploymentOrigin);

  const rejected = await run('10.1.0.7', body(), async () => {
    throw new Error('must not reach the database');
  }, 'https://attacker.example');
  assert.equal(rejected.statusCode, 403);
});

test('missing consent is rejected before touching the database', async () => {
  const res = await run('10.1.0.2', body({ consent_to_contact: false }), async () => { throw new Error('no db'); });
  assert.equal(res.statusCode, 400);
});

test('invalid email is rejected', async () => {
  const res = await run('10.1.0.3', body({ email: 'not-an-email' }), async () => { throw new Error('no db'); });
  assert.equal(res.statusCode, 400);
});

test('same email and destination within 24h returns duplicate without a new lead', async () => {
  const inserted = [];
  const m = mockFor({ inserted, existing: [{ lead_id: 'old-lead', notification_status: 'SENT' }] });
  const res = await run('10.1.0.4', body(), m.fn);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.duplicate, true);
  assert.equal(inserted.length, 0);
  assert.equal(m.webhookPayloads.length, 0, 'must not re-send the itinerary');
});

test('unacknowledged delivery keeps the lead PENDING instead of claiming success', async () => {
  const inserted = [];
  const m = mockFor({ inserted, webhookAck: { email_sent: false } });
  const res = await run('10.1.0.5', body(), m.fn);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.notification_status, 'PENDING');
  assert.equal(m.patches.length, 0);
});
