import test from 'node:test';
import assert from 'node:assert/strict';
import { nextNurtureStep, signOptOut, verifyOptOut } from '../lib/_nurture.js';

const DAY = 24 * 60 * 60 * 1000;
const created = Date.parse('2026-11-01T00:00:00Z');
const base = { lead_id: 'x', lead_status: 'NEW', consent_to_contact: true, nurture_opt_out: false,
  nurture_step: 0, created_at: new Date(created).toISOString() };

test('HOT leads are never nurtured', () => {
  assert.equal(nextNurtureStep({ ...base, care_priority: 'HOT' }, created + 30 * DAY).due, false);
});

test('COLD lead gets step 1 only after day 1', () => {
  const lead = { ...base, care_priority: 'COLD' };
  assert.equal(nextNurtureStep(lead, created + 12 * 60 * 60 * 1000).due, false);
  assert.deepEqual(nextNurtureStep(lead, created + DAY), { due: true, step: 1, action: 'tour_suggestions' });
});

test('steps advance in order and stop at plan end', () => {
  const lead = { ...base, care_priority: 'COLD', nurture_step: 3 };
  assert.deepEqual(nextNurtureStep(lead, created + 14 * DAY), { due: true, step: 4, action: 'close_file' });
  const done = { ...base, care_priority: 'COLD', nurture_step: 4 };
  assert.equal(nextNurtureStep(done, created + 60 * DAY).reason, 'plan_complete');
});

test('Sales ownership, opt-out and missing consent all stop nurturing', () => {
  const now = created + 30 * DAY;
  assert.equal(nextNurtureStep({ ...base, care_priority: 'COLD', lead_status: 'CONTACTED' }, now).reason, 'sales_owned');
  assert.equal(nextNurtureStep({ ...base, care_priority: 'COLD', nurture_opt_out: true }, now).reason, 'opted_out');
  assert.equal(nextNurtureStep({ ...base, care_priority: 'COLD', consent_to_contact: false }, now).reason, 'no_consent');
});

test('opt-out signature verifies only for the same lead and secret', () => {
  const sig = signOptOut('lead-1', 'secret');
  assert.equal(verifyOptOut('lead-1', sig, 'secret'), true);
  assert.equal(verifyOptOut('lead-2', sig, 'secret'), false);
  assert.equal(verifyOptOut('lead-1', sig, 'other'), false);
  assert.equal(verifyOptOut('lead-1', '', 'secret'), false);
});
