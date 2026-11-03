import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/lead-status.js';
import { canTransition } from '../api/_shared.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const LEAD_ID = '6f1d2c3a-1111-4222-8333-444455556666';
const ENV = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'k', SALES_UPDATE_SECRET: 'sales-secret' };

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

test('returns 409 for an illegal jump and 400 for an unknown status', async () => {
  const mock = async () => json([{ lead_status: 'NEW' }]);
  const illegal = await run({ 'x-sales-secret': 'sales-secret' }, { lead_id: LEAD_ID, lead_status: 'BOOKED' }, mock);
  assert.equal(illegal.statusCode, 409);
  const unknown = await run({ 'x-sales-secret': 'sales-secret' }, { lead_id: LEAD_ID, lead_status: 'HIGH_PRIORITY' }, mock);
  assert.equal(unknown.statusCode, 400);
});
