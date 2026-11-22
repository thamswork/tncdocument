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
const MAX_ROWS = 20; // per section, keeps each LINE bubble well under 5,000 characters
const TODO_LINK = `${SITE}/documents/dashboard?ws=todo`;

export type AlertMode = 'due' | 'all';
export type AlertTrigger = 'scheduled' | 'manual' | 'keyword';

// ── Keywords the team can type in the group (the whole message must be the keyword) ──
const KEYWORDS: Record<string, AlertMode> = {
  'ค้างชำระ': 'all',
  'ขอดูใบค้างชำระ': 'all',
  'ขอดูใบข้างชำระ': 'all', // common typo
  'ครบกำหนด': 'due',
};
/** Which alert a group message asks for, or null. Ignores spaces and invisible characters. */
export function keywordMode(text: string): AlertMode | null {
  const t = String(text || '').replace(/[\s\u200b-\u200d\ufeff]/g, '');
  return KEYWORDS[t] || null;
}
export const KEYWORD_HELP = 'พิมพ์ในกลุ่มนี้ได้เลย\n• ค้างชำระ หรือ ขอดูใบค้างชำระ = ใบแจ้งหนี้ค้างรับเงินทั้งหมด\n• ครบกำหนด = ครบกำหนดพรุ่งนี้ วันนี้ และเกินกำหนด';

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
function row(d: any, i: number, extra = '') {
  return `${i + 1}. ${d.document_number}${extra}\n   ${d.customers?.company_name || '-'}\n   ยอดโอนสุทธิ ${baht(whtInfo(d).net)}\n   ${SITE}/documents/${d.id}`;
}
function section(title: string, arr: any[], extra: (d: any) => string = () => '') {
  const shown = arr.slice(0, MAX_ROWS).map((d, i) => row(d, i, extra(d)));
  const more = arr.length > MAX_ROWS ? `\n\nและอีก ${arr.length - MAX_ROWS} รายการ ดูทั้งหมด: ${TODO_LINK}` : '';
  return `${title}\n${arr.length} รายการ · รวม ${baht(sumNet(arr))}\n\n${shown.join('\n\n')}${more}`;
}

/** Daily alert: due tomorrow, due today, overdue. Empty array = nothing to send. */
export function buildDueAlert(invoices: any[], today: string): string[] {
  const tomorrow = addDays(today, 1);
  invoices = [...invoices].sort(byDue);
  const dueTomorrow = invoices.filter(d => d.due_date === tomorrow);
  const dueToday = invoices.filter(d => d.due_date === today);
  const overdue = invoices.filter(d => d.due_date < today); // oldest due date first

  const msgs: string[] = [];
  if (dueTomorrow.length) msgs.push(section(`ครบกำหนดชำระพรุ่งนี้ (${thDate(tomorrow, false)})`, dueTomorrow));
  if (dueToday.length) msgs.push(section(`ครบกำหนดชำระวันนี้ (${thDate(today, false)})`, dueToday));
  if (overdue.length) msgs.push(section('เกินกำหนดชำระ', overdue, d => ` · เกิน ${daysBetween(d.due_date, today)} วัน`));
  if (!msgs.length) return [];
  msgs[0] = `แจ้งเตือนใบแจ้งหนี้ ${thDate(today)}\n\n` + msgs[0];
  msgs[msgs.length - 1] += `\n\nรายการค้างรับเงินทั้งหมด: ${TODO_LINK}`;
  return msgs; // at most 3 bubbles
}

/** Every unpaid invoice, grouped. At most 5 bubbles (LINE's limit per request). */
export function buildAllUnpaidAlert(invoices: any[], today: string): string[] {
  const tomorrow = addDays(today, 1);
  const dated = invoices.filter(d => d.due_date).sort(byDue);
  const overdue = dated.filter(d => d.due_date < today);
  const dueToday = dated.filter(d => d.due_date === today);
  const dueTomorrow = dated.filter(d => d.due_date === tomorrow);
  const later = dated.filter(d => d.due_date > tomorrow);
  const noDue = invoices.filter(d => !d.due_date).sort(byIssue);

  const msgs: string[] = [];
  if (overdue.length) msgs.push(section('เกินกำหนดชำระ', overdue, d => ` · เกิน ${daysBetween(d.due_date, today)} วัน`));
  if (dueToday.length) msgs.push(section(`ครบกำหนดชำระวันนี้ (${thDate(today, false)})`, dueToday));
  if (dueTomorrow.length) msgs.push(section(`ครบกำหนดชำระพรุ่งนี้ (${thDate(tomorrow, false)})`, dueTomorrow));
  if (later.length) msgs.push(section('ยังไม่ถึงกำหนดชำระ', later, d => ` · ครบกำหนด ${thDate(d.due_date, false, false)}`));
  if (noDue.length) msgs.push(section('ยังไม่ได้ระบุวันครบกำหนด', noDue, d => (d.issue_date ? ` · ออกเมื่อ ${thDate(d.issue_date, false, false)} (${daysBetween(d.issue_date, today)} วัน)` : '')));
  if (!msgs.length) return [];
  msgs[0] = `สรุปใบแจ้งหนี้ค้างรับเงินทั้งหมด ${thDate(today)}\n${invoices.length} รายการ · รวม ${baht(sumNet(invoices))}\n\n` + msgs[0];
  msgs[msgs.length - 1] += `\n\nดูในระบบ: ${TODO_LINK}`;
  return msgs;
}

/** Text the bot replies with when someone asks and there is nothing to report. */
export function nothingText(mode: AlertMode, today: string): string {
  return mode === 'all'
    ? `ไม่มีใบแจ้งหนี้ค้างรับเงิน ณ ${thDate(today)}`
    : `ไม่มีใบแจ้งหนี้ครบกำหนดพรุ่งนี้ วันนี้ หรือเกินกำหนด ณ ${thDate(today)}\nพิมพ์ "ค้างชำระ" เพื่อดูรายการค้างรับเงินทั้งหมด`;
}

/** Builds the message for a mode, with the counts the page and history need. */
export async function prepareAlert(mode: AlertMode, today = bangkokToday()) {
  if (mode === 'all') {
    const all = await getAllUnpaidInvoices();
    return { mode, today, messages: buildAllUnpaidAlert(all, today), count: all.length, totalNet: sumNet(all) };
  }
  const due = await getDueInvoices(addDays(today, 1));
  return { mode, today, messages: buildDueAlert(due, today), count: due.length, totalNet: sumNet(due) };
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
const asMessages = (texts: string[]) => texts.slice(0, 5).map(text => ({ type: 'text', text }));
export function pushText(token: string, to: string, texts: string[]) {
  return lineCall('/v2/bot/message/push', token, { to, messages: asMessages(texts) }, crypto.randomUUID());
}
/** Replies are free: they don't count toward the monthly message quota. */
export function replyText(token: string, replyToken: string, texts: string | string[]) {
  return lineCall('/v2/bot/message/reply', token, { replyToken, messages: asMessages(Array.isArray(texts) ? texts : [texts]) });
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
      const r = await replyText(token, replyToken, nothingText(mode, p.today));
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
  const r = trigger === 'keyword' && replyToken
    ? await replyText(token, replyToken, p.messages)
    : await pushText(token, env.LINE_GROUP_ID, p.messages);
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
