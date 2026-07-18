import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function POST({ request, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { doc_id, issue_date } = await request.json();
  if (!doc_id || !issue_date) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

  const { error } = await supabaseAdmin
    .from('documents')
    .update({ issue_date, updated_at: new Date().toISOString() })
    .eq('id', doc_id);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
