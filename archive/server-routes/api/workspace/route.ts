import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { workspaceSnapshot } from '@/lib/workspace-repository';

export async function GET() {
  await ensureSchema(env.DB);
  return Response.json(await workspaceSnapshot(env.DB));
}
