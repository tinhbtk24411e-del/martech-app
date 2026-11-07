const VISITOR_ID_KEY = 'vietjourney_visitor_session';
const UTM_KEY = 'vietjourney_visitor_utm';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const ALLOWED_SOURCES = new Set(['facebook', 'tiktok', 'instagram', 'google', 'direct']);

let visitorId;

function clean(value, maxLength = 128) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function getVisitorId() {
  if (visitorId) return visitorId;

  try {
    visitorId = sessionStorage.getItem(VISITOR_ID_KEY);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visitorId || '')) {
      visitorId = crypto.randomUUID();
      sessionStorage.setItem(VISITOR_ID_KEY, visitorId);
    }
    return visitorId;
  } catch (error) {
    console.error('[visitor-tracking] Could not access session storage', error);
    visitorId ||= crypto.randomUUID();
    return visitorId;
  }
}

function getUtm() {
  let persisted = {};
  try {
    persisted = JSON.parse(sessionStorage.getItem(UTM_KEY) || '{}');
  } catch (error) {
    console.error('[visitor-tracking] Could not read saved campaign data', error);
  }

  const query = new URLSearchParams(window.location.search);
  const values = { ...persisted };
  for (const key of UTM_KEYS) {
    const value = clean(query.get(key));
    if (value) values[key] = value;
  }

  const source = clean(values.utm_source, 40).toLowerCase();
  values.utm_source = ALLOWED_SOURCES.has(source) ? source : source ? 'other' : 'direct';
  for (const key of UTM_KEYS.slice(1)) values[key] = clean(values[key]);

  try {
    sessionStorage.setItem(UTM_KEY, JSON.stringify(values));
  } catch (error) {
    console.error('[visitor-tracking] Could not save campaign data', error);
  }
  return values;
}

export function getVisitorUtm() {
  return getUtm();
}

export async function recordVisitorEvent(event) {
  try {
    const response = await fetch('/api/visitor-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitor_id: getVisitorId(),
        event,
        ...getUtm(),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('[visitor-tracking] Event was not recorded', {
        event,
        status: response.status,
        error: body.error || 'Unknown tracking error',
      });
    }
  } catch (error) {
    console.error('[visitor-tracking] Could not send event', { event, error });
  }
}
