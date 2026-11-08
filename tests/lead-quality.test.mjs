import test from 'node:test';
import assert from 'node:assert/strict';
import { leadQuality } from '../lib/_outcomes_quality.js';

test('lead quality rates use total leads as denominator', () => {
  const rows = [
    { lead_source: 'booking_form', selected_tour_id: 'a', lead_status: 'BOOKED' },
    { lead_source: 'booking_form', selected_tour_id: 'a', lead_status: 'NEW' },
    { lead_source: 'website', selected_tour_id: 'b', lead_status: 'LOST' },
    { lead_source: 'website', selected_tour_id: null, lead_status: 'NEW' },
  ];
  assert.deepEqual(leadQuality(rows), {
    total: 4, qualified_rate: 0.75, booked_rate: 0.25, lost_rate: 0.25, untouched_rate: 0.5,
  });
});

test('empty input returns zeros', () => {
  assert.deepEqual(leadQuality([]), { total: 0, qualified_rate: 0, booked_rate: 0, lost_rate: 0, untouched_rate: 0 });
});
