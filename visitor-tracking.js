const VISITOR_ID_KEY = 'vietjourney_visitor_identity';
const UTM_KEY = 'vietjourney_visitor_utm';
const TRACKING_CONSENT_KEY = 'vietjourney_behavior_consent';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const ALLOWED_SOURCES = new Set(['facebook', 'tiktok', 'instagram', 'google', 'direct']);
const IDENTITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETURN_GAP_MS = 30 * 60 * 1000;
const ENGAGEMENT_SECONDS = 120;

let visitorId;
let returnVisit = false;
let timerStarted = false;
let visibleSeconds = 0;
let engagementTimer;

function hasBehaviorTrackingConsent() {
  try {
    return localStorage.getItem(TRACKING_CONSENT_KEY) === 'true';
  } catch (error) {
    console.error('[visitor-tracking] Could not read behavior consent', error);
    return false;
  }
}

function clean(value, maxLength = 128) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function getVisitorId() {
  if (visitorId) return visitorId;

  try {
    const saved = JSON.parse(localStorage.getItem(VISITOR_ID_KEY) || 'null');
    const now = Date.now();
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved?.id || '');
    if (validId && Number.isFinite(saved.last_seen) && now - saved.last_seen <= IDENTITY_TTL_MS) {
      visitorId = saved.id;
      returnVisit = hasBehaviorTrackingConsent() && now - saved.last_seen >= RETURN_GAP_MS;
    } else {
      visitorId = crypto.randomUUID();
    }
    localStorage.setItem(VISITOR_ID_KEY, JSON.stringify({ id: visitorId, last_seen: now }));
    return visitorId;
  } catch (error) {
    console.error('[visitor-tracking] Could not access visitor storage', error);
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

async function sendEvent(event, visitorIdValue, utm) {
  try {
    const response = await fetch('/api/visitor-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitor_id: visitorIdValue,
        event,
        ...utm,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[visitor-tracking] Event was not recorded', {
        event,
        status: response.status,
        error: body.error || 'Unknown tracking error',
      });
      return null;
    }
    return body;
  } catch (error) {
    console.error('[visitor-tracking] Could not send event', { event, error });
    return null;
  }
}

function startEngagementTimer(visitorIdValue, utm) {
  if (timerStarted) return;
  timerStarted = true;
  engagementTimer = window.setInterval(() => {
    if (!hasBehaviorTrackingConsent()) {
      window.clearInterval(engagementTimer);
      engagementTimer = undefined;
      timerStarted = false;
      visibleSeconds = 0;
      return;
    }
    if (document.visibilityState !== 'visible') return;
    visibleSeconds += 1;
    if (visibleSeconds < ENGAGEMENT_SECONDS) return;
    window.clearInterval(engagementTimer);
    engagementTimer = undefined;
    timerStarted = false;
    sendEvent('engaged_2m', visitorIdValue, utm);
  }, 1000);
}

export function setBehaviorTrackingConsent(enabled) {
  try {
    if (enabled) localStorage.setItem(TRACKING_CONSENT_KEY, 'true');
    else localStorage.removeItem(TRACKING_CONSENT_KEY);
  } catch (error) {
    console.error('[visitor-tracking] Could not save behavior consent', error);
    return;
  }

  if (!enabled) {
    if (engagementTimer !== undefined) window.clearInterval(engagementTimer);
    engagementTimer = undefined;
    timerStarted = false;
    visibleSeconds = 0;
    return;
  }

  startEngagementTimer(getVisitorId(), getUtm());
}

export async function recordVisitorEvent(event) {
  const consentRequired = [
    'tour_detail_view', 'pricing_view', 'engaged_2m',
    'return_visit', 'compare_or_save', 'contact_click', 'booking_started',
  ];
  if (consentRequired.includes(event) && !hasBehaviorTrackingConsent()) return null;

  const visitorIdValue = getVisitorId();
  const utm = getUtm();

  if (event === 'visit') {
    let firstPageView = true;
    try {
      const pageKey = `vietjourney_visited:${location.pathname}`;
      firstPageView = sessionStorage.getItem(pageKey) !== 'true';
      sessionStorage.setItem(pageKey, 'true');
    } catch (error) {
      console.error('[visitor-tracking] Could not deduplicate page view', error);
    }

    if (hasBehaviorTrackingConsent()) startEngagementTimer(visitorIdValue, utm);
    const result = firstPageView
      ? await sendEvent('visit', visitorIdValue, utm)
      : null;
    if (returnVisit) {
      returnVisit = false;
      const returning = await sendEvent('return_visit', visitorIdValue, utm);
      return returning || result;
    }
    return result;
  }

  return sendEvent(event, visitorIdValue, utm);
}
