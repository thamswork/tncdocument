import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function POST({ request, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { doc_id, issue_date } = await request.json();
  if (!doc_id || !issue_date) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  console.log('[update-date] doc_id:', doc_id, 'new issue_date:', issue_date);

  const { data: before } = await supabaseAdmin.from('documents').select('issue_date').eq('id', doc_id).single();
  console.log('[update-date] value before update:', before?.issue_date);

  const { error } = await supabaseAdmin
    .from('documents')
    .update({ issue_date, updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
    .eq('id', doc_id);

  if (error) { console.log('[update-date] UPDATE FAILED:', error.message); return new Response(JSON.stringify({ error: error.message }), { status: 500 }); }

  const { data: after } = await supabaseAdmin.from('documents').select('issue_date').eq('id', doc_id).single();
  console.log('[update-date] value after update:', after?.issue_date);

  return new Response(JSON.stringify({ ok: true, issue_date: after?.issue_date }), { status: 200 });
}
