import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/nurture.js';
import { createResponse, json, withEnv, withFetch } from './helpers.mjs';

const ENV = { SUPABASE_URL: 'https://t.supabase.co', SUPABASE_SECRET_KEY: 'k', CRON_SECRET: 'cron',
  N8N_NURTURE_WEBHOOK_URL: 'https://n8n.test/nurture', N8N_WEBHOOK_SECRET: 's',
  NURTURE_SECRET: 'nsec', APP_ORIGIN: 'https://app.test' };

const lead = (id, step = 0) => ({ lead_id: id, name: 'A', email: 'a@x.test', destination: 'Huế',
  care_priority: 'COLD', lead_status: 'NEW', consent_to_contact: true, nurture_opt_out: false,
  nurture_step: step, created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() });

test('nurture job rejects callers without the cron secret', async () => {
  const res = createResponse();
  await withEnv(ENV, () => withFetch(async () => { throw new Error('no db'); },
    () => handler({ method: 'GET', headers: {} }, res)));
  assert.equal(res.statusCode, 401);
});

test('sends due step, advances nurture_step, and does not resend on acknowledged delivery', async () => {
  const patches = [];
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('nurture_opt_out=eq.false')) return json([lead('lead-a', 0)]);
    if (url.includes('nurture_step=eq.0') && options.method === 'PATCH') {
      patches.push(JSON.parse(options.body));
      return json([{ lead_id: 'lead-a' }]);
    }
    if (url === ENV.N8N_NURTURE_WEBHOOK_URL) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.step, 1);
      assert.match(payload.opt_out_url, /^https:\/\/app\.test\/api\/optout\?lead_id=lead-a&sig=/);
      return json({ email_sent: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const res = createResponse();
  await withEnv(ENV, () => withFetch(mock, () => handler({ method: 'GET', headers: { authorization: 'Bearer cron' } }, res)));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 1);
  assert.equal(patches[0].nurture_step, 1);
});

test('rolls back the step when n8n does not acknowledge the email', async () => {
  const patches = [];
  const mock = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('nurture_opt_out=eq.false')) return json([lead('lead-b', 0)]);
    if (options.method === 'PATCH') {
      patches.push(JSON.parse(options.body));
      return options.body.includes('nurture_last_sent_at') ? json([{ lead_id: 'lead-b' }]) : new Response(null, { status: 204 });
    }
    if (url === ENV.N8N_NURTURE_WEBHOOK_URL) return json({ email_sent: false });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const res = createResponse();
  await withEnv(ENV, () => withFetch(mock, () => handler({ method: 'GET', headers: { authorization: 'Bearer cron' } }, res)));
  assert.equal(res.body.failed, 1);
  assert.equal(patches.at(-1).nurture_step, 0, 'step must roll back to 0 so the next run retries it');
});
