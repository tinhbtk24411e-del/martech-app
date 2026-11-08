import test from 'node:test';
import assert from 'node:assert/strict';
import { automationPayload } from '../lib/_notify.js';

test('payload keeps created_at so a later sales_confirmed update does not reset it', () => {
  const p = automationPayload({ lead_id: 'l1', created_at: '2026-11-01T08:00:00.000Z', lead_source: 'booking_form' });
  assert.equal(p.created_at, '2026-11-01T08:00:00.000Z');
});

test('payload carries care_priority and booking flags for n8n routing', () => {
  const p = automationPayload({ lead_id: 'l2', care_priority: 'HOT', lead_source: 'booking_form', budget: 5000000 });
  assert.equal(p.care_priority, 'HOT');
  assert.equal(p.booking_request, true);
  assert.equal(p.booking_price_per_person, 5000000);
});
