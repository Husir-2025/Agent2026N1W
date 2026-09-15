// 浏览器端运行时（GitHub Pages 静态部署适配层）
// ---------------------------------------------------------------
// 原始工程部署在 Cloudflare Workers，通过 env.DB(D1) 与 env.FILES(R2)
// 提供数据存储。GitHub Pages 只能托管静态文件，没有服务端绑定。
// 本文件在不改动任何领域逻辑（lib/pipeline.ts、lib/workspace-repository.ts）
// 的前提下，提供：
//   1. 基于 sql.js(WASM SQLite) 的 D1Database 兼容垫片；
//   2. 基于 IndexedDB 的 R2Bucket 兼容垫片；
//   3. 与 app/api/* 路由逐一对应的前端 API 函数（含相同的校验逻辑）。
// 数据只保存在当前浏览器的 IndexedDB 中，属于单机个人工作台。

import initSqlJs, {
  type Database as SqlJsDatabase,
  type SqlJsStatic,
  type Statement as SqlJsStatement,
} from 'sql.js';
import type { R2Bucket } from '@cloudflare/workers-types';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import { ensureSchema } from '@/db/ensure';
import { parseBookFile } from '@/lib/book-parser';
import { demoBookText } from '@/lib/demo-text';
import {
  compilePromptForBrief,
  getUserPreferences,
  listIdeas,
  rebuildProjectChapters,
  runAnalysis,
  runWritingLoop,
  saveBook,
  saveContinuityItem,
  saveContinuityNote,
  saveIdea,
  saveUserPreference,
  saveVolumePlan,
  saveWritingBrief,
  setMemoryStatus,
  updateContinuityItem,
  updateIdeaStatus,
  workspaceSnapshot,
  type IdeaInput,
} from '@/lib/workspace-repository';
import { normalizeWritingBrief, polishDraft, reviewDraft } from '@/lib/pipeline';
import { defaultWritingBrief } from '@/lib/pipeline';
import {
  planVolumes,
  summarizeChapter,
  WRITING_GUIDES,
} from '@/lib/writer-v2';

const DB_STORE = 'agent2026n1w';
const DB_KEY = 'sqlite-db';
const FILES_STORE = 'agent2026n1w-files';

let sqlPromise: Promise<SqlJsStatic> | null = null;
let runtimePromise: Promise<Runtime> | null = null;

// ---------------------------------------------------------------- IndexedDB

function openIdb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败。'));
  });
}

async function idbGet<T>(dbName: string, key: string): Promise<T | undefined> {
  const idb = await openIdb(dbName);
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败。'));
  });
}

async function idbPut(dbName: string, key: string, value: unknown): Promise<void> {
  const idb = await openIdb(dbName);
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败。'));
  });
}

// ---------------------------------------------------------------- sql.js

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlPromise;
}

// ---------------------------------------------------------------- D1 垫片

// 注意：sql.js 的 prepare() 会立即编译并校验表存在性（例如
// CREATE INDEX ... ON books 在 books 尚未创建时会直接报 no such table）。
// 真实 D1 的 prepare 是惰性的。因此这里把编译推迟到真正执行（step）时，
// 保证 ensureSchema 这类“先建表后建索引”的批处理按语句顺序正确执行。
class BrowserStatement {
  private owner: BrowserD1;
  private sql: string;
  private params: unknown[] = [];
  private compiled: SqlJsStatement | null = null;

  constructor(owner: BrowserD1, sql: string) {
    this.owner = owner;
    this.sql = sql;
  }

  bind(...values: unknown[]) {
    const args =
      values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
    this.params = args.map((value) => (value === undefined ? null : value));
    return this;
  }

  private compile(): SqlJsStatement {
    if (!this.compiled) {
      this.compiled = this.owner.compile(this.sql);
      if (this.params.length > 0) this.compiled.bind(this.params);
    }
    return this.compiled;
  }

  private finish(): void {
    if (this.compiled) {
      this.compiled.free();
      this.compiled = null;
    }
  }

  async run() {
    const stmt = this.compile();
    stmt.step();
    const changes = this.owner.rowsModified();
    this.finish();
    return { success: true, meta: { changes, last_row_id: 0, duration: 0 } };
  }

  async all<T = Record<string, unknown>>() {
    const results: T[] = [];
    const stmt = this.compile();
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    this.finish();
    return {
      success: true,
      results,
      meta: { changes: 0, last_row_id: 0, duration: 0 },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const stmt = this.compile();
    const row = stmt.step() ? (stmt.getAsObject() as T) : null;
    this.finish();
    return row;
  }
}

class BrowserD1 {
  private db: SqlJsDatabase;

  constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  rowsModified(): number {
    return this.db.getRowsModified();
  }

  snapshot(): Uint8Array {
    return this.db.export();
  }

  compile(sql: string): SqlJsStatement {
    return this.db.prepare(sql);
  }

  prepare(sql: string) {
    return new BrowserStatement(this, sql);
  }

  async batch(statements: BrowserStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async exec(sql: string) {
    this.db.exec(sql);
  }
}

// ---------------------------------------------------------------- R2 垫片

type StoredFile = string | Uint8Array;

async function filesPut(key: string, data: StoredFile): Promise<void> {
  await idbPut(FILES_STORE, key, data);
}

async function filesGet(key: string) {
  const data = await idbGet<StoredFile>(FILES_STORE, key);
  if (data === undefined) return null;
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return {
    bytes,
    async text() {
      return typeof data === 'string' ? data : new TextDecoder().decode(data);
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    async json<T>(): Promise<T> {
      return JSON.parse(await this.text()) as T;
    },
  };
}

// ---------------------------------------------------------------- 运行时

type Runtime = {
  db: D1Database;
  files: R2Bucket;
};

// 是否请求重置本地数据：?reset=1 清空 IndexedDB 后重建空库。
function wantsReset(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('reset') === '1';
  } catch {
    return false;
  }
}

async function clearStores(): Promise<void> {
  const dbName = DB_STORE;
  const idb = await openIdb(dbName);
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('kv', 'readwrite');
    tx.objectStore('kv').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('重置数据失败。'));
  });
  const filesIdb = await openIdb(FILES_STORE);
  await new Promise<void>((resolve, reject) => {
    const tx = filesIdb.transaction('kv', 'readwrite');
    tx.objectStore('kv').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('重置文件失败。'));
  });
}

export async function apiResetLocalData(): Promise<void> {
  runtimePromise = null;
  sqlPromise = null;
  await clearStores();
  runtimePromise = ensureRuntime();
  await runtimePromise;
}

async function ensureRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      try {
        if (wantsReset()) await clearStores();
        const SQL = await loadSqlJs();
        const stored = await idbGet<Uint8Array>(DB_STORE, DB_KEY);
        const sqlite: SqlJsDatabase = stored
          ? new SQL.Database(stored)
          : new SQL.Database();
        sqlite.run('PRAGMA foreign_keys = ON');
        const d1 = new BrowserD1(sqlite);
        // 每次初始化都幂等执行建表（CREATE TABLE/INDEX IF NOT EXISTS），
        // 可自愈此前写入异常导致的空库或残缺库，保证 books 等表始终存在。
        await ensureSchema(d1 as unknown as D1Database);
        await idbPut(DB_STORE, DB_KEY, d1.snapshot());
        return {
          db: d1 as unknown as D1Database,
          files: {
            put: filesPut,
            get: filesGet,
          } as unknown as R2Bucket,
        };
      } catch (error) {
        throw new Error(
          `工作区初始化失败: ${error instanceof Error ? error.message : String(error)}（可尝试在网址后加 ?reset=1 重置本地数据）`,
        );
      }
    })();
  }
  return runtimePromise;
}

async function persistDb(): Promise<void> {
  const { db } = await ensureRuntime();
  const d1 = db as unknown as BrowserD1;
  await idbPut(DB_STORE, DB_KEY, d1.snapshot());
}

// ---------------------------------------------------------------- API 包装

const allowedRights = new Set([
  'owned',
  'licensed',
  'public-domain',
  'author-authorized',
  'original',
]);
const allowedExtensions = new Set(['txt', 'md', 'epub', 'docx']);

export type Snapshot = {
  books: Array<Record<string, unknown>>;
  analyses: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  memories: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  chapters: Array<Record<string, unknown>>;
  findings: Array<Record<string, unknown>>;
  continuityItems: Array<Record<string, unknown>>;
  continuityEvents: Array<Record<string, unknown>>;
};

export async function apiGetWorkspace(): Promise<Snapshot> {
  const { db } = await ensureRuntime();
  try {
    return (await workspaceSnapshot(db)) as unknown as Snapshot;
  } catch (error) {
    let tableNames: string[] = [];
    try {
      const rows = await db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all<{ name: string }>();
      tableNames = (rows.results ?? []).map((row) => row.name);
    } catch {
      tableNames = ['<查询表失败>'];
    }
    throw new Error(
      `工作区初始化异常: ${error instanceof Error ? error.message : String(error)} | 现有表: ${JSON.stringify(tableNames)}`,
    );
  }
}

export type ImportBookFields = {
  title?: string;
  author?: string;
  sourceUrl?: string;
  rightsBasis?: string;
  rightsNote?: string;
};

export async function apiImportBook(
  file: File,
  fields: ImportBookFields,
): Promise<{ duplicate?: boolean; book: Record<string, unknown> }> {
  const { db, files } = await ensureRuntime();
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (!allowedExtensions.has(extension)) {
    throw new Error('暂不支持该文件。请上传 TXT、MD、EPUB 或 DOCX。');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('第一阶段单个文件不能超过 20 MB。');
  }
  const rightsBasis = fields.rightsBasis?.trim() || 'owned';
  if (!allowedRights.has(rightsBasis)) {
    throw new Error('请选择有效的使用依据。');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseBookFile(file.name, bytes);
  if (parsed.text.length < 200) {
    throw new Error('可读取正文少于 200 字，无法建立拆解任务。');
  }
  const title = fields.title?.trim() || parsed.title || file.name.replace(/\.[^.]+$/, '');
  if (title.length > 120) {
    throw new Error('书名不能超过 120 个字符。');
  }
  const sourceUrl = fields.sourceUrl?.trim();
  if (sourceUrl) {
    try {
      const parsedUrl = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('invalid protocol');
      }
    } catch {
      throw new Error('来源地址必须是有效的 http 或 https 链接。');
    }
  }
  const result = await saveBook(db, files, {
    title,
    author: fields.author?.trim() || undefined,
    filename: file.name,
    mediaType: parsed.mediaType,
    bytes,
    text: parsed.text,
    sourceUrl: sourceUrl || undefined,
    rightsBasis,
    rightsNote: fields.rightsNote?.trim() || undefined,
  });
  await persistDb();
  return result as { duplicate?: boolean; book: Record<string, unknown> };
}

export async function apiAnalyze(
  bookId: string,
  goal: string,
): Promise<Record<string, unknown>> {
  const { db, files } = await ensureRuntime();
  const trimmed = goal.trim();
  if (!bookId || !trimmed) {
    throw new Error('书籍和拆解目标不能为空。');
  }
  const result = await runAnalysis(db, files, bookId, trimmed);
  await persistDb();
  return result as unknown as Record<string, unknown>;
}

export async function apiDemo(): Promise<void> {
  const { db, files } = await ensureRuntime();
  const bytes = new TextEncoder().encode(demoBookText);
  const saved = await saveBook(db, files, {
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
  let candidate = await db
    .prepare(
      `SELECT id FROM memory_items
      WHERE analysis_run_id IN (SELECT id FROM analysis_runs WHERE book_id = ?)
      ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(bookId)
    .first<{ id: string }>();
  if (!candidate) {
    const analysis = await runAnalysis(db, files, bookId, '章尾钩子与逻辑衔接');
    candidate = analysis.memories[0] ? { id: analysis.memories[0].id } : null;
  }
  if (candidate) {
    await setMemoryStatus(db, candidate.id, 'confirmed', '原创测试闭环自动确认');
  }
  await runWritingLoop(db, undefined, { demo: true });
  await persistDb();
}

export async function apiSetMemory(
  memoryItemId: string,
  status: 'confirmed' | 'rejected',
  note?: string,
): Promise<void> {
  const { db } = await ensureRuntime();
  if (!memoryItemId || !['confirmed', 'rejected'].includes(status ?? '')) {
    throw new Error('记忆编号或状态无效。');
  }
  await setMemoryStatus(db, memoryItemId, status, note);
  await persistDb();
}

export async function apiSaveContinuity(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { db } = await ensureRuntime();
  const result =
    typeof input.note === 'string'
      ? await saveContinuityNote(db, input)
      : await saveContinuityItem(db, input);
  await persistDb();
  return result as Record<string, unknown>;
}

export async function apiUpdateContinuity(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { db } = await ensureRuntime();
  const result = await updateContinuityItem(db, input);
  await persistDb();
  return result as Record<string, unknown>;
}

export async function apiWriteReview(
  brief: unknown,
): Promise<{ projectId?: string; [key: string]: unknown }> {
  const { db } = await ensureRuntime();
  const result = await runWritingLoop(db, brief);
  await persistDb();
  return result as { projectId?: string; [key: string]: unknown };
}

export async function apiCompilePrompt(
  brief: unknown,
): Promise<{ prompt?: { assembled?: string }; [key: string]: unknown }> {
  const { db } = await ensureRuntime();
  return (await compilePromptForBrief(db, brief)) as {
    prompt?: { assembled?: string };
    [key: string]: unknown;
  };
}

export async function apiRebuild(
  input: Record<string, unknown>,
): Promise<{ chapters?: Array<{ sequence: number; characterCount: number }> }> {
  const { db } = await ensureRuntime();
  const result = await rebuildProjectChapters(db, input);
  await persistDb();
  return result as {
    chapters?: Array<{ sequence: number; characterCount: number }>;
  };
}

export async function apiSaveBrief(
  brief: unknown,
): Promise<{ projectId?: string; [key: string]: unknown }> {
  const { db } = await ensureRuntime();
  const result = await saveWritingBrief(db, brief);
  await persistDb();
  return result as { projectId?: string; [key: string]: unknown };
}

// ----------------------------------------------------------------
// 头号写手 v2 API：灵感库 / 偏好记忆 / 卷规划 / 多轮编辑 / 指南库
// ----------------------------------------------------------------

export async function apiSaveIdea(input: IdeaInput): Promise<{ id: string }> {
  const { db } = await ensureRuntime();
  if (!input.title?.trim() || !input.content?.trim()) {
    throw new Error('灵感标题和内容不能为空。');
  }
  const result = await saveIdea(db, input);
  await persistDb();
  return result;
}

export async function apiUpdateIdeaStatus(
  id: string,
  status: 'active' | 'used' | 'discarded',
): Promise<void> {
  const { db } = await ensureRuntime();
  if (!id) throw new Error('灵感编号无效。');
  await updateIdeaStatus(db, id, status);
  await persistDb();
}

export async function apiListIdeas(): Promise<Array<Record<string, unknown>>> {
  const { db } = await ensureRuntime();
  return listIdeas(db);
}

export async function apiSavePreference(
  key: string,
  value: unknown,
): Promise<void> {
  const { db } = await ensureRuntime();
  if (!key) throw new Error('偏好键名无效。');
  await saveUserPreference(db, key, value);
  await persistDb();
}

export async function apiGetPreferences(): Promise<Record<string, unknown>> {
  const { db } = await ensureRuntime();
  return getUserPreferences(db);
}

export async function apiSaveVolumePlan(
  projectId: string,
  totalChapters: number,
): Promise<{ volumeCount: number }> {
  const { db } = await ensureRuntime();
  if (!projectId) throw new Error('请先保存作品简报。');
  const result = await saveVolumePlan(db, projectId, totalChapters);
  await persistDb();
  return result;
}

export async function apiGetVolumePlan(totalChapters: number) {
  return planVolumes(totalChapters);
}

// 多轮编辑：对指定章节的现有正文再跑一轮“润色+复审”，最多 3 轮。
// 借鉴 chinese-novelist-skill 的“不合格自动重写最多 3 轮”与 ReNovel 的“继续改写”。
export async function apiContinuePolish(
  chapterId: string,
  options?: { rounds?: number },
): Promise<{
  roundsRun: number;
  beforeLength: number;
  afterLength: number;
  changes: string[];
  reviewPassed: boolean;
}> {
  const { db } = await ensureRuntime();
  if (!chapterId) throw new Error('章节编号无效。');
  const row = await db
    .prepare(
      'SELECT c.*, p.story_bible_json AS bible FROM chapters c JOIN story_projects p ON p.id = c.project_id WHERE c.id = ?',
    )
    .bind(chapterId)
    .first<Record<string, unknown>>();
  if (!row) throw new Error('找不到该章节。');
  let polished = String(row.content ?? '');
  const brief = (() => {
    try {
      return normalizeWritingBrief(JSON.parse(String(row.bible ?? '{}')));
    } catch {
      return defaultWritingBrief;
    }
  })();
  const rounds = Math.min(3, Math.max(1, Number(options?.rounds) || 1));
  const changes: string[] = [];
  let roundsRun = 0;
  for (let index = 0; index < rounds; index += 1) {
    const result = polishDraft(polished, brief);
    if (result.appliedChanges.length === 0) break;
    polished = result.polished;
    changes.push(...result.appliedChanges);
    roundsRun += 1;
  }
  const afterFindings = reviewDraft(polished, {
    targetLength: brief.targetLength,
    protagonistName: brief.characters[0]?.name,
  });
  const reviewPassed = !afterFindings.some(
    (finding) => finding.severity === 'error',
  );
  if (roundsRun > 0) {
    const now = Date.now();
    await db
      .prepare('UPDATE chapters SET content = ?, updated_at = ? WHERE id = ?')
      .bind(polished, now, chapterId)
      .run();
    // 同步更新摘要
    const summaryRow = await db
      .prepare('SELECT sequence, title FROM chapter_summaries WHERE chapter_id = ?')
      .bind(chapterId)
      .first<{ sequence: number; title: string }>();
    if (summaryRow) {
      const updated = summarizeChapter(
        polished,
        summaryRow.title,
        summaryRow.sequence,
      );
      await db
        .prepare(
          'UPDATE chapter_summaries SET summary = ?, key_facts_json = ?, updated_at = ? WHERE chapter_id = ?',
        )
        .bind(updated.summary, JSON.stringify(updated.keyFacts), now, chapterId)
        .run();
    }
    await persistDb();
  }
  return {
    roundsRun,
    beforeLength: String(row.content ?? '').length,
    afterLength: polished.length,
    changes,
    reviewPassed,
  };
}

export async function apiGetGuides() {
  return WRITING_GUIDES;
}

export async function apiGetHooks() {
  return WRITING_GUIDES.find((guide) => guide.id === 'suspense-guide')?.content ?? [];
}
