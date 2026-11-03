import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const WINDOW_MS = 60_000;
const LIMIT = 20;
const buckets = new Map();

export function send(res, status, body) {
  res.status(status).json(body);
}

export function clean(value, max = 300) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/[<>]/g, '')
    .normalize('NFKC')
    .trim()
    .slice(0, max);
}

export function number(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

export function list(value, max = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => clean(v, 40)).filter(Boolean))].slice(0, max);
}

export async function tours() {
  const file = path.join(process.cwd(), 'data', 'tours.json');
  const raw = await fs.readFile(file, 'utf8');
  const rows = JSON.parse(raw);
  return Array.isArray(rows) ? rows.filter((t) => t?.tour_status === 'active') : [];
}

export function allowed(req, res) {
  const origin = req.headers.origin;
  const configured = process.env.APP_ORIGIN;

  if (configured && origin && origin !== configured) return false;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', configured || origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Automation-Secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  return true;
}

export function rateLimit(req) {
  const key = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0];
  const now = Date.now();
  const item = buckets.get(key);

  if (!item || now - item.start > WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }

  item.count += 1;
  return item.count <= LIMIT;
}

export function method(req, res) {
  if (req.method === 'OPTIONS') {
    allowed(req, res);
    res.status(204).end();
    return false;
  }

  if (!allowed(req, res)) {
    send(res, 403, { error: 'Nguồn gửi không được phép.' });
    return false;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    send(res, 405, { error: 'Chỉ hỗ trợ POST.' });
    return false;
  }

  if (!rateLimit(req)) {
    send(res, 429, { error: 'Bạn gửi quá nhanh, vui lòng thử lại sau.' });
    return false;
  }

  return true;
}

export function publicTour(t) {
  return {
    id: t.id,
    name: t.name,
    destination: t.destination,
    duration: t.duration,
    price_per_person: t.price_per_person,
    currency: t.currency || 'VND',
    image: t.image,
    included_services: t.included_services || [],
    highlights: t.highlights || [],
    experience_type: t.experience_type || [],
  };
}

export function utmFields(input) {
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const values = {};

  for (const key of keys) {
    const value = clean(String(input?.[key] ?? ''), 128);
    if (value) values[key] = value;
  }

  return values;
}

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'BOOKED', 'LOST'];

const LEAD_TRANSITIONS = {
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['QUOTED', 'LOST'],
  QUOTED: ['BOOKED', 'LOST', 'CONTACTED'],
  BOOKED: [],
  LOST: ['CONTACTED'],
};

export function canTransition(from, to) {
  return from === to || (LEAD_TRANSITIONS[from] || []).includes(to);
}

export function secretMatches(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
