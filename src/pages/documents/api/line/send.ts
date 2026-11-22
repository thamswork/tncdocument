// Send-now button on the แจ้งเตือน LINE page. Logged-in users only (the middleware
// requires a session for this path). Body: { "mode": "due" | "all" }.
import { runAlert } from '../../../../lib/line';

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function POST({ request, locals }: any) {
  const user = locals?.user;
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
  let mode: 'due' | 'all' = 'due';
  try {
    const body = await request.json();
    if (body?.mode === 'all') mode = 'all';
  } catch { /* default: due */ }
  try {
    const { httpStatus, ...result } = await runAlert({ env: locals?.runtime?.env || {}, mode, trigger: 'manual', userId: user.id });
    return json(result, httpStatus);
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
}
