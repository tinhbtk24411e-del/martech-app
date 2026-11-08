const normalize = (value) => String(value || '')
  .toLocaleLowerCase('vi')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd');

export function understandCustomer({ interests = [], experienceTypes = [], budget = null } = {}) {
  const preferences = [...interests, ...experienceTypes].map(normalize);
  const traits = [];

  if (preferences.some((value) => value.includes('gia dinh'))) traits.push('family');
  if (
    preferences.some((value) => value.includes('tiet kiem')) ||
    (Number.isFinite(Number(budget)) && Number(budget) > 0 && Number(budget) <= 3_000_000)
  ) {
    traits.push('budget');
  }
  if (preferences.some((value) => value.includes('nghi duong'))) traits.push('resort');
  if (preferences.some((value) =>
    ['trekking', 'kham pha', 'thien nhien'].some((term) => value.includes(term))
  )) {
    traits.push('explorer');
  }

  return {
    segment: traits[0] || 'general',
    traits: traits.length ? traits : ['general'],
  };
}

export function scoreLead({ selectedTour = false, tourViews = 0, returnVisit = false } = {}) {
  const views = Math.min(3, Math.max(0, Math.trunc(Number(tourViews) || 0)));
  const signals = {
    booking_request: 35,
    selected_tour: selectedTour ? 20 : 0,
    tour_views: views,
    return_visit: returnVisit === true,
  };
  const score = Math.min(
    100,
    signals.booking_request +
      signals.selected_tour +
      signals.tour_views * 5 +
      (signals.return_visit ? 10 : 0),
  );

  return {
    score,
    level: score >= 70 ? 'HOT' : score >= 45 ? 'WARM' : 'COLD',
    signals,
  };
}
