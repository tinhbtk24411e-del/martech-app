import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/sales-bookings.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret',
  SALES_UPDATE_SECRET: 'sales-secret',
};

function run(headers, mock) {
  const res = createResponse();
  return withEnv(ENV, () => withFetch(mock, () => handler({ method: 'GET', headers }, res))).then(() => res);
}

test('requires Sales authorization before reading booking contact data', async () => {
  const res = await run({}, async () => {
    throw new Error('must not reach Supabase');
  });
  assert.equal(res.statusCode, 401);
});

test('returns only recent booking rows to an authorized Sales user', async () => {
  let query = '';
  const rows = [{
    lead_id: 'booking-1',
    name: 'Customer',
    email: 'customer@example.test',
    lead_status: 'QUOTED',
  }];
  const res = await run({ 'x-sales-secret': 'sales-secret' }, async (input) => {
    query = String(input);
    return json(rows);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.bookings, rows);
  assert.match(query, /lead_source=eq\.booking_form/);
  assert.match(query, /limit=100/);
  assert.match(res.headers['cache-control'], /no-store/);
});

test('reports when the Supabase booking schema is not ready', async () => {
  const res = await run({ 'x-sales-secret': 'sales-secret' }, async () => json({ code: '42703' }, 400));
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /schema Supabase/);
});
