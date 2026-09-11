import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { demoBookText } from '@/lib/demo-text';
import {
  runAnalysis,
  runWritingLoop,
  saveBook,
  setMemoryStatus,
  workspaceSnapshot,
} from '@/lib/workspace-repository';

export async function POST() {
  try {
    await ensureSchema(env.DB);
    const bytes = new TextEncoder().encode(demoBookText);
    const saved = await saveBook(env.DB, env.FILES, {
      title: '断电之后 拆解测试样本',
      author: '原创测试夹具',
      filename: '断电之后-原创测试样本.txt',
      mediaType: 'text/plain',
      bytes,
      text: demoBookText,
      rightsBasis: 'original',
      rightsNote: '为本项目编写的原创测试文本，可重复运行。',
    });
    const bookId = String((saved.book as Record<string, unknown>).id);
    let candidate = await env.DB.prepare(`SELECT id FROM memory_items
      WHERE analysis_run_id IN (SELECT id FROM analysis_runs WHERE book_id = ?)
      ORDER BY created_at DESC LIMIT 1`)
      .bind(bookId)
      .first<{ id: string }>();
    let analysis: Awaited<ReturnType<typeof runAnalysis>> | undefined;
    if (!candidate) {
      analysis = await runAnalysis(
        env.DB,
        env.FILES,
        bookId,
        '章尾钩子与逻辑衔接',
      );
      candidate = analysis.memories[0] ? { id: analysis.memories[0].id } : null;
    }
    if (candidate)
      await setMemoryStatus(
        env.DB,
        candidate.id,
        'confirmed',
        '原创测试闭环自动确认',
      );
    const loop = await runWritingLoop(env.DB, undefined, { demo: true });
    return Response.json(
      { saved, analysis, loop, snapshot: await workspaceSnapshot(env.DB) },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '演示闭环运行失败。' },
      { status: 400 },
    );
  }
}
