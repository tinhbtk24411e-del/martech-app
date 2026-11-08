import test from 'node:test';
import assert from 'node:assert/strict';
import { tierOutcomes } from '../lib/_outcomes.js';

test('counts bookings and losses per care tier', () => {
  const rows = [
    { lead_source: 'booking_form', selected_tour_id: 'a', lead_status: 'BOOKED' },
    { lead_source: 'booking_form', selected_tour_id: 'a', lead_status: 'LOST' },
    { lead_source: 'booking_form', selected_tour_id: 'a', lead_status: 'NEW' },
    { lead_source: 'website', selected_tour_id: 'b', lead_status: 'BOOKED' },
    { lead_source: 'website', selected_tour_id: null, lead_status: 'NEW' },
  ];
  const t = tierOutcomes(rows);
  assert.deepEqual(t.HOT, { total: 3, booked: 1, lost: 1, booked_rate: 0.3333 });
  assert.deepEqual(t.WARM, { total: 1, booked: 1, lost: 0, booked_rate: 1 });
  assert.deepEqual(t.COLD, { total: 1, booked: 0, lost: 0, booked_rate: 0 });
});

test('stored care_priority wins over derived tier', () => {
  const t = tierOutcomes([{ care_priority: 'COLD', lead_source: 'booking_form', lead_status: 'BOOKED' }]);
  assert.equal(t.COLD.booked, 1);
  assert.equal(t.HOT.total, 0);
});

test('empty input gives zero rates, not NaN', () => {
  const t = tierOutcomes([]);
  assert.equal(t.HOT.booked_rate, 0);
  assert.equal(t.WARM.total, 0);
});
