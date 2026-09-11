import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { saveWritingBrief } from '@/lib/workspace-repository';

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    return Response.json(await saveWritingBrief(env.DB, await request.json()));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '简报保存失败。' },
      { status: 400 },
    );
  }
}
