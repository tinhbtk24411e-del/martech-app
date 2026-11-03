import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/aichat.js';

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(value) {
      this.data = value;
      return this;
    },
  };
}

test('planner mode returns a validated AI plan without requiring the tour catalog', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = 'test-only-key';
  let requestBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            destination: 'Huế',
            summary: 'Di sản và ẩm thực.',
            days: [
              { title: 'Ngày 1', activities: [{ time: '09:00', name: 'Đại Nội', location: 'Huế', duration: '2 giờ', ticket_per_person: 200000 }] },
              { title: 'Ngày 2', activities: [{ time: '08:00', name: 'Chợ Đông Ba', location: 'Huế', duration: '1 giờ', ticket_per_person: 0 }] },
            ],
            services: {
              flight: { name: 'Vé khứ hồi tham khảo', price_per_person: 1000000 },
              hotel: { name: 'Khách sạn tầm trung', price_per_room_per_night: 700000 },
              transport: { name: 'Di chuyển địa phương', price_per_person: 200000 },
              meals: { name: 'Ăn uống địa phương', price_per_person: 300000 },
            },
          }),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = createResponse();
    await handler({
      method: 'POST',
      body: {
        mode: 'planner',
        message: 'Tự chọn chuyến đi cho mình.',
        trip: {
          start_date: '2027-04-10',
          end_date: '2027-04-11',
          start_time: '08:00',
          end_time: '18:00',
          guests: 2,
          budget: null,
        },
      },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.plan.destination, 'Huế');
    assert.equal(response.data.plan.costs.total, 4100000);
    assert.equal(response.data.plan.budget_status, 'not_set');
    assert.equal(requestBody.model, 'openrouter/free');
    assert.equal(requestBody.messages[0].role, 'system');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
