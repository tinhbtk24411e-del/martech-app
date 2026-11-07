import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/visitor-events.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret',
};
const VISITOR_ID = '6f1d2c3a-1111-4222-8333-444455556666';

function run(body, mock) {
  const res = createResponse();
  return withEnv(ENV, () => withFetch(mock, () => handler({
    method: 'POST',
    headers: { origin: 'https://martech-app.vercel.app', 'x-forwarded-for': '192.0.2.90' },
    body,
  }, res))).then(() => res);
}

test('records valid anonymous events and keeps the requested UTM campaign', async () => {
  let recorded;
  const res = await run({
    visitor_id: VISITOR_ID,
    event: 'ai_used',
    utm_source: 'tiktok',
    utm_medium: 'paid_social',
    utm_campaign: 'summer_sale',
  }, async (url, options) => {
    assert.equal(String(url), `${ENV.SUPABASE_URL}/rest/v1/rpc/record_website_visitor`);
    recorded = JSON.parse(options.body);
    return json({ score: 40, temperature: 'WARM', signals: { ai_used: true } });
  });

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.recorded, true);
  assert.equal(recorded.p_event, 'ai_used');
  assert.equal(recorded.p_utm_source, 'tiktok');
  assert.equal(recorded.p_utm_medium, 'paid_social');
  assert.equal(recorded.p_utm_campaign, 'summer_sale');
  assert.equal(res.body.temperature, 'WARM');
  assert.equal(res.body.score, 40);
});

test('normalizes unknown sources and rejects invalid session ids or events', async () => {
  let recorded;
  const valid = await run({
    visitor_id: VISITOR_ID,
    event: 'visit',
    utm_source: 'untrusted-source',
  }, async (_url, options) => {
    recorded = JSON.parse(options.body);
    return json(null);
  });
  assert.equal(valid.statusCode, 202);
  assert.equal(recorded.p_utm_source, 'other');

  const invalid = await run({ visitor_id: 'not-a-uuid', event: 'visit' }, async () => {
    throw new Error('must not reach Supabase');
  });
  assert.equal(invalid.statusCode, 400);

  const protectedEvent = await run({ visitor_id: VISITOR_ID, event: 'consultation_submitted' }, async () => {
    throw new Error('consultation completion must only be recorded by the lead API');
  });
  assert.equal(protectedEvent.statusCode, 400);
});
