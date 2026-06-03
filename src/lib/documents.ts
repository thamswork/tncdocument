import { supabaseAdmin } from './supabase';

export async function generateDocumentNumber(documentTypeId: string, prefix: string): Promise<string> {
  const buddhistYear = new Date().getFullYear() + 543;
  const { data: seq } = await supabaseAdmin
    .from('document_sequences').select('id, last_number')
    .eq('document_type_id', documentTypeId).eq('year', buddhistYear).single();
  let nextNumber = 1;
  if (seq) {
    nextNumber = seq.last_number + 1;
    await supabaseAdmin.from('document_sequences').update({ last_number: nextNumber }).eq('id', seq.id);
  } else {
    await supabaseAdmin.from('document_sequences').insert({ document_type_id: documentTypeId, year: buddhistYear, last_number: 1 });
  }
  return `${prefix}${String(nextNumber).padStart(4, '0')}/${buddhistYear}`;
}

export async function getDocumentTypes() {
  const { data } = await supabaseAdmin.from('document_types').select('*').eq('is_active', true).order('sort_order');
  return data || [];
}

export async function getCustomers(search?: string) {
  let query = supabaseAdmin.from('customers').select('*').order('customer_code');
  if (search) query = query.or(`company_name.ilike.%${search}%,customer_code.ilike.%${search}%`);
  const { data } = await query;
  return data || [];
}

export async function createCustomer(data: any) {
  const { data: customer, error } = await supabaseAdmin.from('customers').insert(data).select().single();
  return { customer, error };
}

export async function getDocuments(filters?: any) {
  let query = supabaseAdmin.from('documents').select(`
    *, document_types(code, name_th, name_en, prefix),
    customers(customer_code, company_name),
    tnc_users!documents_issued_by_fkey(full_name)
  `).order('created_at', { ascending: false });
  if (filters?.status) query = query.eq('status', filters.status);
  const { data } = await query;
  return data || [];
}

export async function getDocument(id: string) {
  const { data: doc } = await supabaseAdmin.from('documents').select(`
    *, document_types(code, name_th, name_en, prefix),
    customers(*), tnc_users!documents_issued_by_fkey(full_name, username)
  `).eq('id', id).single();
  if (!doc) return null;
  const { data: categories } = await supabaseAdmin.from('document_categories').select('*').eq('document_id', id).order('sort_order');
  const { data: items } = await supabaseAdmin.from('document_items').select('*').eq('document_id', id).order('sort_order');
  return { ...doc, categories: categories || [], items: items || [] };
}

export function calculateTotals(items: any[], discountDesign: number, discountTrade: number) {
  const subtotal = items.filter(i => !i.is_subtotal_row).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const priceBeforeVat = subtotal - discountDesign - discountTrade;
  const vatAmount = priceBeforeVat * 0.07;
  const totalAmount = priceBeforeVat + vatAmount;
  return { subtotal, price_before_vat: priceBeforeVat, vat_amount: vatAmount, total_amount: totalAmount };
}

export async function saveDocument(docData: any, categories: any[], items: any[], userId: string) {
  const isNew = !docData.id;
  const totals = calculateTotals(items, docData.discount_design || 0, docData.discount_trade || 0);
  if (isNew) {
    const { data: docType } = await supabaseAdmin.from('document_types').select('prefix').eq('id', docData.document_type_id).single();
    const docNumber = await generateDocumentNumber(docData.document_type_id, docType?.prefix || 'DOC');
    const { data: newDoc, error } = await supabaseAdmin.from('documents').insert({
      ...docData, document_number: docNumber, ...totals, created_by: userId, issued_by: userId,
    }).select().single();
    if (error || !newDoc) return { error };
    await saveDocumentDetails(newDoc.id, categories, items);
    await logAction(newDoc.id, 'draft_saved', userId);
    return { document: newDoc };
  } else {
    // Fetch existing doc to preserve status
    const { data: existingDoc } = await supabaseAdmin.from('documents').select('status').eq('id', docData.id).single();
    const { status: _, ...docDataWithoutStatus } = docData;
    const existingStatus = existingDoc?.status || 'draft';
    
    // For published docs: only update if categories were actually provided
    const hasNewBOQ = categories && categories.length > 0;
    const finalTotals = hasNewBOQ ? totals : {};
    
    const { data: updatedDoc, error } = await supabaseAdmin.from('documents')
      .update({ ...docDataWithoutStatus, ...finalTotals, status: existingStatus }).eq('id', docData.id).select().single();
    if (error || !updatedDoc) return { error };
    
    // Only replace BOQ if new categories were provided
    if (hasNewBOQ) {
      await supabaseAdmin.from('document_items').delete().eq('document_id', docData.id);
      await supabaseAdmin.from('document_categories').delete().eq('document_id', docData.id);
      await saveDocumentDetails(docData.id, categories, items);
    }
    await logAction(docData.id, 'draft_saved', userId);
    return { document: updatedDoc };
  }
}

async function saveDocumentDetails(documentId: string, categories: any[], items: any[]) {
  if (categories.length > 0) {
    const cats = categories.map((c, i) => ({ temp_id: c.temp_id, category_number: c.category_number, name_th: c.name_th, sort_order: i, document_id: documentId }));
    const { data: savedCats } = await supabaseAdmin.from('document_categories').insert(cats).select();
    if (savedCats && items.length > 0) {
      const catMap: Record<string, string> = {};
      savedCats.forEach((sc, i) => { catMap[categories[i].temp_id || String(i)] = sc.id; });
      const mappedItems = items.map((item, i) => ({
        ...item, document_id: documentId,
        category_id: item.temp_category_id ? catMap[item.temp_category_id] : null,
        amount: item.is_subtotal_row ? (Number(item.amount) || 0) : (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
        sort_order: i, temp_category_id: undefined,
      }));
      await supabaseAdmin.from('document_items').insert(mappedItems);
    }
  } else if (items.length > 0) {
    const mappedItems = items.map((item, i) => ({
      ...item, document_id: documentId,
      amount: item.is_subtotal_row ? (Number(item.amount) || 0) : (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
      sort_order: i,
    }));
    await supabaseAdmin.from('document_items').insert(mappedItems);
  }
}

export async function deleteDocument(id: string, userId: string) {
  await logAction(id, 'deleted', userId).catch(() => {});
  await supabaseAdmin.from('document_items').delete().eq('document_id', id);
  await supabaseAdmin.from('document_categories').delete().eq('document_id', id);
  await supabaseAdmin.from('export_logs').delete().eq('document_id', id);
  const { error } = await supabaseAdmin.from('documents').delete().eq('id', id);
  return { error };
}

export async function logAction(documentId: string, action: string, userId: string, notes?: string) {
  await supabaseAdmin.from('export_logs').insert({ document_id: documentId, action, performed_by: userId, notes });
}

export async function publishDocument(id: string, userId: string) {
  const { error } = await supabaseAdmin.from('documents').update({ status: 'published' }).eq('id', id);
  if (!error) await logAction(id, 'published', userId);
  return { error };
}

export async function getUsers() {
  const { data } = await supabaseAdmin.from('tnc_users')
    .select('id, username, full_name, role, is_active, created_at').order('created_at');
  return data || [];
}
