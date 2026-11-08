import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlannerPlan, parsePlannerContent } from '../lib/_planner.js';

const trip = { days: 2, nights: 1, guests: 3, budget: 3000000 };
const samplePlan = {
  destination: 'Huế',
  summary: 'Khám phá di sản và ẩm thực địa phương.',
  days: [
    { title: 'Ngày đầu', activities: [
      { time: '09:00', name: 'Đại Nội', location: 'Trung tâm Huế', duration: '2 giờ', ticket_per_person: 200000 },
    ] },
    { title: 'Ngày về', activities: [
      { time: '08:00', name: 'Chợ Đông Ba', location: 'Phường Phú Hòa', duration: '1 giờ', ticket_per_person: 0 },
    ] },
  ],
  services: {
    flight: { name: 'Vé khứ hồi tham khảo', price_per_person: 1500000 },
    hotel: { name: 'Khách sạn tầm trung', price_per_room_per_night: 800000 },
    transport: { name: 'Di chuyển địa phương', price_per_person: 300000 },
    meals: { name: 'Ăn uống địa phương', price_per_person: 500000 },
  },
};

test('parses plain, fenced, wrapped, and text-block JSON responses', () => {
  assert.deepEqual(parsePlannerContent('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parsePlannerContent('Here is the plan:\n{"ok":true}\nDone.'), { ok: true });
  assert.deepEqual(parsePlannerContent([{ type: 'text', text: '{"ok":' }, { type: 'text', text: 'true}' }]), { ok: true });
  assert.equal(parsePlannerContent('not JSON'), null);
});

test('normalizes the AI plan and calculates group costs using trip size and nights', () => {
  const plan = normalizePlannerPlan(samplePlan, trip);
  assert.equal(plan.destination, 'Huế');
  assert.equal(plan.room_count, 2);
  assert.equal(plan.budget_status, 'over_budget');
  assert.deepEqual(plan.costs, {
    flight: 4500000,
    hotel: 1600000,
    transport: 900000,
    meals: 1500000,
    tickets: 600000,
    total: 9100000,
    per_person: 3033334,
  });
  assert.match(plan.assumptions[0], /mô phỏng/);
  assert.match(plan.assumptions[2], /vượt ngân sách/);
});

test('rejects malformed itineraries, unsupported trip lengths, and invalid prices', () => {
  assert.equal(normalizePlannerPlan({ ...samplePlan, days: samplePlan.days.slice(0, 1) }, trip), null);
  const invalidPrice = structuredClone(samplePlan);
  invalidPrice.services.flight.price_per_person = -100;
  assert.equal(normalizePlannerPlan(invalidPrice, trip), null);
  const invalidTime = structuredClone(samplePlan);
  invalidTime.days[0].activities[0].time = '25:30';
  assert.equal(normalizePlannerPlan(invalidTime, trip), null);
});
