import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/consultations.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SECRET_KEY: 'k',
  N8N_LEAD_WEBHOOK_URL: 'https://n8n.test/lead', N8N_WEBHOOK_SECRET: 's',
  APP_ORIGIN: 'https://app.test',
};
const payload = (over = {}) => ({
  name: 'Lan Test', email: 'Lan@Example.test', selected_tour_id: 'ha-giang-loop',
  consent_to_contact: true, utm_source: 'facebook', utm_medium: 'paid_social',
  utm_campaign: 'summer_escape', ...over,
});

async function run(body, fetchMock, ip = '10.2.0.1') {
  const res = createResponse();
  await withEnv(ENV, () => withFetch(fetchMock, () => handler({
    method: 'POST', headers: { origin: ENV.APP_ORIGIN, 'x-forwarded-for': ip }, body,
  }, res)));
  return res;
}

test('creates a consented WARM consultation in Supabase and acknowledges the n8n request', async () => {
  let inserted;
  let notification;
  const res = await run(payload(), async (input, options = {}) => {
    const url = String(input);
    if (url.includes('request_id=eq.')) return json([]);
    if (url.includes('lead_source=eq.consultation_form')) return json([]);
    if (url.endsWith('/rest/v1/leads') && options.method === 'POST') {
      inserted = JSON.parse(options.body);
      return json([{ lead_id: inserted.lead_id, created_at: '2026-11-12T00:00:00Z' }], 201);
    }
    if (url === ENV.N8N_LEAD_WEBHOOK_URL) {
      assert.equal(options.headers['X-Automation-Secret'], 's');
      notification = JSON.parse(options.body);
      return json({ notification_sent: true, lead_id: notification.lead_id });
    }
    if (url.includes('/rest/v1/leads?lead_id=') && options.method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch ${url}`);
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.lead_priority, 'WARM');
  assert.equal(res.body.crm_status, 'NEW');
  assert.equal(res.body.notification_status, 'SENT');
  assert.equal(inserted.care_priority, 'WARM');
  assert.equal(inserted.lead_status, 'NEW');
  assert.equal(inserted.lead_source, 'consultation_form');
  assert.equal(inserted.travel_date, undefined);
  assert.equal(inserted.utm_source, 'facebook');
  assert.equal(inserted.utm_campaign, 'summer_escape');
  assert.equal(notification.booking_request, false);
  assert.equal(notification.capture_channel, 'consultation_form');
});

test('rejects consultation without consent before touching Supabase', async () => {
  const res = await run(payload({ consent_to_contact: false }), async () => { throw new Error('unexpected I/O'); }, '10.2.0.2');
  assert.equal(res.statusCode, 400);
});

test('does not create or notify a duplicate consultation for the same contact and tour', async () => {
  let calls = 0;
  const res = await run(payload(), async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes('request_id=eq.')) return json([]);
    if (url.includes('lead_source=eq.consultation_form')) return json([{ lead_id: 'existing', notification_status: 'SENT' }]);
    throw new Error('must not insert or notify');
  }, '10.2.0.3');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.duplicate, true);
  assert.equal(res.body.lead_id, 'existing');
  assert.equal(calls, 2);
});

test('keeps notification PENDING without a matching workflow acknowledgment', async () => {
  const res = await run(payload(), async (input, options = {}) => {
    const url = String(input);
    if (url.includes('request_id=eq.') || url.includes('lead_source=eq.consultation_form')) return json([]);
    if (url.endsWith('/rest/v1/leads') && options.method === 'POST') {
      const row = JSON.parse(options.body);
      return json([{ lead_id: row.lead_id }], 201);
    }
    if (url === ENV.N8N_LEAD_WEBHOOK_URL) return json({ status: 'ok' });
    throw new Error(`Unexpected fetch ${url}`);
  }, '10.2.0.4');
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.notification_status, 'PENDING');
});
