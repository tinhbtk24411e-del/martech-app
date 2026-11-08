import { secretMatches, send } from './_shared.js';
import { supabase } from './_supabase.js';
import {
  claimBookingConfirmation,
  deliverBookingConfirmation,
  deliverToAutomation,
  updateBookingConfirmationStatus,
  updateNotificationStatus,
} from './_notify.js';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const MIN_AGE_MS = 2 * 60 * 1000;
const STALE_CONFIRMATION_MS = 15 * 60 * 1000;

// Invoked by Vercel Cron (sends Authorization: Bearer CRON_SECRET).
// Retries pending Sales notifications and post-booking customer confirmations.
// Compare-and-set claims prevent overlapping runs from sending the same lead concurrently.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Method not allowed' });
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!secretMatches(token, process.env.CRON_SECRET)) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();

  try {
    const query = await supabase(
      `leads?lead_source=eq.booking_form&notification_status=in.(PENDING,FAILED)` +
        `&notification_attempts=lt.${MAX_ATTEMPTS}` +
        `&created_at=lt.${encodeURIComponent(cutoff)}` +
        `&order=created_at.asc&limit=${BATCH_SIZE}&select=*`,
    );
    if (!query.ok) return send(res, 503, { error: 'Không đọc được lead chờ thông báo.' });

    const leads = await query.json();
    const result = {
      checked: leads.length,
      sent: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
      booking_confirmation_sent: 0,
      booking_confirmation_failed: 0,
      booking_confirmation_pending: 0,
      booking_confirmation_skipped: 0,
    };

    for (const lead of leads) {
      const attempts = Number(lead.notification_attempts || 0);
      const claim = await supabase(
        `leads?lead_id=eq.${encodeURIComponent(lead.lead_id)}&notification_attempts=eq.${attempts}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            notification_attempts: attempts + 1,
            last_notification_at: new Date().toISOString(),
          }),
        },
      );
      const claimed = claim.ok ? await claim.json() : [];
      if (!Array.isArray(claimed) || !claimed.length) {
        result.skipped += 1;
        continue;
      }

      const status = await deliverToAutomation(lead);
      if (status === 'PENDING') {
        result.pending += 1;
        continue;
      }
      await updateNotificationStatus(lead.lead_id, status);
      if (status === 'SENT') result.sent += 1;
      else result.failed += 1;
    }

    const confirmationQuery = await supabase(
      `leads?lead_status=eq.BOOKED&lead_source=eq.booking_form` +
        `&booking_confirmation_status=in.(PENDING,FAILED)` +
        `&booking_confirmation_attempts=lt.${MAX_ATTEMPTS}` +
        `&created_at=lt.${encodeURIComponent(cutoff)}` +
        `&order=created_at.asc&limit=${BATCH_SIZE}&select=*`,
    );
    if (!confirmationQuery.ok) {
      return send(res, 503, { error: 'Không đọc được email xác nhận booking đang chờ.' });
    }

    const confirmations = await confirmationQuery.json();
    const staleCutoff = new Date(Date.now() - STALE_CONFIRMATION_MS).toISOString();
    const staleQuery = await supabase(
      `leads?lead_status=eq.BOOKED&lead_source=eq.booking_form` +
        `&booking_confirmation_status=eq.PROCESSING` +
        `&booking_confirmation_attempts=lt.${MAX_ATTEMPTS}` +
        `&last_booking_confirmation_at=lt.${encodeURIComponent(staleCutoff)}` +
        `&created_at=lt.${encodeURIComponent(cutoff)}` +
        `&order=created_at.asc&limit=${BATCH_SIZE}&select=*`,
    );
    if (!staleQuery.ok) {
      return send(res, 503, { error: 'Không đọc được email booking bị gián đoạn.' });
    }

    const staleConfirmations = await staleQuery.json();
    const confirmationCandidates = [
      ...confirmations.map((lead) => ({ lead, recoverStale: false })),
      ...staleConfirmations.map((lead) => ({ lead, recoverStale: true })),
    ];
    for (const { lead, recoverStale } of confirmationCandidates) {
      const claimed = await claimBookingConfirmation(lead, recoverStale);
      if (claimed === null) {
        result.booking_confirmation_pending += 1;
        continue;
      }
      if (claimed === false) {
        result.booking_confirmation_skipped += 1;
        continue;
      }

      const status = await deliverBookingConfirmation(lead);
      const recorded = await updateBookingConfirmationStatus(lead.lead_id, status);
      const finalStatus = recorded ? status : 'PENDING';
      if (finalStatus === 'SENT') result.booking_confirmation_sent += 1;
      else if (finalStatus === 'FAILED') result.booking_confirmation_failed += 1;
      else result.booking_confirmation_pending += 1;
    }

    return send(res, 200, result);
  } catch (error) {
    console.error('[api/retry-notifications] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Retry thất bại. Sẽ thử lại ở lần chạy sau.' });
  }
}
