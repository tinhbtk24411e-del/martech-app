import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, understandCustomer } from '../api/_scoring.js';

test('scores consultation, selected tour, views, and return visits with capped signals', () => {
  assert.deepEqual(scoreLead(), {
    score: 35,
    level: 'COLD',
    signals: {
      consultation_request: 35,
      selected_tour: 0,
      tour_views: 0,
      return_visit: false,
    },
  });
  assert.equal(scoreLead({ selectedTour: true, tourViews: 3, returnVisit: true }).score, 80);
  assert.equal(scoreLead({ selectedTour: true, tourViews: 100 }).score, 70);
  assert.equal(scoreLead({ selectedTour: true }).level, 'WARM');
});

test('classifies multiple travel preferences and falls back to general', () => {
  assert.deepEqual(
    understandCustomer({ interests: ['Gia đình', 'Nghỉ dưỡng', 'Khám phá'] }),
    { segment: 'family', traits: ['family', 'resort', 'explorer'] },
  );
  assert.deepEqual(
    understandCustomer({ interests: [], budget: 2_500_000 }),
    { segment: 'budget', traits: ['budget'] },
  );
  assert.deepEqual(understandCustomer(), { segment: 'general', traits: ['general'] });
});
