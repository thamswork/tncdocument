import { getDocuments } from '../../../lib/documents';
import { getSessionUser, SESSION_COOKIE } from '../../../lib/auth';

export async function GET({ url, cookies }: any) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(token);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const { data, count } = await getDocuments({ limit, offset });
  return new Response(JSON.stringify({ data, count }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
