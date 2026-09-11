import { env } from 'cloudflare:workers';

import { ensureSchema } from '@/db/ensure';
import { parseBookFile } from '@/lib/book-parser';
import { saveBook } from '@/lib/workspace-repository';

const allowedRights = new Set([
  'owned',
  'licensed',
  'public-domain',
  'author-authorized',
  'original',
]);
const allowedExtensions = new Set(['txt', 'md', 'epub', 'docx']);

function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request) {
  try {
    await ensureSchema(env.DB);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return Response.json({ error: '请选择一本书籍文件。' }, { status: 400 });
    const extension = file.name.toLowerCase().split('.').pop() ?? '';
    if (!allowedExtensions.has(extension))
      return Response.json(
        { error: '暂不支持该文件。请上传 TXT、MD、EPUB 或 DOCX。' },
        { status: 415 },
      );
    if (file.size > 20 * 1024 * 1024)
      return Response.json(
        { error: '第一阶段单个文件不能超过 20 MB。' },
        { status: 413 },
      );
    const rightsBasis = formText(form, 'rightsBasis') || 'owned';
    if (!allowedRights.has(rightsBasis))
      return Response.json(
        { error: '请选择有效的使用依据。' },
        { status: 400 },
      );

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseBookFile(file.name, bytes);
    if (parsed.text.length < 200)
      return Response.json(
        { error: '可读取正文少于 200 字，无法建立拆解任务。' },
        { status: 400 },
      );
    const title =
      formText(form, 'title') ||
      parsed.title ||
      file.name.replace(/\.[^.]+$/, '');
    if (title.length > 120)
      return Response.json(
        { error: '书名不能超过 120 个字符。' },
        { status: 400 },
      );
    const sourceUrl = formText(form, 'sourceUrl');
    if (sourceUrl) {
      try {
        const parsedUrl = new URL(sourceUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol))
          throw new Error('invalid protocol');
      } catch {
        return Response.json(
          { error: '来源地址必须是有效的 http 或 https 链接。' },
          { status: 400 },
        );
      }
    }
    const result = await saveBook(env.DB, env.FILES, {
      title,
      author: formText(form, 'author') || undefined,
      filename: file.name,
      mediaType: parsed.mediaType,
      bytes,
      text: parsed.text,
      sourceUrl: sourceUrl || undefined,
      rightsBasis,
      rightsNote: formText(form, 'rightsNote') || undefined,
    });
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '导入失败。' },
      { status: 400 },
    );
  }
}
