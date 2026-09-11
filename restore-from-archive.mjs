#!/usr/bin/env node
// 从写文助手源码归档 TXT 还原全部文件（按行精确匹配边界标记），并逐文件校验 SIZE 与 SHA-256。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ARCHIVE = process.argv[2];
const OUT_DIR = process.argv[3] ?? '.';
if (!ARCHIVE) {
  console.error('用法: node restore-from-archive.mjs <归档.txt> [输出目录]');
  process.exit(1);
}

const lines = readFileSync(ARCHIVE, 'utf8').split('\n');
const BEGIN = '===== FILE BEGIN =====';
const END = '===== FILE END =====';
const CBEGIN = '----- CONTENT BEGIN -----';
const CEND = '----- CONTENT END -----';

const blocks = [];
let i = 0;
while (i < lines.length) {
  if (lines[i] === BEGIN) {
    const start = i + 1;
    let end = start;
    while (end < lines.length && lines[end] !== END) end++;
    if (end >= lines.length) {
      console.error('✗ 找不到 FILE END:', lines.slice(start, start + 5));
      process.exit(1);
    }
    blocks.push({ start, end });
    i = end + 1;
  } else {
    i++;
  }
}

let ok = 0, fail = 0;
for (const { start, end } of blocks) {
  const blockLines = lines.slice(start, end);
  let meta = {};
  let cIdx = -1;
  for (let k = 0; k < blockLines.length; k++) {
    const line = blockLines[k];
    if (line === CBEGIN) { cIdx = k; break; }
    if (line.startsWith('PATH: ')) meta.path = line.slice(6);
    else if (line.startsWith('SIZE: ')) meta.size = parseInt(line.slice(6), 10);
    else if (line.startsWith('SHA256: ')) meta.sha256 = line.slice(8);
    else if (line.startsWith('FINAL_NEWLINE: ')) meta.finalNewline = line.slice(15) === 'yes';
  }
  if (!meta.path || !meta.size || !meta.sha256 || cIdx < 0) {
    console.error('✗ 元数据缺失:', blockLines.slice(0, 6));
    fail++;
    continue;
  }
  // 内容行 = BEGIN 之后到 END 之前；去掉 BEGIN/END 标记行
  let contentLines = blockLines.slice(cIdx + 1);
  // 去掉末尾的 CEND 标记行
  while (contentLines.length && contentLines[contentLines.length - 1] === CEND) {
    contentLines.pop();
  }
  let content = contentLines.join('\n');
  if (content.startsWith('\n')) content = content.slice(1);
  if (content.endsWith('\n')) content = content.slice(0, -1);
  if (meta.finalNewline !== false) content += '\n';

  const target = join(OUT_DIR, meta.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');

  const actualSize = statSync(target).size;
  const actualSha = createHash('sha256').update(readFileSync(target)).digest('hex');
  if (actualSize === meta.size && actualSha === meta.sha256) {
    ok++;
  } else {
    fail++;
    console.error(`✗ 校验失败 ${meta.path}: size ${actualSize}≠${meta.size} | sha 不符`);
  }
}

console.log(`\n还原完成: 成功 ${ok} 个, 失败 ${fail} 个 (共 ${blocks.length} 个块)`);
process.exit(fail === 0 ? 0 : 1);
