import { secretMatches, send } from '../lib/_shared.js';
import { supabase } from '../lib/_supabase.js';

const BOOKING_SELECT = [
  'lead_id',
  'name',
  'email',
  'phone',
  'contact',
  'selected_tour_name',
  'destination',
  'travel_date',
  'party_size',
  'budget',
  'lead_status',
  'booking_confirmation_status',
  'created_at',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Chỉ hỗ trợ GET.' });
  }

  if (!secretMatches(req.headers['x-sales-secret'], process.env.SALES_UPDATE_SECRET)) {
    return send(res, 401, { error: 'Không có quyền xem danh sách booking.' });
  }

  try {
    const response = await supabase(
      `leads?lead_source=eq.booking_form&order=created_at.desc&limit=100&select=${BOOKING_SELECT}`,
    );
    if (!response.ok) {
      console.error('[api/sales-bookings] Supabase request failed', { status: response.status });
      return send(res, 503, {
        error: 'Chưa tải được booking. Kiểm tra schema Supabase đã được cập nhật chưa.',
      });
    }

    const bookings = await response.json();
    if (!Array.isArray(bookings)) {
      console.error('[api/sales-bookings] Supabase returned an invalid booking list');
      return send(res, 503, { error: 'Danh sách booking không đúng định dạng.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { bookings });
  } catch (error) {
    console.error('[api/sales-bookings] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Chưa tải được danh sách booking.' });
  }
}
