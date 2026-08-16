import { flagStaleDocuments } from '../../../../lib/documents';

const CRON_SECRET = 'tnc-cron-8f3a1c9e2b7d4f6a0193';

export async function POST({ request }: any) {
  const secret = request.headers.get('x-cron-secret');
  if (secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const result = await flagStaleDocuments();
  return new Response(JSON.stringify(result), { status: 200 });
}
