import { supabaseAdmin } from '../../../lib/supabase';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function POST({ request, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const { name, description } = await request.json();
  if (!name) return new Response(JSON.stringify({ error: 'Missing name' }), { status: 400 });
  const { data, error } = await supabaseAdmin
    .from('jobs').insert({ name, description: description||null, created_by: user.id })
    .select().single();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify(data), { status: 200 });
}
