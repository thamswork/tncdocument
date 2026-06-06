import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function POST({ request, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const body = await request.json();
  const { doc_id, payment_condition } = body;
  if (!doc_id) return new Response(JSON.stringify({ error: 'Missing doc_id' }), { status: 400 });
  const { error } = await supabaseAdmin
    .from('documents')
    .update({ payment_condition, updated_at: new Date().toISOString() })
    .eq('id', doc_id);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
