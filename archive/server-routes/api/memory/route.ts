import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { setMemoryStatus } from '@/lib/workspace-repository';

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    const body = (await request.json()) as {
      memoryItemId?: string;
      status?: string;
      note?: string;
    };
    if (
      !body.memoryItemId ||
      !['confirmed', 'rejected'].includes(body.status ?? '')
    ) {
      return Response.json({ error: '记忆编号或状态无效。' }, { status: 400 });
    }
    return Response.json(
      await setMemoryStatus(
        env.DB,
        body.memoryItemId,
        body.status as 'confirmed' | 'rejected',
        body.note,
      ),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '记忆更新失败。' },
      { status: 400 },
    );
  }
}
