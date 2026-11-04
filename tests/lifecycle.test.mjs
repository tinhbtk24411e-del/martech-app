import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/lead-status.js';
import { canTransition } from '../api/_shared.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const LEAD_ID = '6f1d2c3a-1111-4222-8333-444455556666';
const ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  SALES_UPDATE_SECRET: 'sales-secret',
  N8N_BOOKING_WEBHOOK_URL: 'https://n8n.example.test/booking',
  N8N_WEBHOOK_SECRET: 'automation-secret',
};

test('state machine allows the sales path and blocks skipping steps', () => {
  assert.equal(canTransition('NEW', 'CONTACTED'), true);
  assert.equal(canTransition('CONTACTED', 'QUOTED'), true);
  assert.equal(canTransition('QUOTED', 'BOOKED'), true);
  assert.equal(canTransition('NEW', 'BOOKED'), false);
  assert.equal(canTransition('BOOKED', 'LOST'), false);
  assert.equal(canTransition('LOST', 'CONTACTED'), true);
});

function run(headers, body, mock) {
  const res = createResponse();
  return withEnv(ENV, () => withFetch(mock, () => handler({ method: 'POST', headers, body }, res))).then(() => res);
}

test('rejects requests without the sales secret', async () => {
  const res = await run({}, { lead_id: LEAD_ID, lead_status: 'CONTACTED' }, async () => {
    throw new Error('must not reach database');
  });
  assert.equal(res.statusCode, 401);
});

test('moves a lead from NEW to CONTACTED with compare-and-set update', async () => {
  let patchUrl = '';
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (options.method === 'PATCH') {
      patchUrl = url;
      return json([{ lead_id: LEAD_ID, lead_status: 'CONTACTED' }]);
    }
    return json([{ lead_status: 'NEW' }]);
  };
  const res = await run({ 'x-sales-secret': 'sales-secret' }, { lead_id: LEAD_ID, lead_status: 'contacted', sales_note: 'Đã gọi khách' }, mock);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.lead_status, 'CONTACTED');
  assert.ok(patchUrl.includes('lead_status=eq.NEW'), 'update must be conditional on the status read');
});

test('sends booking confirmation to the customer only after Sales marks it BOOKED', async () => {
  const booking = {
    lead_id: LEAD_ID,
    lead_status: 'QUOTED',
    lead_source: 'booking_form',
    booking_confirmation_status: 'NOT_READY',
    booking_confirmation_attempts: 0,
    email: 'customer@example.test',
    name: 'Test customer',
    destination: 'Đà Nẵng',
    selected_tour_name: 'Đà Nẵng - Hội An',
    budget: 7_600_000,
    party_size: 2,
  };
  const seen = { patches: [], webhookPayloads: [] };
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/leads?lead_id=') && !options.method) return json([booking]);
    if (options.method === 'PATCH' && url.includes('booking_confirmation_status=in.')) {
      return json([{
        ...booking,
        lead_status: 'BOOKED',
        booking_confirmation_status: 'PENDING',
        booking_confirmation_attempts: 1,
      }]);
    }
    if (options.method === 'PATCH' && url.includes('lead_status=eq.QUOTED')) {
      const body = JSON.parse(options.body);
      seen.patches.push(body);
      return json([{ ...booking, ...body }]);
    }
    if (options.method === 'PATCH') {
      seen.patches.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    if (url === ENV.N8N_BOOKING_WEBHOOK_URL) {
      seen.webhookPayloads.push(JSON.parse(options.body));
      return json({ customer_email_sent: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = await run(
    { 'x-sales-secret': 'sales-secret' },
    { lead_id: LEAD_ID, lead_status: 'BOOKED' },
    mock,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.lead_status, 'BOOKED');
  assert.equal(res.body.booking_confirmation_status, 'SENT');
  assert.deepEqual(seen.patches[0], {
    lead_status: 'BOOKED',
    booking_confirmation_status: 'PENDING',
  });
  assert.equal(seen.webhookPayloads.length, 1);
  assert.equal(seen.webhookPayloads[0].booking_event, 'sales_confirmed');
  assert.equal(seen.webhookPayloads[0].booking_status, 'CONFIRMED');
  assert.equal(seen.webhookPayloads[0].customer_email_confirmation_required, true);
  assert.equal(seen.webhookPayloads[0].sales_email_notification_required, false);
  assert.equal(seen.webhookPayloads[0].email, 'customer@example.test');
  assert.deepEqual(seen.patches.at(-1), { booking_confirmation_status: 'SENT' });
});

test('does not resend the customer confirmation when Sales repeats BOOKED', async () => {
  const booking = {
    lead_id: LEAD_ID,
    lead_status: 'BOOKED',
    lead_source: 'booking_form',
    booking_confirmation_status: 'SENT',
  };
  let webhookCalls = 0;
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/rest/v1/leads?lead_id=') && !options.method) return json([booking]);
    if (options.method === 'PATCH' && url.includes('lead_status=eq.BOOKED')) {
      return json([{ ...booking, ...JSON.parse(options.body) }]);
    }
    if (url === ENV.N8N_BOOKING_WEBHOOK_URL) {
      webhookCalls += 1;
      return json({ customer_email_sent: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = await run(
    { 'x-sales-secret': 'sales-secret' },
    { lead_id: LEAD_ID, lead_status: 'BOOKED' },
    mock,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(webhookCalls, 0);
});

test('returns 409 for an illegal jump and 400 for an unknown status', async () => {
  const mock = async () => json([{ lead_status: 'NEW' }]);
  const illegal = await run({ 'x-sales-secret': 'sales-secret' }, { lead_id: LEAD_ID, lead_status: 'BOOKED' }, mock);
  assert.equal(illegal.statusCode, 409);
  const unknown = await run({ 'x-sales-secret': 'sales-secret' }, { lead_id: LEAD_ID, lead_status: 'HIGH_PRIORITY' }, mock);
  assert.equal(unknown.statusCode, 400);
});
