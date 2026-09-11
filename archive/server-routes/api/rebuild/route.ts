import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { rebuildProjectChapters } from '@/lib/workspace-repository';

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    const body = request.headers
      .get('content-type')
      ?.includes('application/json')
      ? await request.json()
      : undefined;
    return Response.json(await rebuildProjectChapters(env.DB, body));
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : '前五章重建失败。',
      },
      { status: 400 },
    );
  }
}
