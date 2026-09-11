import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const guidePath = path.join(root, '写文助手项目构建与代码索引.txt');
const archiveMarker = '完整源码归档（机器可还原）';

const topLevelFiles = [
  '.gitignore',
  '.oxfmtrc.json',
  '.oxlintrc.json',
  'components.json',
  'drizzle.config.ts',
  'env.d.ts',
  'next.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vite.config.ts',
  '从源码归档还原.ps1',
];

const sourceDirectories = [
  '.openai',
  'app',
  'components',
  'db',
  'drizzle',
  'hooks',
  'lib',
  'public',
  'tests',
  'tools',
];

async function collectFiles(directory, output) {
  const absolute = path.join(root, directory);
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(directory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) {
      await collectFiles(relative, output);
    } else if (entry.isFile() && !relative.endsWith('完整源码归档.txt')) {
      output.push(relative);
    }
  }
}

const sourceFiles = [...topLevelFiles];
for (const directory of sourceDirectories) {
  await collectFiles(directory, sourceFiles);
}
sourceFiles.sort((left, right) => left.localeCompare(right, 'en'));

const records = [];
for (const relativePath of sourceFiles) {
  const content = (await readFile(path.join(root, relativePath), 'utf8')).replaceAll(
    '\r\n',
    '\n',
  );
  const bytes = Buffer.from(content, 'utf8');
  records.push({
    path: relativePath,
    content,
    finalNewline: content.endsWith('\n'),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

const existingGuide = (await readFile(guidePath, 'utf8')).replaceAll('\r\n', '\n');
const markerIndex = existingGuide.indexOf(`\n${archiveMarker}\n`);
const guide = (markerIndex >= 0 ? existingGuide.slice(0, markerIndex) : existingGuide)
  .trimEnd();

const manifest = records
  .map(
    (record, index) =>
      `${String(index + 1).padStart(3, '0')} | ${record.path} | ${record.size} bytes | ${record.sha256}`,
  )
  .join('\n');

const files = records
  .map(
    (record) => `===== FILE BEGIN =====
PATH: ${record.path}
SIZE: ${record.size}
SHA256: ${record.sha256}
FINAL_NEWLINE: ${record.finalNewline ? 'yes' : 'no'}
----- CONTENT BEGIN -----
${record.content}${record.content.endsWith('\n') ? '' : '\n'}----- CONTENT END -----
===== FILE END =====`,
  )
  .join('\n\n');

const archive = `${guide}

${archiveMarker}
==============================

这一节不是代码索引，而是当前项目的逐文件真实源码。共 ${records.length} 个文本源码/配置文件。
使用同目录的“从源码归档还原.ps1”可将下面的文件块恢复到新目录；恢复后运行 pnpm install --frozen-lockfile、pnpm test 和 pnpm build。

归档范围：应用源码、全部 UI 组件、领域逻辑、数据库 schema 和迁移、API、测试、样式、构建配置、托管绑定、package.json 和 pnpm-lock.yaml。
未归档范围：node_modules、构建产物、Miniflare 本地数据库、缓存、tsbuildinfo 以及 EPUB 等二进制样书。这些不是构建源码。新项目首次访问 API 时会自动创建空数据库，可通过演示闭环或上传授权书籍重新建立业务数据。

文件清单与校验值
----------------
${manifest}

源码文件块
----------
${files}

===== SOURCE ARCHIVE END =====
`;

await writeFile(guidePath, archive, 'utf8');
console.log(
  `Exported ${records.length} files (${Buffer.byteLength(archive, 'utf8')} bytes) to ${path.basename(guidePath)}`,
);
