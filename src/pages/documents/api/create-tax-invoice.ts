import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function POST({ request, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const body = await request.json();
  const { source_doc_id, source_doc_num, customer_id, total_amount, issue_date } = body;

  if (!customer_id || !total_amount) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  // Check no TX already exists for this source doc
  const { data: existing } = await supabaseAdmin
    .from('documents')
    .select('id')
    .eq('source_document_id', source_doc_id)
    .eq('document_type_id', '574ecc98-dd0b-4a7a-8eb2-39dedbcb1011')
    .limit(1);
  if (existing && existing.length > 0) {
    return new Response(JSON.stringify({ error: 'มีใบกำกับภาษีสำหรับเอกสารนี้แล้ว' }), { status: 409 });
  }

  const TX_TYPE = '574ecc98-dd0b-4a7a-8eb2-39dedbcb1011';
  const buddhistYear = new Date().getFullYear() + 543;

  // Get next TX number
  const { data: seq } = await supabaseAdmin
    .from('document_sequences')
    .select('id, last_number')
    .eq('document_type_id', TX_TYPE)
    .eq('year', buddhistYear)
    .single();
  let nextNum = 1;
  if (seq) {
    nextNum = seq.last_number + 1;
    await supabaseAdmin.from('document_sequences').update({ last_number: nextNum }).eq('id', seq.id);
  } else {
    await supabaseAdmin.from('document_sequences').insert({ document_type_id: TX_TYPE, year: buddhistYear, last_number: 1 });
  }
  const docNumber = 'TX' + String(nextNum).padStart(4, '0') + '/' + buddhistYear;

  const beforeVat = Math.round(total_amount / 1.07 * 100) / 100;
  const vatAmt = Math.round((total_amount - beforeVat) * 100) / 100;

  // Insert TX document
  const { data: doc, error: docErr } = await supabaseAdmin
    .from('documents')
    .insert({
      document_number: docNumber,
      document_type_id: TX_TYPE,
      customer_id,
      status: 'draft',
      language: 'th',
      issue_date: issue_date || new Date().toISOString().split('T')[0],
      reference_po: source_doc_num,
      source_document_id: source_doc_id,
      payment_condition: '',
      subtotal: beforeVat,
      discount_design: 0,
      discount_trade: 0,
      price_before_vat: beforeVat,
      vat_amount: vatAmt,
      total_amount: total_amount,
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
    .insert({ document_id: doc.id, category_number: '1', name_th: 'ค่าบริการตามใบแจ้งหนี้ ' + source_doc_num, name_en: '', sort_order: 0 })
    .select().single();
  if (catErr) return new Response(JSON.stringify({ error: catErr.message }), { status: 500 });

  // Insert single line item
  const { error: itemErr } = await supabaseAdmin
    .from('document_items')
    .insert({
      document_id: doc.id,
      category_id: cat.id,
      item_number: '1.1',
      item_code: '',
      description_th: 'ชำระเงินตามใบแจ้งหนี้ ' + source_doc_num,
      quantity: 1,
      unit_th: 'งาน',
      unit_price: beforeVat,
      amount: beforeVat,
      material_cost: 0, material_total: 0,
      labor_cost: 0, labor_total: 0,
      is_subtotal_row: false,
      sort_order: 0,
    });
  if (itemErr) return new Response(JSON.stringify({ error: itemErr.message }), { status: 500 });

  return new Response(JSON.stringify({ id: doc.id, document_number: docNumber }), { status: 200 });
}
