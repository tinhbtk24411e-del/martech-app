import fs from 'node:fs/promises';
import path from 'node:path';

const WINDOW_MS = 60_000;
const LIMIT = 20;
const buckets = new Map();

export function send(res, status, body) { res.status(status).json(body); }
export function clean(value, max = 300) { return typeof value === 'string' ? value.replace(/[<>]/g, '').trim().slice(0, max) : ''; }
export function number(value, min, max) { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max ? n : null; }
export function list(value, max = 8) { return Array.isArray(value) ? [...new Set(value.map(v => clean(v, 40)).filter(Boolean))].slice(0, max) : []; }
export async function tours() {
  const file = path.join(process.cwd(), 'data', 'tours.json');
  const rows = JSON.parse(await fs.readFile(file, 'utf8'));
  return Array.isArray(rows) ? rows.filter(t => t?.tour_status === 'active') : [];
}
export function allowed(req, res) {
  const origin = req.headers.origin;
  const configured = process.env.APP_ORIGIN;
  if (configured && origin && origin !== configured) return false;
  if (configured && origin === configured) res.setHeader('Access-Control-Allow-Origin', configured);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  return true;
}
export function rateLimit(req) {
  const key = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0];
  const now = Date.now(); const item = buckets.get(key);
  if (!item || now - item.start > WINDOW_MS) { buckets.set(key, { start: now, count: 1 }); return true; }
  item.count += 1; return item.count <= LIMIT;
}
export function method(req, res) {
  if (req.method === 'OPTIONS') { allowed(req, res); res.status(204).end(); return false; }
  if (!allowed(req, res)) { send(res, 403, { error: 'Nguồn gửi không được phép.' }); return false; }
  if (req.method !== 'POST') { send(res, 405, { error: 'Chỉ hỗ trợ POST.' }); return false; }
  if (!rateLimit(req)) { send(res, 429, { error: 'Bạn gửi quá nhanh, vui lòng thử lại sau.' }); return false; }
  return true;
}
export function publicTour(t) { return { id: t.id, name: t.name, destination: t.destination, duration: t.duration, price_per_person: t.price_per_person, currency: t.currency || 'VND', image: t.image, included_services: t.included_services || [], highlights: t.highlights || [], experience_type: t.experience_type || [] }; }
