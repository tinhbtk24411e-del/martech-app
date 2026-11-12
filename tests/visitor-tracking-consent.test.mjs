import test from 'node:test';
import assert from 'node:assert/strict';

class StorageMock {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('keeps UTM attribution for a submitted lead but records no visitor identity/events without behavior consent', async () => {
  const previous = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    window: globalThis.window,
    location: globalThis.location,
    fetch: globalThis.fetch,
  };
  const localStorage = new StorageMock();
  const sessionStorage = new StorageMock();
  let requests = 0;
  globalThis.localStorage = localStorage;
  globalThis.sessionStorage = sessionStorage;
  globalThis.window = { location: { search: '?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_escape' } };
  globalThis.location = { pathname: '/' };
  globalThis.fetch = async () => { requests += 1; return new Response('{}'); };
  try {
    const { getVisitorUtm, recordVisitorEvent } = await import('../visitor-tracking.js?consent-test');
    assert.equal(await recordVisitorEvent('visit'), null);
    assert.equal(await recordVisitorEvent('ai_used'), null);
    assert.equal(requests, 0);
    assert.equal(localStorage.values.size, 0);
    assert.deepEqual(getVisitorUtm(), {
      utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'summer_escape',
      utm_content: '', utm_term: '',
    });
    assert.equal(localStorage.values.size, 0);
    assert.ok(sessionStorage.getItem('vietjourney_visitor_utm'));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
