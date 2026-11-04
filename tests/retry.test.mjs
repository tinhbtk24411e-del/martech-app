import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/retry-notifications.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  N8N_WEBHOOK_URL: 'https://n8n.example.test/webhook',
  N8N_BOOKING_WEBHOOK_URL: 'https://n8n.example.test/booking',
  N8N_WEBHOOK_SECRET: 's',
  CRON_SECRET: 'cron-secret',
};

test('retry job rejects callers without the cron secret', async () => {
  const res = createResponse();
  await withEnv(ENV, () => withFetch(async () => { throw new Error('no db access'); }, () =>
    handler({ method: 'GET', headers: {} }, res)));
  assert.equal(res.statusCode, 401);
});

test('retry job claims a pending lead, re-sends it, and records SENT', async () => {
  const pending = {
    lead_id: 'lead-pending-1', name: 'A', contact: 'a@example.test', destination: 'Hội An',
    duration: 3, budget: 4_000_000, party_size: 2, interests: [], notification_status: 'PENDING',
    notification_attempts: 0, lead_score: 35, lead_level: 'COLD',
  };
  const seen = { claim: 0, webhook: 0, statusUpdates: [] };

  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('notification_status=in.(PENDING,FAILED)')) return json([pending]);
    if (url.includes('booking_confirmation_status=in.(PENDING,FAILED)') && !options.method) return json([]);
    if (url.includes('booking_confirmation_status=eq.PROCESSING') && !options.method) return json([]);
    if (url.includes('notification_attempts=eq.0') && options.method === 'PATCH') {
      seen.claim += 1;
      return json([{ lead_id: pending.lead_id }]);
    }
    if (url === ENV.N8N_WEBHOOK_URL) {
      seen.webhook += 1;
      return json({ notification_sent: true });
    }
    if (options.method === 'PATCH') {
      seen.statusUpdates.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createResponse();
  await withEnv(ENV, () => withFetch(mock, () =>
    handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret' } }, res)));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 1);
  assert.equal(seen.claim, 1);
  assert.equal(seen.webhook, 1);
  assert.deepEqual(seen.statusUpdates.at(-1), { notification_status: 'SENT' });
});

test('retry job sends pending booking confirmation email after Sales booking', async () => {
  const pending = {
    lead_id: 'booking-pending-1',
    lead_source: 'booking_form',
    lead_status: 'BOOKED',
    booking_confirmation_status: 'PENDING',
    booking_confirmation_attempts: 0,
    notification_status: 'SENT',
    email: 'customer@example.test',
    name: 'Customer',
  };
  const seen = { claim: 0, webhookPayloads: [], statusUpdates: [] };
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('notification_status=in.(PENDING,FAILED)')) return json([]);
    if (url.includes('booking_confirmation_status=in.(PENDING,FAILED)') && !options.method) return json([pending]);
    if (url.includes('booking_confirmation_status=eq.PROCESSING') && !options.method) return json([]);
    if (url.includes('booking_confirmation_status=in.(PENDING,FAILED)') && options.method === 'PATCH') {
      seen.claim += 1;
      return json([{ ...pending, booking_confirmation_attempts: 1 }]);
    }
    if (url === ENV.N8N_BOOKING_WEBHOOK_URL) {
      seen.webhookPayloads.push(JSON.parse(options.body));
      return json({ customer_email_sent: true });
    }
    if (options.method === 'PATCH') {
      seen.statusUpdates.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createResponse();
  await withEnv(ENV, () => withFetch(mock, () =>
    handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret' } }, res)));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.booking_confirmation_sent, 1);
  assert.equal(seen.claim, 1);
  assert.equal(seen.webhookPayloads[0].booking_event, 'sales_confirmed');
  assert.deepEqual(seen.statusUpdates.at(-1), { booking_confirmation_status: 'SENT' });
});
