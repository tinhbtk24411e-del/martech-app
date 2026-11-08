import { careTier } from './_scoring.js';

// Outcome feedback for the decision loop: how each care tier converts to BOOKED.
// Pure function, aggregate counts only, so it can be tested and exposed safely.
export function tierOutcomes(rows = []) {
  const tiers = {
    HOT: { total: 0, booked: 0, lost: 0 },
    WARM: { total: 0, booked: 0, lost: 0 },
    COLD: { total: 0, booked: 0, lost: 0 },
  };

  for (const row of rows) {
    const tier = row.care_priority || careTier({
      bookingRequest: row.lead_source === 'booking_form',
      selectedTourId: row.selected_tour_id,
    });
    if (!tiers[tier]) continue;
    tiers[tier].total += 1;
    if (row.lead_status === 'BOOKED') tiers[tier].booked += 1;
    if (row.lead_status === 'LOST') tiers[tier].lost += 1;
  }

  for (const tier of Object.values(tiers)) {
    tier.booked_rate = tier.total ? Number((tier.booked / tier.total).toFixed(4)) : 0;
  }
  return tiers;
}
