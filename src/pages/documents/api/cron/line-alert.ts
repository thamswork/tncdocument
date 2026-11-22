// Daily LINE alert: invoices due tomorrow, due today, and overdue (no tax invoice yet).
// Called by .github/workflows/line-alert.yml at 09:00 Bangkok time.
// Protected by its own secret (ALERT_SECRET, a Cloudflare secret + GitHub secret),
// separate from the older cron secret. Every run is recorded on the แจ้งเตือน LINE page.
// ?dry=1 returns the message without sending or recording it.
import { runAlert, safeEqual } from '../../../../lib/line';

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function POST({ request, locals, url }: any) {
  const env = locals?.runtime?.env || {};
  const expected = String(env.ALERT_SECRET || '');
  if (expected.length < 16 || !safeEqual(request.headers.get('x-alert-secret') || '', expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const { httpStatus, ...result } = await runAlert({ env, mode: 'due', trigger: 'scheduled', dry: url.searchParams.get('dry') === '1' });
    return json(result, httpStatus);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}
