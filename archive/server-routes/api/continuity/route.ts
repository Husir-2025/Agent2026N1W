import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import {
  saveContinuityItem,
  saveContinuityNote,
  updateContinuityItem,
} from '@/lib/workspace-repository';

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    const body = (await request.json()) as Record<string, unknown>;
    return Response.json(
      await (typeof body.note === 'string'
        ? saveContinuityNote(env.DB, body)
        : saveContinuityItem(env.DB, body)),
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : '故事逻辑机制保存失败。',
      },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await ensureSchema(env.DB);
    return Response.json(
      await updateContinuityItem(env.DB, await request.json()),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : '连续性条目更新失败。',
      },
      { status: 400 },
    );
  }
}
