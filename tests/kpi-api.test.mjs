import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/kpi.js';

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

test('KPI endpoint aggregates every Supabase page without returning lead details', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://supabase.example';
  process.env.SUPABASE_SECRET_KEY = 'test-only-key';
  const createdAt = new Date().toISOString();
  const pageOne = Array.from({ length: 1000 }, () => ({
    created_at: createdAt,
    lead_status: 'NEW',
    lead_level: 'WARM',
    utm_source: 'facebook',
    selected_tour_id: 'tour-1',
  }));
  const pageTwo = [{
    created_at: createdAt,
    lead_status: 'BOOKED',
    lead_level: 'HOT',
    utm_source: 'google',
    selected_tour_id: null,
  }];
  const requestedRanges = [];
  globalThis.fetch = async (url, options) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/rest/v1/rpc/get_website_visitor_kpis')) {
      return new Response(JSON.stringify({
        total: 1,
        by_priority: { MEDIUM: 1 },
        by_source: { tiktok: 1 },
        by_temperature: { WARM: 1 },
      }), { status: 200 });
    }
    assert.match(requestUrl, /^https:\/\/supabase\.example\/rest\/v1\/leads\?/);
    assert.match(requestUrl, /order=created_at\.asc,lead_id\.asc/);
    requestedRanges.push(options.headers.Range);
    assert.equal(options.headers['Range-Unit'], 'items');
    const page = options.headers.Range === '0-999' ? pageOne : pageTwo;
    return new Response(JSON.stringify(page), { status: 200 });
  };

  try {
    const response = createResponse();
    await handler({ method: 'GET', headers: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(requestedRanges, ['0-999', '1000-1999']);
    assert.equal(response.data.total, 1001);
    assert.equal(response.data.visitor_total, 1);
    assert.equal(response.data.visitor_by_priority.MEDIUM, 1);
    assert.equal(response.data.visitor_by_source.tiktok, 1);
    assert.equal(response.data.visitor_by_temperature.WARM, 1);
    assert.equal(response.data.with_selected_tour, 1000);
    assert.equal(response.data.by_status.NEW, 1000);
    assert.equal(response.data.by_status.BOOKED, 1);
    assert.equal(response.data.by_level.HOT, 1);
    assert.equal(response.data.by_source.facebook, 1000);
    assert.equal(response.data.by_month[createdAt.slice(0, 7)], 1001);
    assert.equal(JSON.stringify(response.data).includes('test-only-key'), false);
    assert.equal(response.headers['Cache-Control'], 'no-store');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
