import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { runAnalysis } from '@/lib/workspace-repository';

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    const body = (await request.json()) as { bookId?: string; goal?: string };
    const goal = body.goal?.trim();
    if (!body.bookId || !goal)
      return Response.json(
        { error: '书籍和拆解目标不能为空。' },
        { status: 400 },
      );
    return Response.json(
      await runAnalysis(env.DB, env.FILES, body.bookId, goal),
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '拆解失败。' },
      { status: 400 },
    );
  }
}
