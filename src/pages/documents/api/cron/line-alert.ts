// Daily LINE alert: invoices due tomorrow, due today, and overdue (no tax invoice yet).
// Called by .github/workflows/line-alert.yml at 09:00 Bangkok time.
// Protected by its own secret (ALERT_SECRET, a Cloudflare secret + GitHub secret),
// separate from the older cron secret.
// ?dry=1 returns the message without sending it to LINE.
import { addDays, bangkokToday, buildDueAlert, getDueInvoices, pushText, safeEqual } from '../../../../lib/line';

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function POST({ request, locals, url }: any) {
  const env = locals?.runtime?.env || {};
  const expected = String(env.ALERT_SECRET || '');
  if (expected.length < 16 || !safeEqual(request.headers.get('x-alert-secret') || '', expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const today = bangkokToday();
  let messages: string[];
  try {
    messages = buildDueAlert(await getDueInvoices(addDays(today, 1)), today);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }

  if (url.searchParams.get('dry') === '1') return json({ dry: true, today, bubbles: messages.length, messages });
  if (!messages.length) return json({ sent: false, today, reason: 'nothing due tomorrow, due today or overdue' });

  const missing = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_GROUP_ID'].filter(k => !env[k]);
  if (missing.length) return json({ error: 'Missing Cloudflare secret(s): ' + missing.join(', ') }, 500);

  const r = await pushText(env.LINE_CHANNEL_ACCESS_TOKEN, env.LINE_GROUP_ID, messages);
  return json({ sent: r.ok, today, bubbles: messages.length, line_status: r.status, line_body: r.ok ? undefined : r.body }, r.ok ? 200 : 502);
}
