// LINE webhook: LINE calls this for every event on the TNC account
// (customer chats included). It only ever acts in groups:
//  - Bot added to a group, or "ไอดีกลุ่ม" / "group id" typed: replies with the group ID
//    (or, in the team group, that it is set up plus the keyword list).
//  - In the team group only (LINE_GROUP_ID), a keyword gets the alert as a reply:
//      ค้างชำระ / ขอดูใบค้างชำระ  -> all unpaid invoices
//      ครบกำหนด                  -> due tomorrow, due today, overdue
//    Replies are free (they don't count toward the LINE message quota).
// Customer one-to-one chats and ordinary group chat are ignored.
// Every request must carry a valid LINE signature (LINE_CHANNEL_SECRET).
import { KEYWORD_HELP, groupMemberName, keywordMode, replyText, runAlert, verifySignature } from '../../../../lib/line';

const ID_WORDS = /^\s*(group\s*id|ไอดีกลุ่ม)\s*$/i;

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
    try {
      const groupId = ev?.source?.type === 'group' ? ev.source.groupId : '';
      if (!groupId || !ev.replyToken || !token) continue; // not a group (e.g. a customer chat): ignore
      const isTeamGroup = !!env.LINE_GROUP_ID && env.LINE_GROUP_ID === groupId;
      const text = ev.type === 'message' && ev.message?.type === 'text' ? String(ev.message.text || '') : '';

      // Bot joined, or someone asked for the group ID
      if (ev.type === 'join' || ID_WORDS.test(text)) {
        await replyText(token, ev.replyToken, isTeamGroup
          ? `กลุ่มนี้ตั้งค่าแจ้งเตือนใบแจ้งหนี้แล้ว ส่งสรุปทุกวันเวลาประมาณ 09:00 น.\n\n${KEYWORD_HELP}`
          : `บอทแจ้งเตือนใบแจ้งหนี้ TNC เข้ากลุ่มแล้ว\n\nGroup ID ของกลุ่มนี้:\n${groupId}\n\nนำค่านี้ไปตั้งเป็น LINE_GROUP_ID เพื่อเริ่มส่งแจ้งเตือน`);
        continue;
      }

      // Keywords: team group only, so no other group can pull the invoice list
      const mode = isTeamGroup ? keywordMode(text) : null;
      if (!mode) continue;
      const name = await groupMemberName(token, groupId, ev.source.userId || '');
      await runAlert({ env, mode, trigger: 'keyword', requestedByName: name, replyToken: ev.replyToken });
    } catch {
      // One bad event must not stop the others or make LINE retry the whole batch
    }
  }
  // LINE expects a quick 200 (also for the "Verify" button, which sends no events)
  return new Response('OK', { status: 200 });
}
