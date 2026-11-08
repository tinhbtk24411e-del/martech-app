import { secretMatches, send } from '../lib/_shared.js';
import { supabase } from '../lib/_supabase.js';
import { deliverNurture, nextNurtureStep } from '../lib/_nurture.js';

const BATCH_SIZE = 50;

// Called on a schedule (n8n Schedule or Vercel Cron) with Authorization: Bearer CRON_SECRET.
// Claim-then-send: the step is advanced with a compare-and-set before delivery.
// If delivery is not acknowledged, the step is rolled back so the next run retries it.
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

  const olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const query = await supabase(
      `leads?lead_status=eq.NEW&nurture_opt_out=eq.false&consent_to_contact=eq.true` +
        `&care_priority=in.(WARM,COLD)&nurture_step=lt.4` +
        `&created_at=lt.${encodeURIComponent(olderThan)}` +
        `&order=created_at.asc&limit=${BATCH_SIZE}&select=*`,
    );
    if (!query.ok) return send(res, 503, { error: 'Không đọc được lead nuôi dưỡng.' });

    const leads = await query.json();
    const result = { checked: leads.length, sent: 0, failed: 0, skipped: 0 };

    for (const lead of leads) {
      const decision = nextNurtureStep(lead);
      if (!decision.due) {
        result.skipped += 1;
        continue;
      }

      const current = Number(lead.nurture_step || 0);
      const claim = await supabase(
        `leads?lead_id=eq.${encodeURIComponent(lead.lead_id)}&nurture_step=eq.${current}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ nurture_step: decision.step, nurture_last_sent_at: new Date().toISOString() }),
        },
      );
      const claimed = claim.ok ? await claim.json() : [];
      if (!Array.isArray(claimed) || !claimed.length) {
        result.skipped += 1;
        continue;
      }

      const delivered = await deliverNurture(lead, decision);
      if (delivered) {
        result.sent += 1;
      } else {
        await supabase(`leads?lead_id=eq.${encodeURIComponent(lead.lead_id)}&nurture_step=eq.${decision.step}`, {
          method: 'PATCH',
          body: JSON.stringify({ nurture_step: current }),
        });
        result.failed += 1;
      }
    }

    return send(res, 200, result);
  } catch (error) {
    console.error('[api/nurture] Request failed', { errorCode: error?.code || error?.name || 'UNKNOWN' });
    return send(res, 503, { error: 'Job nuôi dưỡng thất bại. Sẽ chạy lại ở lần sau.' });
  }
}
