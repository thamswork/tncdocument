// LINE webhook: LINE calls this when the bot joins a group or someone messages it.
// Its only job is to tell you the group ID (needed for LINE_GROUP_ID):
//  - when the bot is added to a group, it replies with that group's ID;
//  - typing "group id" or "ไอดีกลุ่ม" in the group gets the same reply.
// Replies are free (they don't count toward the LINE message quota).
// Every request must carry a valid LINE signature (LINE_CHANNEL_SECRET).
import { replyText, verifySignature } from '../../../../lib/line';

export async function POST({ request, locals }: any) {
  const env = locals?.runtime?.env || {};
  const raw = await request.text();
  if (!(await verifySignature(String(env.LINE_CHANNEL_SECRET || ''), raw, request.headers.get('x-line-signature')))) {
    return new Response('Bad signature', { status: 401 });
  }
  let events: any[] = [];
  try { events = JSON.parse(raw).events || []; } catch { return new Response('Bad JSON', { status: 400 }); }

  const token = String(env.LINE_CHANNEL_ACCESS_TOKEN || '');
  for (const ev of events) {
    const groupId = ev?.source?.type === 'group' ? ev.source.groupId : '';
    if (!groupId || !ev.replyToken || !token) continue;
    const asked = ev.type === 'message' && ev.message?.type === 'text' && /^\s*(group\s*id|ไอดีกลุ่ม)\s*$/i.test(ev.message.text || '');
    if (ev.type !== 'join' && !asked) continue;
    const configured = env.LINE_GROUP_ID === groupId;
    const text = configured
      ? 'กลุ่มนี้ตั้งค่าแจ้งเตือนใบแจ้งหนี้แล้ว จะส่งสรุปทุกวันเวลาประมาณ 09:00 น.'
      : `บอทแจ้งเตือนใบแจ้งหนี้ TNC เข้ากลุ่มแล้ว\n\nGroup ID ของกลุ่มนี้:\n${groupId}\n\nนำค่านี้ไปตั้งเป็น LINE_GROUP_ID เพื่อเริ่มส่งแจ้งเตือน`;
    await replyText(token, ev.replyToken, text);
  }
  // LINE expects a quick 200 (also for the "Verify" button, which sends no events)
  return new Response('OK', { status: 200 });
}
