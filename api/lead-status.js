import { LEAD_STATUSES, canTransition, clean, secretMatches, send } from '../lib/_shared.js';
import { supabase } from '../lib/_supabase.js';
import {
  claimBookingConfirmation,
  deliverBookingConfirmation,
  updateBookingConfirmationStatus,
} from '../lib/_notify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sales-facing endpoint. Requires X-Sales-Secret (server-to-server or internal tool only).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Chỉ hỗ trợ POST.' });
  }

  if (!secretMatches(req.headers['x-sales-secret'], process.env.SALES_UPDATE_SECRET)) {
    return send(res, 401, { error: 'Không có quyền cập nhật lead.' });
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const leadId = clean(b.lead_id, 36);
  const nextStatus = clean(b.lead_status, 20).toUpperCase();
  const salesNote = clean(b.sales_note, 500);

  if (!UUID.test(leadId)) {
    return send(res, 400, { error: 'lead_id không hợp lệ.' });
  }
  if (!LEAD_STATUSES.includes(nextStatus)) {
    return send(res, 400, { error: `lead_status phải là một trong: ${LEAD_STATUSES.join(', ')}.` });
  }

  try {
    const currentResponse = await supabase(`leads?lead_id=eq.${leadId}&select=*`);
    if (!currentResponse.ok) return send(res, 503, { error: 'Chưa thể đọc lead. Vui lòng thử lại.' });

    const [current] = await currentResponse.json();
    if (!current) return send(res, 404, { error: 'Không tìm thấy lead.' });

    if (!canTransition(current.lead_status, nextStatus)) {
      return send(res, 409, {
        error: `Không thể chuyển từ ${current.lead_status} sang ${nextStatus}.`,
        current_status: current.lead_status,
      });
    }

    const body = { lead_status: nextStatus };
    if (salesNote) body.sales_note = salesNote;
    const isBookingConfirmation = current.lead_status !== 'BOOKED' &&
      current.lead_source === 'booking_form' && nextStatus === 'BOOKED';
    if (isBookingConfirmation) body.booking_confirmation_status = 'PENDING';

    // Compare-and-set: only applies if nobody changed the status since we read it.
    const updateResponse = await supabase(
      `leads?lead_id=eq.${leadId}&lead_status=eq.${current.lead_status}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      },
    );
    if (!updateResponse.ok) return send(res, 503, { error: 'Chưa thể cập nhật trạng thái. Vui lòng thử lại.' });

    const updated = await updateResponse.json();
    if (!Array.isArray(updated) || !updated.length) {
      return send(res, 409, { error: 'Lead vừa được cập nhật bởi người khác. Vui lòng tải lại.' });
    }

    if (!isBookingConfirmation) {
      return send(res, 200, { lead_id: leadId, lead_status: nextStatus });
    }

    const updatedLead = Array.isArray(updated) ? updated[0] : null;
    const claimed = await claimBookingConfirmation({
      ...current,
      ...updatedLead,
      lead_id: leadId,
      lead_status: nextStatus,
      booking_confirmation_status: 'PENDING',
    });
    if (claimed === null) {
      return send(res, 503, {
        error: 'Đã cập nhật booking nhưng chưa thể gửi email xác nhận. Hệ thống sẽ thử lại.',
        lead_id: leadId,
        lead_status: nextStatus,
        booking_confirmation_status: 'PENDING',
      });
    }
    if (claimed === false) {
      return send(res, 202, {
        lead_id: leadId,
        lead_status: nextStatus,
        booking_confirmation_status: 'PENDING',
      });
    }

    const confirmationStatus = await deliverBookingConfirmation({ ...current, ...claimed });
    const recorded = await updateBookingConfirmationStatus(leadId, confirmationStatus);
    const finalStatus = recorded ? confirmationStatus : 'PENDING';

    if (finalStatus !== 'SENT') {
      return send(res, finalStatus === 'FAILED' ? 502 : 503, {
        error: finalStatus === 'FAILED'
          ? 'Booking đã được xác nhận nhưng email cho khách chưa gửi được.'
          : 'Booking đã được xác nhận nhưng chưa nhận được xác nhận gửi email. Hệ thống sẽ thử lại.',
        lead_id: leadId,
        lead_status: nextStatus,
        booking_confirmation_status: finalStatus,
      });
    }

    return send(res, 200, {
      lead_id: leadId,
      lead_status: nextStatus,
      booking_confirmation_status: finalStatus,
    });
  } catch (error) {
    console.error('[api/lead-status] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Chưa thể cập nhật trạng thái. Vui lòng thử lại.' });
  }
}
