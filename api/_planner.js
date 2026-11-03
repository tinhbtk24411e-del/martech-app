function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function price(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1000000000
    ? value
    : null;
}

export function parsePlannerContent(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function normalizePlannerPlan(value, trip) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const destination = text(value.destination, 100);
  const summary = text(value.summary, 300);
  const days = value.days;
  const services = value.services;
  if (!destination || !summary || !Array.isArray(days) || days.length !== trip.days ||
      !services || typeof services !== 'object' || Array.isArray(services)) return null;

  const normalizedDays = days.map((day) => {
    if (!day || typeof day !== 'object' || !Array.isArray(day.activities) ||
        day.activities.length < 1 || day.activities.length > 4) return null;
    const activities = day.activities.map((activity) => {
      if (!activity || typeof activity !== 'object') return null;
      const time = text(activity.time, 5);
      const name = text(activity.name, 120);
      const location = text(activity.location, 120);
      const duration = text(activity.duration, 80);
      const ticket = price(activity.ticket_per_person);
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
          !name || !location || !duration || ticket === null) return null;
      return { time, name, location, duration, ticket_per_person: ticket };
    });
    if (activities.some((activity) => !activity)) return null;
    return { title: text(day.title, 100) || 'Lịch trình trong ngày', activities };
  });
  if (normalizedDays.some((day) => !day)) return null;

  const normalizeService = (service, costKey) => {
    if (!service || typeof service !== 'object' || Array.isArray(service)) return null;
    const name = text(service.name, 120);
    const amount = price(service[costKey]);
    return name && amount !== null ? { name, amount } : null;
  };
  const flight = normalizeService(services.flight, 'price_per_person');
  const hotel = normalizeService(services.hotel, 'price_per_room_per_night');
  const transport = normalizeService(services.transport, 'price_per_person');
  const meals = normalizeService(services.meals, 'price_per_person');
  if (!flight || !hotel || !transport || !meals) return null;

  const ticketPerPerson = normalizedDays
    .flatMap((day) => day.activities)
    .reduce((sum, activity) => sum + activity.ticket_per_person, 0);
  const roomCount = Math.ceil(trip.guests / 2);
  const totals = {
    flight: flight.amount * trip.guests,
    hotel: hotel.amount * trip.nights * roomCount,
    transport: transport.amount * trip.guests,
    meals: meals.amount * trip.guests,
    tickets: ticketPerPerson * trip.guests,
  };
  const total = Object.values(totals).reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(total)) return null;
  const perPerson = Math.ceil(total / trip.guests);
  const budget = Number.isSafeInteger(trip.budget) && trip.budget >= 0 ? trip.budget : null;
  const overBudget = budget !== null && perPerson > budget;
  const assumptions = [
    'Giá dịch vụ là mô phỏng tham khảo, chưa xác nhận với nhà cung cấp.',
    `Ước tính ${roomCount} phòng cho ${trip.guests} khách (tối đa 2 khách/phòng).`,
  ];
  if (overBudget) assumptions.push(`Dự toán vượt ngân sách mục tiêu ${budget.toLocaleString('vi-VN')}đ/người.`);

  return {
    destination,
    summary,
    days: normalizedDays,
    services: {
      flight: { name: flight.name, price_per_person: flight.amount },
      hotel: { name: hotel.name, price_per_room_per_night: hotel.amount },
      transport: { name: transport.name, price_per_person: transport.amount },
      meals: { name: meals.name, price_per_person: meals.amount },
    },
    room_count: roomCount,
    costs: {
      ...totals,
      total,
      per_person: perPerson,
    },
    budget_status: budget === null ? 'not_set' : overBudget ? 'over_budget' : 'within_budget',
    assumptions,
  };
}
