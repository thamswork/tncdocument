// LINE Messaging API helpers and the daily due-date alert.
// Keys are NOT in the code: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET,
// LINE_GROUP_ID and ALERT_SECRET are Cloudflare Pages secrets, read from
// locals.runtime.env in the API routes.
import { supabaseAdmin } from './supabase';
import { whtInfo } from './documents';

const LINE_API = 'https://api.line.me';
const SITE = 'https://tncdocument.pages.dev';
const INVOICE_TYPE = '956e1ba7-6ffa-49e0-a009-c9a7a24ae8ab';
const TAX_INVOICE_TYPE = '574ecc98-dd0b-4a7a-8eb2-39dedbcb1011';
const MAX_ROWS = 20; // per section, keeps each LINE bubble well under 5,000 characters

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

// ── Data: unpaid invoices (no tax invoice below them) due on or before a date ──
export async function getDueInvoices(upTo: string) {
  const { data: invs, error } = await supabaseAdmin
    .from('documents')
    .select('id, document_number, due_date, total_amount, price_before_vat, apply_wht, status, customers(company_name)')
    .eq('document_type_id', INVOICE_TYPE)
    .neq('status', 'removed')
    .lte('due_date', upTo)
    .order('due_date', { ascending: true });
  if (error) throw new Error('documents query failed: ' + error.message);
  const list = (invs || []).filter((d: any) => d.due_date);
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

// ── Message text (pure, so it can be tested without LINE) ──
export function buildDueAlert(invoices: any[], today: string): string[] {
  const tomorrow = addDays(today, 1);
  // Stable order: due date, then document number
  invoices = [...invoices].sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : String(a.document_number).localeCompare(String(b.document_number))));
  const row = (d: any, i: number, extra = '') => {
    const net = whtInfo(d).net;
    return `${i + 1}. ${d.document_number}${extra}\n   ${d.customers?.company_name || '-'}\n   ยอดโอนสุทธิ ${baht(net)}\n   ${SITE}/documents/${d.id}`;
  };
  const sum = (arr: any[]) => arr.reduce((s, d) => s + whtInfo(d).net, 0);
  const section = (title: string, arr: any[], extra: (d: any) => string = () => '') => {
    const shown = arr.slice(0, MAX_ROWS).map((d, i) => row(d, i, extra(d)));
    const more = arr.length > MAX_ROWS ? `\n\nและอีก ${arr.length - MAX_ROWS} รายการ ดูทั้งหมด: ${SITE}/documents/dashboard?ws=todo` : '';
    return `${title}\n${arr.length} รายการ · รวม ${baht(sum(arr))}\n\n${shown.join('\n\n')}${more}`;
  };

  const dueTomorrow = invoices.filter(d => d.due_date === tomorrow);
  const dueToday = invoices.filter(d => d.due_date === today);
  const overdue = invoices.filter(d => d.due_date < today); // oldest due date first

  const msgs: string[] = [];
  if (dueTomorrow.length) msgs.push(section(`ครบกำหนดชำระพรุ่งนี้ (${thDate(tomorrow, false)})`, dueTomorrow));
  if (dueToday.length) msgs.push(section(`ครบกำหนดชำระวันนี้ (${thDate(today, false)})`, dueToday));
  if (overdue.length) msgs.push(section('เกินกำหนดชำระ', overdue, d => ` · เกิน ${daysBetween(d.due_date, today)} วัน`));
  if (!msgs.length) return [];
  msgs[0] = `แจ้งเตือนใบแจ้งหนี้ ${thDate(today)}\n\n` + msgs[0];
  msgs[msgs.length - 1] += `\n\nรายการค้างรับเงินทั้งหมด: ${SITE}/documents/dashboard?ws=todo`;
  return msgs; // at most 3 bubbles; LINE allows 5 per request and counts the request once per member
}

// ── LINE API ──
async function lineCall(path: string, token: string, body: any, retryKey?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (retryKey) headers['X-Line-Retry-Key'] = retryKey;
  const res = await fetch(LINE_API + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}
export function pushText(token: string, to: string, texts: string[]) {
  return lineCall('/v2/bot/message/push', token, { to, messages: texts.slice(0, 5).map(text => ({ type: 'text', text })) }, crypto.randomUUID());
}
export function replyText(token: string, replyToken: string, text: string) {
  return lineCall('/v2/bot/message/reply', token, { replyToken, messages: [{ type: 'text', text }] });
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
