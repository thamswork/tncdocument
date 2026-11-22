// LINE Messaging API helpers, the alert messages, and the send + history log.
// Keys are NOT in the code: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET,
// LINE_GROUP_ID and ALERT_SECRET are Cloudflare Pages secrets, read from
// locals.runtime.env in the API routes and pages.
import { supabaseAdmin } from './supabase';
import { whtInfo } from './documents';

const LINE_API = 'https://api.line.me';
const SITE = 'https://tncdocument.pages.dev';
const INVOICE_TYPE = '956e1ba7-6ffa-49e0-a009-c9a7a24ae8ab';
const TAX_INVOICE_TYPE = '574ecc98-dd0b-4a7a-8eb2-39dedbcb1011';
const MAX_ROWS = 15; // rows per section in the LINE message (the page shows them all)
const TODO_LINK = `${SITE}/documents/dashboard?ws=todo`;

export type AlertMode = 'due' | 'all';
export type AlertTrigger = 'scheduled' | 'manual' | 'keyword';

// ── Words the team can type in the group (the whole message must be the word) ──
export const WORD_ALL = 'บิลค้างทั้งหมด';
export const WORD_DUE = 'บิลใกล้ครบ';
export const WORD_MENU = 'เมนู';
const KEYWORDS: Record<string, AlertMode> = { [WORD_ALL]: 'all', [WORD_DUE]: 'due' };
const MENU_WORDS = new Set([WORD_MENU, 'menu']);
const clean = (text: string) => String(text || '').replace(/[\s\u200b-\u200d\ufeff]/g, '').toLowerCase();
/** Which alert a group message asks for, or null. Ignores spaces and invisible characters. */
export function keywordMode(text: string): AlertMode | null {
  return KEYWORDS[clean(text)] || null;
}
/** True when the message asks for the menu. */
export function isMenuWord(text: string): boolean {
  return MENU_WORDS.has(clean(text));
}
export const KEYWORD_HELP = `กดปุ่มด้านล่าง หรือพิมพ์ในกลุ่มนี้\n• ${WORD_ALL} = ใบแจ้งหนี้ค้างรับเงินทั้งหมด\n• ${WORD_DUE} = ครบกำหนดพรุ่งนี้ วันนี้ และเกินกำหนด\n• ${WORD_MENU} = แสดงปุ่มนี้อีกครั้ง`;
export const MENU_TEXT = `บอทแจ้งเตือนใบแจ้งหนี้ TNC\n\n${KEYWORD_HELP}`;

/** Tappable buttons shown under the bot's last message (LINE Quick Reply). */
export const QUICK_REPLY = {
  items: [
    { type: 'action', action: { type: 'message', label: WORD_ALL, text: WORD_ALL } },
    { type: 'action', action: { type: 'message', label: WORD_DUE, text: WORD_DUE } },
    { type: 'action', action: { type: 'uri', label: 'เปิดในระบบ', uri: 'https://tncdocument.pages.dev/documents/line' } },
  ],
};

// ── Dates (Bangkok, date only) ──
export function bangkokToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
export function thDate(iso: string, withYear = true, withDay = true): string {
  const d = new Date(iso + 'T00:00:00Z');
  return (withDay ? TH_DAYS[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + TH_MONTHS[d.getUTCMonth()] + (withYear ? ' ' + (d.getUTCFullYear() + 543) : '');
}
export function baht(n: number): string {
  return '฿' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Data: unpaid invoices = INVOICE, not removed, no tax invoice below it ──
async function unpaidInvoices(upTo: string | null) {
  let q: any = supabaseAdmin
    .from('documents')
    .select('id, document_number, issue_date, due_date, total_amount, price_before_vat, apply_wht, status, customers(company_name)')
    .eq('document_type_id', INVOICE_TYPE)
    .neq('status', 'removed');
  if (upTo) q = q.lte('due_date', upTo);
  const { data: invs, error } = await q;
  if (error) throw new Error('documents query failed: ' + error.message);
  const list = (invs || []).filter((d: any) => (upTo ? !!d.due_date : true));
  if (!list.length) return [];
  const { data: txs, error: txErr } = await supabaseAdmin
    .from('documents')
    .select('source_document_id')
    .eq('document_type_id', TAX_INVOICE_TYPE)
    .neq('status', 'removed')
    .in('source_document_id', list.map((d: any) => d.id));
  if (txErr) throw new Error('tax invoice query failed: ' + txErr.message);
  const paid = new Set((txs || []).map((t: any) => t.source_document_id));
  return list.filter((d: any) => !paid.has(d.id));
}
/** Unpaid invoices due on or before `upTo` (the daily alert). */
export const getDueInvoices = (upTo: string) => unpaidInvoices(upTo);
/** Every unpaid invoice, with or without a due date. */
export const getAllUnpaidInvoices = () => unpaidInvoices(null);

// ── Message text (pure, so it can be tested without LINE) ──
const byDue = (a: any, b: any) =>
  a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : String(a.document_number).localeCompare(String(b.document_number));
const byIssue = (a: any, b: any) => {
  const x = String(a.issue_date || ''), y = String(b.issue_date || '');
  return x < y ? -1 : x > y ? 1 : String(a.document_number).localeCompare(String(b.document_number));
};
export const sumNet = (arr: any[]) => Math.round(arr.reduce((s, d) => s + whtInfo(d).net, 0) * 100) / 100;

// ── Compact pieces for the LINE message ──
const COMBINING = /[ัิ-ฺ็-๎]/;
/** Customer name without บริษัท / จำกัด / (สำนักงานใหญ่) etc., cut to `max` characters. */
export function shortName(name: string, max = 18): string {
  let n = String(name || '-')
    .replace(/\s*\((?:สำนักงานใหญ่|สาขา[^)]*)\)\s*/g, ' ')
    .replace(/^\s*(?:บริษัท|บจก\.?|ห้างหุ้นส่วนจำกัด|หจก\.?)\s*/, '')
    .replace(/\s*(?:จำกัด\s*\(มหาชน\)|จำกัด|\(มหาชน\))\s*$/, '')
    .replace(/\s+/g, ' ').trim() || '-';
  const ch = [...n];
  if (ch.length <= max) return n;
  let cut = max - 1;
  while (cut < ch.length && COMBINING.test(ch[cut])) cut++; // never split a Thai vowel/tone mark from its letter
  return ch.slice(0, cut).join('').trim() + '…';
}
/** Document number without the current Buddhist year (SV0106-63/2569 -> SV0106-63). Other years stay. */
export function shortNo(no: string, today: string): string {
  const y = String(Number(today.slice(0, 4)) + 543);
  return String(no || '').replace(new RegExp('/' + y + '$'), '');
}
/** ฿110,448 or ฿62,056.80 (satang only when there are any). */
export function bahtShort(n: number): string {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return '฿' + v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

export type AlertItem = { id: string; no: string; shortNo: string; customer: string; shortCustomer: string; net: number; note: string };
export type AlertSection = { key: string; title: string; count: number; total: number; items: AlertItem[] };

function mkSection(key: string, title: string, arr: any[], today: string, note: (d: any) => string = () => ''): AlertSection {
  return {
    key, title, count: arr.length, total: sumNet(arr),
    items: arr.map(d => ({
      id: d.id, no: d.document_number, shortNo: shortNo(d.document_number, today),
      customer: d.customers?.company_name || '-', shortCustomer: shortName(d.customers?.company_name),
      net: whtInfo(d).net, note: note(d),
    })),
  };
}
const lateNote = (today: string) => (d: any) => `${daysBetween(d.due_date, today)} วัน`;

/** Sections for the daily alert: due tomorrow, due today, overdue (empty ones left out). */
export function dueSections(invoices: any[], today: string): AlertSection[] {
  const tomorrow = addDays(today, 1);
  invoices = [...invoices].filter(d => d.due_date).sort(byDue);
  return [
    mkSection('tomorrow', `ครบพรุ่งนี้ (${thDate(tomorrow, false)})`, invoices.filter(d => d.due_date === tomorrow), today),
    mkSection('today', `ครบวันนี้ (${thDate(today, false)})`, invoices.filter(d => d.due_date === today), today),
    mkSection('over', 'เกินกำหนด', invoices.filter(d => d.due_date < today), today, lateNote(today)),
  ].filter(s => s.count);
}
/** Sections for every unpaid invoice: overdue, today, tomorrow, later, no due date. */
export function allSections(invoices: any[], today: string): AlertSection[] {
  const tomorrow = addDays(today, 1);
  const dated = invoices.filter(d => d.due_date).sort(byDue);
  return [
    mkSection('over', 'เกินกำหนด', dated.filter(d => d.due_date < today), today, lateNote(today)),
    mkSection('today', `ครบวันนี้ (${thDate(today, false)})`, dated.filter(d => d.due_date === today), today),
    mkSection('tomorrow', `ครบพรุ่งนี้ (${thDate(tomorrow, false)})`, dated.filter(d => d.due_date === tomorrow), today),
    mkSection('later', 'ยังไม่ถึงกำหนด', dated.filter(d => d.due_date > tomorrow), today, d => `ครบ ${thDate(d.due_date, false, false)}`),
    mkSection('none', 'ยังไม่ระบุวันครบกำหนด', invoices.filter(d => !d.due_date).sort(byIssue), today, d => (d.issue_date ? `ออก ${thDate(d.issue_date, false, false)}` : '')),
  ].filter(s => s.count);
}

const LINE_LIMIT = 4800; // LINE allows 5,000 characters per bubble; keep a margin
/** One line per invoice, one link at the end. Usually a single bubble; split by section only if very long. */
function render(heading: string, sections: AlertSection[], count: number, total: number): string[] {
  if (!sections.length) return [];
  const blocks = sections.map(s => {
    const rows = s.items.slice(0, MAX_ROWS).map(i => `• ${i.shortNo} ${i.shortCustomer} ${bahtShort(i.net)}${i.note ? ' · ' + i.note : ''}`);
    if (s.count > MAX_ROWS) rows.push(`และอีก ${s.count - MAX_ROWS} ใบ`);
    return `${s.title} · ${s.count} ใบ · ${bahtShort(s.total)}\n${rows.join('\n')}`;
  });
  const head = sections.length > 1 ? `${heading}\nรวม ${count} ใบ · ${bahtShort(total)}` : heading;
  const foot = `ดูทั้งหมด: ${TODO_LINK}`;
  const out: string[] = [];
  let cur = head;
  for (const b of blocks) {
    if ((cur + '\n\n' + b).length > LINE_LIMIT && cur) { out.push(cur); cur = b; }
    else cur = cur ? cur + '\n\n' + b : b;
  }
  if ((cur + '\n\n' + foot).length > LINE_LIMIT) { out.push(cur); cur = foot; } else cur += '\n\n' + foot;
  out.push(cur);
  return out.slice(0, 5);
}

/** Daily alert: due tomorrow, due today, overdue. Empty array = nothing to send. */
export function buildDueAlert(invoices: any[], today: string): string[] {
  const secs = dueSections(invoices, today);
  const n = secs.reduce((a, s) => a + s.count, 0);
  return render(`แจ้งเตือนบิล ${thDate(today)}`, secs, n, Math.round(secs.reduce((a, s) => a + s.total, 0) * 100) / 100);
}
/** Every unpaid invoice, grouped. */
export function buildAllUnpaidAlert(invoices: any[], today: string): string[] {
  return render(`บิลค้างทั้งหมด ${thDate(today)}`, allSections(invoices, today), invoices.length, sumNet(invoices));
}

/** Text the bot replies with when someone asks and there is nothing to report. */
export function nothingText(mode: AlertMode, today: string): string {
  return mode === 'all'
    ? `ไม่มีบิลค้างรับเงิน ณ ${thDate(today)}`
    : `ไม่มีบิลครบพรุ่งนี้ วันนี้ หรือเกินกำหนด ณ ${thDate(today)}\nกด "${WORD_ALL}" เพื่อดูบิลค้างทั้งหมด`;
}

/** Builds the message for a mode, with the sections and counts the page and history need. */
export async function prepareAlert(mode: AlertMode, today = bangkokToday()) {
  if (mode === 'all') {
    const all = await getAllUnpaidInvoices();
    return { mode, today, messages: buildAllUnpaidAlert(all, today), sections: allSections(all, today), count: all.length, totalNet: sumNet(all) };
  }
  const due = await getDueInvoices(addDays(today, 1));
  return { mode, today, messages: buildDueAlert(due, today), sections: dueSections(due, today), count: due.length, totalNet: sumNet(due) };
}

// ── LINE API ──
async function lineCall(path: string, token: string, body: any, retryKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (retryKey) headers['X-Line-Retry-Key'] = retryKey;
  try {
    const res = await fetch(LINE_API + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } catch (e: any) {
    return { ok: false, status: 0, body: 'Could not reach LINE: ' + (e?.message || e) };
  }
}
async function lineGet(path: string, token: string): Promise<any> {
  try {
    const res = await fetch(LINE_API + path, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
/** Text bubbles (max 5). With quick=true the buttons go on the last bubble, where LINE shows them. */
function asMessages(texts: string[], quick: boolean) {
  const msgs: any[] = texts.slice(0, 5).map(text => ({ type: 'text', text }));
  if (quick && msgs.length) msgs[msgs.length - 1].quickReply = QUICK_REPLY;
  return msgs;
}
export function pushText(token: string, to: string, texts: string[], quick = false) {
  return lineCall('/v2/bot/message/push', token, { to, messages: asMessages(texts, quick) }, crypto.randomUUID());
}
/** Replies are free: they don't count toward the monthly message quota. */
export function replyText(token: string, replyToken: string, texts: string | string[], quick = false) {
  return lineCall('/v2/bot/message/reply', token, { replyToken, messages: asMessages(Array.isArray(texts) ? texts : [texts], quick) });
}
/** Display name of a group member, or null. */
export async function groupMemberName(token: string, groupId: string, userId: string): Promise<string | null> {
  if (!token || !groupId || !userId) return null;
  const p = await lineGet(`/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`, token);
  return p?.displayName ? String(p.displayName).slice(0, 100) : null;
}
/** Monthly quota, messages used this month, and group size (null where LINE can't be reached). */
export async function getLineUsage(env: any) {
  const token = String(env?.LINE_CHANNEL_ACCESS_TOKEN || '');
  if (!token) return null;
  const [quota, used, members] = await Promise.all([
    lineGet('/v2/bot/message/quota', token),
    lineGet('/v2/bot/message/quota/consumption', token),
    env?.LINE_GROUP_ID ? lineGet(`/v2/bot/group/${encodeURIComponent(env.LINE_GROUP_ID)}/members/count`, token) : null,
  ]);
  return {
    limit: quota?.type === 'limited' ? Number(quota.value) : null, // null = no monthly limit
    used: used && used.totalUsage != null ? Number(used.totalUsage) : null,
    members: members && members.count != null ? Number(members.count) : null,
  };
}

// ── Send + history ──
/**
 * Builds, sends and records one alert.
 *  - scheduled: the 09:00 job (push)
 *  - manual:    the send-now button on the แจ้งเตือน LINE page (push)
 *  - keyword:   someone typed a keyword in the group (free reply; pass replyToken)
 * dry: build only, send and record nothing.
 */
export async function runAlert(opts: {
  env: any; mode: AlertMode; trigger: AlertTrigger; userId?: string | null;
  requestedByName?: string | null; replyToken?: string; dry?: boolean;
}) {
  const { env, mode, trigger, userId = null, requestedByName = null, replyToken, dry = false } = opts;
  const p = await prepareAlert(mode);
  const base = { mode, today: p.today, bubbles: p.messages.length, count: p.count, total_net: p.totalNet };
  if (dry) return { ...base, dry: true, messages: p.messages, httpStatus: 200 };

  const log = async (row: any) => {
    const { error } = await supabaseAdmin.from('line_alerts').insert({
      trigger, mode, sent_by: userId, requested_by_name: requestedByName,
      invoice_count: p.count, total_net: p.totalNet, bubbles: p.messages.length,
      message: p.messages.join('\n\n────────\n\n') || null, ...row,
    });
    return !error;
  };

  const token = String(env?.LINE_CHANNEL_ACCESS_TOKEN || '');
  const missing = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_GROUP_ID'].filter(k => !env?.[k]);

  // Nothing to report: the 09:00 job and the button send nothing; a keyword still gets a short answer.
  if (!p.messages.length) {
    if (trigger === 'keyword' && replyToken && token) {
      const r = await replyText(token, replyToken, nothingText(mode, p.today), true);
      await log({ status: r.ok ? 'sent' : 'failed', line_status: r.status, error: r.ok ? null : r.body, message: nothingText(mode, p.today) });
      return { ...base, sent: r.ok, httpStatus: 200 };
    }
    await log({ status: 'skipped' });
    return { ...base, sent: false, reason: 'nothing to send', httpStatus: 200 };
  }
  if (missing.length) {
    const error = 'ยังไม่ได้ตั้งค่า Cloudflare secret: ' + missing.join(', ');
    await log({ status: 'failed', error });
    return { ...base, sent: false, error, httpStatus: 500 };
  }
  // Every message to the team group carries the quick-reply buttons
  const r = trigger === 'keyword' && replyToken
    ? await replyText(token, replyToken, p.messages, true)
    : await pushText(token, env.LINE_GROUP_ID, p.messages, true);
  await log({ status: r.ok ? 'sent' : 'failed', line_status: r.status, error: r.ok ? null : r.body });
  return { ...base, sent: r.ok, line_status: r.status, line_body: r.ok ? undefined : r.body, httpStatus: r.ok ? 200 : 502 };
}

/** Latest alerts for the history list. */
export async function getAlertHistory(from: number, to: number) {
  const { data, count } = await supabaseAdmin
    .from('line_alerts')
    .select('id, created_at, trigger, mode, status, invoice_count, total_net, bubbles, line_status, error, message, requested_by_name, tnc_users(full_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  return { rows: data || [], total: count || 0 };
}

// ── Webhook signature: base64(HMAC-SHA256(channel secret, raw body)) ──
export async function verifySignature(channelSecret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!channelSecret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  return safeEqual(btoa(bin), signature);
}

/** Constant-time string compare (for secrets and signatures). */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
