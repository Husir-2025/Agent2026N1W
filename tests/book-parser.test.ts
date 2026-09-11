import assert from 'node:assert/strict';
import test from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { parseBookFile } from '../lib/book-parser.ts';

void test('parses UTF-8 plain text', () => {
  const parsed = parseBookFile(
    'sample.txt',
    new TextEncoder().encode('第一章\n\n这是一段足够清楚的文本。'),
  );
  assert.equal(parsed.mediaType, 'text/plain');
  assert.match(parsed.text, /第一章/);
});

void test('parses UTF-16LE text and removes invisible control characters', () => {
  const source = '\uFEFF第一章\r\n\u200B这是 UTF-16 小说正文。';
  const bytes = new Uint8Array(source.length * 2);
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  const parsed = parseBookFile('utf16.txt', bytes);
  assert.equal(parsed.text, '第一章\n这是 UTF-16 小说正文。');
});

void test('extracts paragraphs from a DOCX archive', () => {
  const xml =
    '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>第一章</w:t></w:r></w:p><w:p><w:r><w:t>雨夜。</w:t></w:r></w:p></w:body></w:document>';
  const bytes = zipSync({ 'word/document.xml': strToU8(xml) });
  const parsed = parseBookFile('sample.docx', bytes);
  assert.match(parsed.text, /第一章\n雨夜/);
});

void test('follows EPUB spine order', () => {
  const bytes = zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="OPS/book.opf" /></rootfiles></container>',
    ),
    'OPS/book.opf': strToU8(
      '<package xmlns:dc="dc"><metadata><dc:title>测试书</dc:title></metadata><manifest><item id="c1" href="one.xhtml"/><item id="c2" href="two.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    ),
    'OPS/one.xhtml': strToU8(
      '<html><head><title>不应进入正文</title></head><body><h1>第一章</h1><p>第一段。</p></body></html>',
    ),
    'OPS/two.xhtml': strToU8(
      '<html><body><h1>第二章</h1><p>第二段。</p></body></html>',
    ),
  });
  const parsed = parseBookFile('sample.epub', bytes);
  assert.equal(parsed.title, '测试书');
  assert.ok(parsed.text.indexOf('第一章') < parsed.text.indexOf('第二章'));
  assert.doesNotMatch(parsed.text, /不应进入正文/);
});

void test('parses EPUB manifest attributes in any order', () => {
  const bytes = zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="OPS/book.opf" /></rootfiles></container>',
    ),
    'OPS/book.opf': strToU8(
      '<package><manifest><item href="chapter.xhtml" media-type="application/xhtml+xml" id="chapter"/></manifest><spine><itemref linear="yes" idref="chapter"/></spine></package>',
    ),
    'OPS/chapter.xhtml': strToU8(
      '<html><body><h1>第一章</h1><p>正文。</p></body></html>',
    ),
  });
  assert.match(parseBookFile('order.epub', bytes).text, /第一章\n正文/);
});

void test('rejects unsupported formats explicitly', () => {
  assert.throws(
    () => parseBookFile('sample.pdf', new Uint8Array()),
    /暂不支持/,
  );
});
