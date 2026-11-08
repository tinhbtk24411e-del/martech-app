import test from 'node:test';
import assert from 'node:assert/strict';
import { careTier } from '../lib/_scoring.js';

test('booking request is HOT regardless of tour selection', () => {
  assert.equal(careTier({ bookingRequest: true, selectedTourId: 'da-lat-3n2d' }), 'HOT');
  assert.equal(careTier({ bookingRequest: true, selectedTourId: null }), 'HOT');
});

test('consultation with a chosen tour is WARM', () => {
  assert.equal(careTier({ bookingRequest: false, selectedTourId: 'ha-giang-loop' }), 'WARM');
});

test('consultation without a tour is COLD', () => {
  assert.equal(careTier({ bookingRequest: false, selectedTourId: null }), 'COLD');
  assert.equal(careTier({}), 'COLD');
});
