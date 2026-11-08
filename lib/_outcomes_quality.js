import { careTier } from './_scoring.js';

const tierOf = (row) => row.care_priority || careTier({
  bookingRequest: row.lead_source === 'booking_form',
  selectedTourId: row.selected_tour_id,
});

// Lead quality KPIs: are we capturing leads worth Sales time, and do they convert?
export function leadQuality(rows = []) {
  const total = rows.length;
  const rate = (n) => (total ? Number((n / total).toFixed(4)) : 0);
  const count = (predicate) => rows.filter(predicate).length;

  const qualified = count((r) => tierOf(r) === 'HOT' || tierOf(r) === 'WARM');
  const booked = count((r) => r.lead_status === 'BOOKED');
  const lost = count((r) => r.lead_status === 'LOST');
  const untouched = count((r) => r.lead_status === 'NEW');

  return {
    total,
    qualified_rate: rate(qualified),   // HOT + WARM / tổng lead
    booked_rate: rate(booked),         // BOOKED / tổng lead
    lost_rate: rate(lost),             // LOST / tổng lead
    untouched_rate: rate(untouched),   // còn NEW, chưa có Sales xử lý
  };
}
