import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';
import { round2, addDaysIso } from '../../../lib/documents';

export async function POST({ request, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json();
  const { source_doc_id, source_doc_num, customer_id, pct, amount, label, issue_date, due_date } = body;

  if (!customer_id || !amount) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  // Get IV document type id
  const { data: dtData } = await supabaseAdmin
    .from('document_types')
    .select('id')
    .eq('code', 'INVOICE')
    .single();
  if (!dtData) return new Response(JSON.stringify({ error: 'Invoice type not found' }), { status: 500 });

  // Get next document number using sequence table
  const buddhistYear = new Date().getFullYear() + 543;
  const { data: seq } = await supabaseAdmin
    .from('document_sequences')
    .select('id, last_number')
    .eq('document_type_id', dtData.id)
    .eq('year', buddhistYear)
    .single();
  let nextNum = 1;
  if (seq) {
    nextNum = seq.last_number + 1;
    await supabaseAdmin.from('document_sequences').update({ last_number: nextNum }).eq('id', seq.id);
  } else {
    await supabaseAdmin.from('document_sequences').insert({ document_type_id: dtData.id, year: buddhistYear, last_number: 1 });
  }
  // Use parent doc number as base e.g. IV0002-1/2569
  const parentBase = source_doc_num ? source_doc_num.replace('/'+buddhistYear,'') : ('IV'+String(nextNum).padStart(4,'0'));
  const docNumber = parentBase + '-' + nextNum + '/' + buddhistYear;

  // Work from the source document's before-VAT figure (pct × price_before_vat),
  // then VAT = 7% of that, total = before-VAT + VAT. Back-calculating from a
  // VAT-inclusive amount (÷1.07) made installments drift by a satang or two.
  let beforeVat = round2(amount / 1.07);
  const pctNum = Number(pct);
  const { data: src } = source_doc_id
    ? await supabaseAdmin.from('documents').select('price_before_vat, credit_days').eq('id', source_doc_id).single()
    : { data: null as any };
  if (src && pctNum > 0 && pctNum <= 100 && Number(src.price_before_vat) > 0) {
    beforeVat = round2(Number(src.price_before_vat) * pctNum / 100);
  }
  // The invoice keeps the quotation's credit term; its due date counts from
  // this invoice's own date unless a due date was typed in.
  const creditDays: number | null = src?.credit_days ?? null;
  const invDate = issue_date || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const invDue = due_date || (creditDays !== null ? addDaysIso(invDate, creditDays) : null);
  const vatAmt = round2(beforeVat * 0.07);
  const totalAmt = round2(beforeVat + vatAmt);

  // Insert document
  const { data: doc, error: docErr } = await supabaseAdmin
    .from('documents')
    .insert({
      document_number: docNumber,
      document_type_id: dtData.id,
      customer_id,
      status: 'in_progress', // lifecycle: new documents start in progress (no draft gate)
      last_activity_at: new Date().toISOString(),
      language: 'th',
      issue_date: invDate,
      due_date: invDue,
      credit_days: creditDays,
      reference_po: source_doc_num,
      source_document_id: source_doc_id || null,
      payment_condition: label,
      subtotal: beforeVat,
      discount_design: 0,
      discount_trade: 0,
      price_before_vat: beforeVat,
      vat_amount: vatAmt,
      total_amount: totalAmt,
      notes: '',
      created_by: user.id,
      issued_by: user.id,
    })
    .select()
    .single();

  if (docErr) return new Response(JSON.stringify({ error: docErr.message }), { status: 500 });

  // Insert category
  const { data: cat, error: catErr } = await supabaseAdmin
    .from('document_categories')
    .insert({
      document_id: doc.id,
      category_number: '1',
      name_th: 'ใบแจ้งหนี้งวด ' + pct + '% จากเอกสาร ' + source_doc_num,
      name_en: '',
      sort_order: 0,
    })
    .select()
    .single();

  if (catErr) return new Response(JSON.stringify({ error: catErr.message }), { status: 500 });

  // Insert item
  const { error: itemErr } = await supabaseAdmin
    .from('document_items')
    .insert({
      document_id: doc.id,
      category_id: cat.id,
      item_number: '1.1',
      item_code: '',
      description_th: 'ชำระงวด ' + pct + '% — ' + label + ' (อ้างอิงเอกสาร ' + source_doc_num + ')',
      quantity: 1,
      unit_th: 'งวด',
      unit_price: beforeVat,
      amount: beforeVat,
      is_subtotal_row: false,
      sort_order: 0,
    });

  if (itemErr) return new Response(JSON.stringify({ error: itemErr.message }), { status: 500 });

  return new Response(JSON.stringify({ id: doc.id, document_number: docNumber }), { status: 200 });
}
