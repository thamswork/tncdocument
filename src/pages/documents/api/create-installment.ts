import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

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

  // Get next document number
  const { data: lastDoc } = await supabaseAdmin
    .from('documents')
    .select('document_number')
    .like('document_number', 'IV%')
    .order('created_at', { ascending: false })
    .limit(1);

  const year = new Date().getFullYear() + 543;
  let nextNum = 1;
  if (lastDoc && lastDoc.length > 0) {
    const m = lastDoc[0].document_number.match(/IV(\d+)\//);
    if (m) nextNum = parseInt(m[1]) + 1;
  }
  const docNumber = 'IV' + String(nextNum).padStart(4, '0') + '/' + year;

  const beforeVat = Math.round(amount / 1.07 * 100) / 100;
  const vatAmt = Math.round((amount - beforeVat) * 100) / 100;

  // Insert document
  const { data: doc, error: docErr } = await supabaseAdmin
    .from('documents')
    .insert({
      document_number: docNumber,
      document_type_id: dtData.id,
      customer_id,
      status: 'draft',
      language: 'th',
      issue_date: issue_date || new Date().toISOString().split('T')[0],
      due_date: due_date || null,
      reference_po: source_doc_num,
      payment_condition: label,
      subtotal: beforeVat,
      discount_design: 0,
      discount_trade: 0,
      price_before_vat: beforeVat,
      vat_amount: vatAmt,
      total_amount: amount,
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
