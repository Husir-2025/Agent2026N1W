import { strFromU8, unzipSync } from 'fflate';

export type ParsedBook = {
  mediaType: string;
  text: string;
  title?: string;
};

const supportedExtensions = ['txt', 'md', 'epub', 'docx'];

function extensionOf(filename: string) {
  return filename.toLowerCase().split('.').pop() ?? '';
}

function decodePlainText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const probeLength = Math.min(bytes.length, 2000);
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < probeLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }
  if (oddNulls > probeLength * 0.15) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (evenNulls > probeLength * 0.15) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

function normalizeBookText(value: string) {
  return value
    .replace(/^\uFEFF/u, '')
    .replace(/[\u0000\u000B\u000C\u200B\u2060]/gu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function attributesOf(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes.set(match[1].toLowerCase(), match[2]);
  }
  return attributes;
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => entities[name.toLowerCase()] ?? match,
    );
}

function markupToText(markup: string) {
  return decodeEntities(
    markup
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeArchivePath(base: string, relative: string) {
  const stack = base.split('/').filter(Boolean);
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function parseDocx(bytes: Uint8Array): ParsedBook {
  const archive = unzipSync(bytes);
  const document = archive['word/document.xml'];
  if (!document) throw new Error('DOCX 中缺少 word/document.xml。');
  const xml = strFromU8(document);
  const text = markupToText(
    xml.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<\/w:p>/g, '\n'),
  );
  return {
    mediaType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    text,
  };
}

function parseEpub(bytes: Uint8Array): ParsedBook {
  const archive = unzipSync(bytes);
  const container = archive['META-INF/container.xml'];
  if (!container) throw new Error('EPUB 中缺少容器描述文件。');
  const containerXml = strFromU8(container);
  const rootfile = containerXml.match(/full-path=["']([^"']+)["']/i)?.[1];
  if (!rootfile || !archive[rootfile])
    throw new Error('EPUB 未声明有效的 OPF 文件。');

  const opf = strFromU8(archive[rootfile]);
  const base = rootfile.includes('/')
    ? rootfile.slice(0, rootfile.lastIndexOf('/'))
    : '';
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const attributes = attributesOf(match[0]);
    const id = attributes.get('id');
    const href = attributes.get('href');
    if (id && href) manifest.set(id, href);
  }
  const spineIds = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map((match) => attributesOf(match[0]).get('idref'))
    .filter((id): id is string => Boolean(id));
  const pages: string[] = [];
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;
    const file =
      archive[
        normalizeArchivePath(base, decodeURIComponent(href.split('#')[0]))
      ];
    if (!file) continue;
    const page = markupToText(strFromU8(file));
    if (page) pages.push(page);
  }
  if (!pages.length) throw new Error('EPUB 书脊中没有可读取的正文。');
  const title = decodeEntities(
    opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? '',
  ).trim();
  return {
    mediaType: 'application/epub+zip',
    text: pages.join('\n\n'),
    title: title || undefined,
  };
}

export function parseBookFile(filename: string, bytes: Uint8Array): ParsedBook {
  const extension = extensionOf(filename);
  if (!supportedExtensions.includes(extension)) {
    throw new Error(
      `暂不支持 .${extension || '未知'} 文件。请使用 TXT、MD、EPUB 或 DOCX。`,
    );
  }
  if (extension === 'docx') return parseDocx(bytes);
  if (extension === 'epub') return parseEpub(bytes);
  const parsed = {
    mediaType: extension === 'md' ? 'text/markdown' : 'text/plain',
    text: normalizeBookText(decodePlainText(bytes)),
  };
  return parsed;
}
