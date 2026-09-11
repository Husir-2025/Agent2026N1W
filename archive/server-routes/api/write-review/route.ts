import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import {
  compilePromptForBrief,
  runWritingLoop,
} from '@/lib/workspace-repository';

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    let body: unknown = undefined;
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = await request.json();
    }
    return Response.json(await runWritingLoop(env.DB, body), { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : '写作审阅闭环运行失败。',
      },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await ensureSchema(env.DB);
    const body = await request.json();
    return Response.json(await compilePromptForBrief(env.DB, body));
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : '提示词整合失败。',
      },
      { status: 400 },
    );
  }
}
