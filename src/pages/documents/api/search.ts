import { searchDocuments } from '../../../lib/documents';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function GET({ url, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const q = url.searchParams.get('q') || '';
  const results = await searchDocuments(q);
  return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
