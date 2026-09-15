import {
  analyzeBook,
  auditContinuity,
  buildContinuityFeedback,
  captureChapterPromise,
  compileWritingPrompt,
  createBriefDraft,
  createDemoDraft,
  defaultWritingBrief,
  isChapterLengthValid,
  normalizeWritingBrief,
  polishDraft,
  reviewDraft,
  type BrainMemory,
  type ContinuityItem,
  type ContinuityKind,
  type ReviewFinding,
  type TechniqueCandidate,
} from './pipeline.ts';
import { segmentBook } from './pipeline.ts';
// 头号写手 v2 增强模块
import {
  analyzePacing,
  auditAiTaste,
  extractChapterChanges,
  HOOK_TYPES,
  planVolumes,
  styleFingerprint,
  summarizeChapter,
  type ChapterChange,
} from './writer-v2.ts';

export type BookInput = {
  title: string;
  author?: string;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  text: string;
  sourceUrl?: string;
  rightsBasis: string;
  rightsNote?: string;
};

const continuityKinds = new Set<ContinuityKind>([
  'storyline',
  'foreshadow',
  'character',
  'relationship',
  'environment',
  'detail',
]);
const continuityStatuses = new Set(['active', 'resolved', 'parked']);
const continuityImportance = new Set(['critical', 'major', 'minor']);

function parseArray<T>(value: unknown): T[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function continuityFromRow(row: Record<string, unknown>): ContinuityItem {
  return {
    id: String(row.id),
    kind: continuityKinds.has(row.kind as ContinuityKind)
      ? (row.kind as ContinuityKind)
      : 'detail',
    title: String(row.title),
    description: cleanText(row.description, 10_000),
    currentState: cleanText(row.current_state, 10_000),
    changeRule: cleanText(row.change_rule, 2_000) || undefined,
    status: continuityStatuses.has(String(row.status))
      ? (String(row.status) as ContinuityItem['status'])
      : 'active',
    importance: continuityImportance.has(String(row.importance))
      ? (String(row.importance) as ContinuityItem['importance'])
      : 'major',
    introducedSequence: Number(row.introduced_sequence ?? 0),
    targetSequence:
      row.target_sequence === null || row.target_sequence === undefined
        ? undefined
        : Number(row.target_sequence),
    resolvedSequence:
      row.resolved_sequence === null || row.resolved_sequence === undefined
        ? undefined
        : Number(row.resolved_sequence),
    lastTouchedSequence: Number(row.last_touched_sequence ?? 0),
    mentionCount: Number(row.mention_count ?? 0),
    keywords: parseArray<string>(row.keywords_json),
    evolution: parseArray<{ sequence: number; note: string }>(
      row.evolution_json,
    ),
  };
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function keywordList(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[，,、\n]/u)
      : [];
  return [
    ...new Set(source.map((item) => cleanText(item, 40)).filter(Boolean)),
  ].slice(0, 12);
}

async function seedProjectContinuity(
  db: D1Database,
  projectId: string,
  brief: ReturnType<typeof normalizeWritingBrief>,
  now: number,
) {
  const existing = await db
    .prepare('SELECT title FROM continuity_items WHERE project_id = ?')
    .bind(projectId)
    .all<{ title: string }>();
  const titles = new Set(existing.results.map((item) => item.title));
  const seeds = [
    ...brief.characters.map((character) => ({
      kind: 'character',
      title: `${character.name || '未命名角色'}｜行为基线`,
      description: `${character.role || '身份待定'}；目标：${character.goal || '待定'}`,
      currentState:
        character.conflict || character.goal || '等待补充人物当前状态',
      changeRule:
        '人物可以改变，但要先出现触发事件、抵抗或犹豫，再形成新行为。',
      importance: 'major',
      keywords: [character.name].filter(Boolean),
    })),
    ...(brief.worldSetting
      ? [
          {
            kind: 'environment',
            title: '世界环境基线',
            description: brief.worldSetting,
            currentState: brief.worldSetting,
            changeRule: '规则或环境变化必须有来源、传播过程和可见后果。',
            importance: 'critical',
            keywords: [],
          },
        ]
      : []),
    ...(brief.plotDirection
      ? [
          {
            kind: 'storyline',
            title: '全书主线',
            description: brief.plotDirection,
            currentState: brief.chapterGoal,
            changeRule: '主线转向必须由人物选择或已铺设信息触发。',
            importance: 'critical',
            keywords: brief.characters.map((item) => item.name).filter(Boolean),
          },
        ]
      : []),
  ].filter((item) => !titles.has(item.title));
  if (!seeds.length) return;
  await db.batch(
    seeds.map((item) =>
      db
        .prepare(`INSERT INTO continuity_items
      (id, project_id, kind, title, description, current_state, change_rule, status,
        importance, introduced_sequence, target_sequence, resolved_sequence,
        last_touched_sequence, mention_count, keywords_json, evolution_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, NULL, NULL, 0, 0, ?, '[]', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          projectId,
          item.kind,
          item.title,
          item.description,
          item.currentState,
          item.changeRule,
          item.importance,
          JSON.stringify(item.keywords),
          now,
          now,
        ),
    ),
  );
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function saveBook(
  db: D1Database,
  files: R2Bucket,
  input: BookInput,
) {
  const hash = await sha256(input.bytes);
  const duplicate = await db
    .prepare(
      'SELECT * FROM books WHERE sha256 = ? ORDER BY created_at DESC LIMIT 1',
    )
    .bind(hash)
    .first<Record<string, unknown>>();
  if (duplicate) {
    const now = Date.now();
    const chapterCount = segmentBook(input.text).length;
    await Promise.all([
      files.put(String(duplicate.text_storage_key), input.text, {
        httpMetadata: { contentType: 'text/plain; charset=utf-8' },
      }),
      db
        .prepare(`UPDATE books SET
          title = ?, author = ?, source_url = ?, rights_basis = ?, rights_note = ?,
          character_count = ?, chapter_count = ?, status = 'ready'
          WHERE id = ?`)
        .bind(
          input.title,
          input.author ?? duplicate.author ?? null,
          input.sourceUrl ?? duplicate.source_url ?? null,
          input.rightsBasis,
          input.rightsNote ?? duplicate.rights_note ?? null,
          input.text.length,
          chapterCount,
          duplicate.id,
        )
        .run(),
    ]);
    return {
      duplicate: true,
      book: {
        ...duplicate,
        title: input.title,
        author: input.author ?? duplicate.author ?? null,
        source_url: input.sourceUrl ?? duplicate.source_url ?? null,
        rights_basis: input.rightsBasis,
        rights_note: input.rightsNote ?? duplicate.rights_note ?? null,
        character_count: input.text.length,
        chapter_count: chapterCount,
        status: 'ready',
      },
      refreshedAt: now,
    };
  }

  const id = crypto.randomUUID();
  const safeName = input.filename.replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const storageKey = `books/${id}/original/${safeName}`;
  const textStorageKey = `books/${id}/normalized.txt`;
  await Promise.all([
    files.put(storageKey, input.bytes, {
      httpMetadata: { contentType: input.mediaType },
    }),
    files.put(textStorageKey, input.text, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    }),
  ]);
  const now = Date.now();
  const chapterCount = segmentBook(input.text).length;
  await db
    .prepare(`INSERT INTO books (
      id, title, author, original_filename, media_type, storage_key, text_storage_key,
      source_url, rights_basis, rights_note, sha256, character_count, chapter_count, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`)
    .bind(
      id,
      input.title,
      input.author ?? null,
      input.filename,
      input.mediaType,
      storageKey,
      textStorageKey,
      input.sourceUrl ?? null,
      input.rightsBasis,
      input.rightsNote ?? null,
      hash,
      input.text.length,
      chapterCount,
      now,
    )
    .run();
  return {
    duplicate: false,
    book: {
      id,
      title: input.title,
      author: input.author ?? null,
      original_filename: input.filename,
      media_type: input.mediaType,
      storage_key: storageKey,
      text_storage_key: textStorageKey,
      source_url: input.sourceUrl ?? null,
      rights_basis: input.rightsBasis,
      rights_note: input.rightsNote ?? null,
      sha256: hash,
      character_count: input.text.length,
      chapter_count: chapterCount,
      status: 'ready',
      created_at: now,
    },
  };
}

export async function runAnalysis(
  db: D1Database,
  files: R2Bucket,
  bookId: string,
  goal: string,
) {
  const book = await db
    .prepare('SELECT * FROM books WHERE id = ?')
    .bind(bookId)
    .first<Record<string, unknown>>();
  if (!book) throw new Error('找不到指定书籍。');
  const object = await files.get(String(book.text_storage_key));
  if (!object) throw new Error('书籍正文文件缺失。');
  const text = await object.text();
  const result = analyzeBook(text, goal);
  const runId = crypto.randomUUID();
  const now = Date.now();
  const evidenceRows = result.evidence.map((item) => ({
    id: crypto.randomUUID(),
    ...item,
  }));
  const statements = [
    db
      .prepare(`INSERT INTO analysis_runs
      (id, book_id, goal, status, chapter_map_json, created_at, completed_at)
      VALUES (?, ?, ?, 'complete', ?, ?, ?)`)
      .bind(runId, bookId, goal, JSON.stringify(result.chapters), now, now),
    ...evidenceRows.map((item) =>
      db
        .prepare(`INSERT INTO evidence_spans
      (id, analysis_run_id, chapter_label, start_offset, end_offset, excerpt, score, reasons_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          item.id,
          runId,
          item.chapterLabel,
          item.startOffset,
          item.endOffset,
          item.excerpt,
          item.score,
          JSON.stringify(item.reasons),
        ),
    ),
  ];
  const memoryRows = result.techniques.map((item) => ({
    id: crypto.randomUUID(),
    analysisRunId: runId,
    kind: 'technique',
    status: 'candidate',
    title: item.title,
    content: item.content,
    confidence: item.confidence,
    evidenceIds: item.evidenceIndexes
      .map((index) => evidenceRows[index]?.id)
      .filter(Boolean),
    useCount: 0,
    successCount: 0,
    createdAt: now,
    updatedAt: now,
  }));
  const insightRows = result.insights.map((item) => ({
    id: crypto.randomUUID(),
    analysisRunId: runId,
    kind: item.kind,
    status: 'candidate',
    title: item.title,
    content: item.content,
    confidence: item.confidence,
    evidenceIds: item.evidenceIndexes
      .map((index) => evidenceRows[index]?.id)
      .filter(Boolean),
    useCount: 0,
    successCount: 0,
    createdAt: now,
    updatedAt: now,
  }));
  const allMemoryRows = [...memoryRows, ...insightRows];
  statements.push(
    ...allMemoryRows.map((item) =>
      db
        .prepare(`INSERT INTO memory_items
    (id, analysis_run_id, kind, status, title, content_json, confidence, evidence_ids_json,
      use_count, success_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          item.id,
          item.analysisRunId,
          item.kind,
          item.status,
          item.title,
          JSON.stringify(item.content),
          item.confidence,
          JSON.stringify(item.evidenceIds),
          item.useCount,
          item.successCount,
          item.createdAt,
          item.updatedAt,
        ),
    ),
  );
  await db.batch(statements);
  return {
    runId,
    chapters: result.chapters,
    evidence: evidenceRows,
    memories: allMemoryRows,
  };
}

export async function setMemoryStatus(
  db: D1Database,
  memoryItemId: string,
  status: 'confirmed' | 'rejected',
  note?: string,
) {
  const current = await db
    .prepare('SELECT * FROM memory_items WHERE id = ?')
    .bind(memoryItemId)
    .first();
  if (!current) throw new Error('找不到指定记忆。');
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'UPDATE memory_items SET status = ?, updated_at = ? WHERE id = ?',
      )
      .bind(status, now, memoryItemId),
    db
      .prepare(
        'INSERT INTO memory_events (id, memory_item_id, action, note, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(crypto.randomUUID(), memoryItemId, status, note ?? null, now),
  ]);
  return { id: memoryItemId, status, updatedAt: now };
}

export async function saveContinuityItem(db: D1Database, input: unknown) {
  const body =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const projectId = cleanText(body.projectId, 80);
  const project = projectId
    ? await db
        .prepare('SELECT id FROM story_projects WHERE id = ?')
        .bind(projectId)
        .first<{ id: string }>()
    : null;
  if (!project) throw new Error('请选择有效作品。');
  const kind = continuityKinds.has(body.kind as ContinuityKind)
    ? (body.kind as ContinuityKind)
    : 'detail';
  const title = cleanText(body.title, 120);
  const description = cleanText(body.description, 1200);
  const currentState = cleanText(body.currentState, 1200) || description;
  if (!title || !currentState) throw new Error('名称和当前事实不能为空。');
  const importance = continuityImportance.has(String(body.importance))
    ? String(body.importance)
    : 'major';
  const introducedSequence = Math.max(0, Number(body.introducedSequence) || 0);
  const targetValue = Number(body.targetSequence);
  const targetSequence = targetValue > 0 ? Math.round(targetValue) : null;
  if (targetSequence && targetSequence < introducedSequence)
    throw new Error('计划兑现章节不能早于首次出现章节。');
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(`INSERT INTO continuity_items
      (id, project_id, kind, title, description, current_state, change_rule, status,
        importance, introduced_sequence, target_sequence, resolved_sequence,
        last_touched_sequence, mention_count, keywords_json, evolution_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?, 0, ?, '[]', ?, ?)`)
      .bind(
        id,
        projectId,
        kind,
        title,
        description,
        currentState,
        cleanText(body.changeRule, 800) || null,
        importance,
        introducedSequence,
        targetSequence,
        introducedSequence,
        JSON.stringify(keywordList(body.keywords)),
        now,
        now,
      ),
    db
      .prepare(`INSERT INTO continuity_events
      (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
      VALUES (?, ?, NULL, ?, 'created', ?, ?)`)
      .bind(crypto.randomUUID(), id, introducedSequence, currentState, now),
  ]);
  return { id, projectId, createdAt: now };
}

export async function saveContinuityNote(db: D1Database, input: unknown) {
  const body =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const projectId = cleanText(body.projectId, 80);
  const note = cleanText(body.note, 1200);
  const mode = body.mode === 'correction' ? 'correction' : 'idea';
  const sequence = Math.max(0, Math.round(Number(body.sequence) || 0));
  if (!projectId || !note) throw new Error('请选择作品并写下想法或修正。');
  const project = await db
    .prepare('SELECT id FROM story_projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string }>();
  if (!project) throw new Error('请选择有效作品。');
  const activeRows = await db
    .prepare(
      "SELECT * FROM continuity_items WHERE project_id = ? AND status = 'active'",
    )
    .bind(projectId)
    .all<Record<string, unknown>>();
  const active = activeRows.results.map(continuityFromRow);
  const matched = active
    .map((item) => ({
      item,
      score:
        item.keywords.filter((keyword) => note.includes(keyword)).length * 5 +
        item.title
          .split(/[｜：:·\s]/u)
          .filter((token) => token.length >= 2 && note.includes(token)).length *
          2,
    }))
    .sort((a, b) => b.score - a.score)[0];
  const now = Date.now();
  const targetMatch = note.match(/第\s*(\d{1,5})\s*章/u);
  const targetSequence = targetMatch ? Number(targetMatch[1]) : null;
  const noteKeywords = [
    ...new Set(
      (note.match(/[\p{Script=Han}]{2,8}/gu) ?? []).filter(
        (token) =>
          !/^(?:我想|可以|考虑|计划|这里|这个|以后|需要)$/u.test(token),
      ),
    ),
  ].slice(0, 8);
  const oldItem =
    mode === 'correction' && matched?.score > 0 ? matched.item : null;
  const id = crypto.randomUUID();
  const kind = oldItem?.kind ?? 'detail';
  const titlePrefix = mode === 'correction' ? '作者修正' : '作者想法';
  const title = `${titlePrefix}｜${oldItem?.title ?? note.slice(0, 36)}`;
  const keywords = oldItem?.keywords.length ? oldItem.keywords : noteKeywords;
  const statements: D1PreparedStatement[] = [];
  if (oldItem) {
    statements.push(
      db
        .prepare(
          "UPDATE continuity_items SET status = 'parked', updated_at = ? WHERE id = ?",
        )
        .bind(now, oldItem.id),
      db
        .prepare(`INSERT INTO continuity_events
        (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
        VALUES (?, ?, NULL, ?, 'superseded', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          oldItem.id,
          sequence,
          `作者修正旧事实：${note}`,
          now,
        ),
    );
  }
  statements.push(
    db
      .prepare(`INSERT INTO continuity_items
      (id, project_id, kind, title, description, current_state, change_rule, status,
        importance, introduced_sequence, target_sequence, resolved_sequence,
        last_touched_sequence, mention_count, keywords_json, evolution_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?)`)
      .bind(
        id,
        projectId,
        kind,
        title,
        mode === 'correction'
          ? `作者在第 ${sequence} 章审阅时覆盖旧事实。`
          : `作者在第 ${sequence} 章审阅时补充的创作想法。`,
        note,
        oldItem?.changeRule ??
          '进入正文前应先出现可见原因，进入正文后由机制持续检查其后果。',
        mode === 'correction' ? 'critical' : 'major',
        sequence,
        targetSequence,
        sequence,
        JSON.stringify(keywords),
        JSON.stringify([{ sequence, note }]),
        now,
        now,
      ),
    db
      .prepare(`INSERT INTO continuity_events
      (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        id,
        sequence,
        mode === 'correction' ? 'author-correction' : 'author-idea',
        note,
        now,
      ),
  );
  await db.batch(statements);
  return {
    id,
    action: oldItem ? 'replaced' : 'created',
    mode,
    matchedTitle: oldItem?.title,
  };
}

export async function updateContinuityItem(db: D1Database, input: unknown) {
  const body =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const id = cleanText(body.id, 80);
  const row = id
    ? await db
        .prepare('SELECT * FROM continuity_items WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>()
    : null;
  if (!row) throw new Error('找不到连续性条目。');
  const current = continuityFromRow(row);
  const status = continuityStatuses.has(String(body.status))
    ? (String(body.status) as ContinuityItem['status'])
    : current.status;
  const importance = continuityImportance.has(String(body.importance))
    ? (String(body.importance) as ContinuityItem['importance'])
    : current.importance;
  const sequence = Math.max(
    0,
    Math.round(Number(body.sequence) || current.lastTouchedSequence),
  );
  const targetValue =
    body.targetSequence === null || body.targetSequence === ''
      ? null
      : Number(body.targetSequence);
  const targetSequence =
    targetValue === null
      ? null
      : targetValue > 0
        ? Math.round(targetValue)
        : (current.targetSequence ?? null);
  const evolutionNote = cleanText(body.evolutionNote, 800);
  const evolution = evolutionNote
    ? [...current.evolution, { sequence, note: evolutionNote }].slice(-30)
    : current.evolution;
  const now = Date.now();
  const action =
    status !== current.status
      ? status === 'resolved'
        ? 'resolved'
        : status === 'active'
          ? 'reopened'
          : 'parked'
      : evolutionNote
        ? 'advanced'
        : 'updated';
  await db.batch([
    db
      .prepare(`UPDATE continuity_items SET
        title = ?, description = ?, current_state = ?, change_rule = ?, status = ?,
        importance = ?, target_sequence = ?, resolved_sequence = ?, keywords_json = ?,
        evolution_json = ?, updated_at = ? WHERE id = ?`)
      .bind(
        cleanText(body.title, 120) || current.title,
        cleanText(body.description, 1200) || current.description,
        cleanText(body.currentState, 1200) || current.currentState,
        cleanText(body.changeRule, 800) || current.changeRule || null,
        status,
        importance,
        targetSequence,
        status === 'resolved'
          ? sequence
          : status === 'active'
            ? null
            : (current.resolvedSequence ?? null),
        JSON.stringify(
          body.keywords === undefined
            ? current.keywords
            : keywordList(body.keywords),
        ),
        JSON.stringify(evolution),
        now,
        id,
      ),
    db
      .prepare(`INSERT INTO continuity_events
      (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        id,
        sequence,
        action,
        evolutionNote || cleanText(body.note, 800) || null,
        now,
      ),
  ]);
  return { id, status, updatedAt: now };
}

export async function compilePromptForBrief(db: D1Database, input?: unknown) {
  const brief = normalizeWritingBrief(input ?? defaultWritingBrief);
  const project = await db
    .prepare('SELECT * FROM story_projects WHERE title = ? LIMIT 1')
    .bind(brief.title)
    .first<Record<string, unknown>>();
  if (project) {
    await seedProjectContinuity(db, String(project.id), brief, Date.now());
  }
  const previousChapter = project
    ? await db
        .prepare(
          'SELECT title, content, sequence FROM chapters WHERE project_id = ? ORDER BY sequence DESC LIMIT 1',
        )
        .bind(project.id)
        .first<{ title: string; content: string; sequence: number }>()
    : null;
  const nextSequence = Number(previousChapter?.sequence ?? 0) + 1;
  const continuityRows = project
    ? await db
        .prepare(
          "SELECT * FROM continuity_items WHERE project_id = ? AND status != 'parked' ORDER BY updated_at DESC",
        )
        .bind(project.id)
        .all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const continuity = continuityRows.results.map(continuityFromRow);
  const confirmed = await db
    .prepare(`SELECT * FROM memory_items
    WHERE status = 'confirmed' ORDER BY updated_at DESC LIMIT 40`)
    .all<Record<string, unknown>>();
  const uniqueRows = confirmed.results.filter(
    (row, index, rows) =>
      rows.findIndex(
        (candidate) =>
          String(candidate.kind) === String(row.kind) &&
          String(candidate.title) === String(row.title),
      ) === index,
  );
  const selectedTechniqueRows = uniqueRows
    .filter((row) => row.kind === 'technique')
    .filter(
      (row, index, rows) =>
        rows.findIndex(
          (candidate) => String(candidate.title) === String(row.title),
        ) === index,
    )
    .slice(0, 5);
  const selectedWeaknessRows = uniqueRows
    .filter((row) => row.kind === 'weakness')
    .slice(0, 8);
  const selectedMaterialRows = uniqueRows
    .filter((row) => row.kind === 'material')
    .slice(0, 5);
  const selectedInsightRows = uniqueRows
    .filter((row) =>
      ['structure', 'character', 'core', 'continuity'].includes(
        String(row.kind),
      ),
    )
    .slice(0, 8);
  const techniques: TechniqueCandidate[] = (
    brief.useMemories ? selectedTechniqueRows : []
  ).map((row) => ({
    title: String(row.title),
    confidence: Number(row.confidence),
    evidenceIndexes: [],
    content: JSON.parse(String(row.content_json)),
  }));
  const toBrainMemory = (row: Record<string, unknown>): BrainMemory => ({
    id: String(row.id),
    kind: ['material', 'structure', 'character', 'core', 'continuity'].includes(
      String(row.kind),
    )
      ? (String(row.kind) as BrainMemory['kind'])
      : 'weakness',
    title: String(row.title),
    content: JSON.parse(String(row.content_json)),
  });
  const weaknesses = (brief.useMemories ? selectedWeaknessRows : []).map(
    toBrainMemory,
  );
  const materials = (brief.useMemories ? selectedMaterialRows : []).map(
    toBrainMemory,
  );
  const insights = (brief.useMemories ? selectedInsightRows : []).map(
    toBrainMemory,
  );
  return {
    brief,
    prompt: compileWritingPrompt({
      brief,
      techniques,
      weaknesses,
      materials,
      insights,
      continuity,
      nextSequence,
      previousChapter: previousChapter ?? undefined,
    }),
    techniqueRows: brief.useMemories ? selectedTechniqueRows : [],
    weaknesses,
    materials,
    insights,
    continuity,
    nextSequence,
    previousChapter: previousChapter ?? undefined,
  };
}

export async function saveWritingBrief(db: D1Database, input?: unknown) {
  const brief = normalizeWritingBrief(input ?? defaultWritingBrief);
  const now = Date.now();
  const existing = await db
    .prepare('SELECT id FROM story_projects WHERE title = ? LIMIT 1')
    .bind(brief.title)
    .first<{ id: string }>();
  const projectId = existing?.id ?? crypto.randomUUID();
  await db
    .prepare(
      existing
        ? 'UPDATE story_projects SET premise = ?, story_bible_json = ?, updated_at = ? WHERE id = ?'
        : 'INSERT INTO story_projects (id, title, premise, story_bible_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      ...(existing
        ? [brief.inspiration, JSON.stringify(brief), now, projectId]
        : [
            projectId,
            brief.title,
            brief.inspiration,
            JSON.stringify(brief),
            now,
            now,
          ]),
    )
    .run();
  await seedProjectContinuity(db, projectId, brief, now);
  return { projectId, brief, savedAt: now };
}

async function persistContinuityFeedback(
  db: D1Database,
  input: {
    projectId: string;
    chapterId: string;
    sequence: number;
    chapterGoal: string;
    content: string;
    feedback: ReturnType<typeof buildContinuityFeedback>;
    now: number;
  },
) {
  const statements: D1PreparedStatement[] = [];
  const mainlineRow = await db
    .prepare(
      "SELECT * FROM continuity_items WHERE project_id = ? AND title = '全书主线' AND status = 'active' LIMIT 1",
    )
    .bind(input.projectId)
    .first<Record<string, unknown>>();
  if (mainlineRow) {
    const mainline = continuityFromRow(mainlineRow);
    const state = `第 ${input.sequence} 章任务：${input.chapterGoal}；章尾接续：${input.feedback.summary}`;
    const evolution = [
      ...mainline.evolution,
      { sequence: input.sequence, note: state },
    ].slice(-120);
    statements.push(
      db
        .prepare(`UPDATE continuity_items SET
          current_state = ?, last_touched_sequence = ?, evolution_json = ?, updated_at = ?
          WHERE id = ?`)
        .bind(
          state,
          input.sequence,
          JSON.stringify(evolution),
          input.now,
          mainline.id,
        ),
      db
        .prepare(`INSERT INTO continuity_events
        (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
        VALUES (?, ?, ?, ?, 'auto-feedback', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          mainline.id,
          input.chapterId,
          input.sequence,
          input.feedback.warningCount
            ? `自动反哺章尾接续，并保留 ${input.feedback.warningCount} 个待处理风险。`
            : '自动反哺本章结果与章尾接续。',
          input.now,
        ),
    );
  }
  const promise = captureChapterPromise(input.content, input.sequence);
  if (promise) {
    const existing = await db
      .prepare(
        'SELECT id FROM continuity_items WHERE project_id = ? AND title = ? LIMIT 1',
      )
      .bind(input.projectId, promise.title)
      .first<{ id: string }>();
    if (!existing) {
      const promiseId = crypto.randomUUID();
      statements.push(
        db
          .prepare(`INSERT INTO continuity_items
          (id, project_id, kind, title, description, current_state, change_rule, status,
            importance, introduced_sequence, target_sequence, resolved_sequence,
            last_touched_sequence, mention_count, keywords_json, evolution_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?, 1, ?, ?, ?, ?)`)
          .bind(
            promiseId,
            input.projectId,
            promise.kind,
            promise.title,
            promise.description,
            promise.currentState,
            promise.changeRule,
            promise.importance,
            promise.introducedSequence,
            promise.targetSequence,
            promise.introducedSequence,
            JSON.stringify(promise.keywords),
            JSON.stringify([
              {
                sequence: input.sequence,
                note: '机制从章尾自动识别并建立追踪。',
              },
            ]),
            input.now,
            input.now,
          ),
        db
          .prepare(`INSERT INTO continuity_events
          (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
          VALUES (?, ?, ?, ?, 'auto-captured', ?, ?)`)
          .bind(
            crypto.randomUUID(),
            promiseId,
            input.chapterId,
            input.sequence,
            promise.currentState,
            input.now,
          ),
      );
    }
  }
  if (statements.length) await db.batch(statements);
}

export async function runWritingLoop(
  db: D1Database,
  input?: unknown,
  options?: { demo?: boolean },
) {
  const {
    brief,
    prompt,
    techniqueRows,
    weaknesses,
    materials,
    insights,
    continuity,
    nextSequence,
    previousChapter,
  } = await compilePromptForBrief(db, input);
  const draft = options?.demo
    ? createDemoDraft()
    : createBriefDraft(brief, previousChapter);
  const reviewContext = {
    targetLength: brief.targetLength,
    protagonistName: brief.characters[0]?.name,
    protagonistGoal: brief.characters[0]?.goal,
    chapterTitle: brief.chapterTitle,
    previousEnding: previousChapter?.content.slice(-180),
  };
  const findingsBefore = reviewDraft(draft, reviewContext);
  const polishResult = polishDraft(draft, brief, {
    weaknesses,
    materials: [...materials, ...insights],
  });
  const polished = polishResult.polished;
  if (!isChapterLengthValid(polished)) {
    throw new Error(
      `成稿为 ${polished.length} 字，未达到 3500–4500 字硬性标准，未写入章节。`,
    );
  }
  const findingsAfter = reviewDraft(polished, reviewContext);
  const continuityAudit = auditContinuity(polished, continuity, nextSequence);
  const finalFindings: ReviewFinding[] = [
    ...findingsAfter,
    ...continuityAudit.map((finding) => ({
      reviewType: 'expert' as const,
      dimension: finding.dimension,
      severity: finding.severity,
      message: finding.message,
      suggestion: finding.suggestion,
    })),
  ];
  const now = Date.now();
  const project = await db
    .prepare('SELECT * FROM story_projects WHERE title = ? LIMIT 1')
    .bind(brief.title)
    .first<Record<string, unknown>>();
  const projectId = project ? String(project.id) : crypto.randomUUID();
  const chapterId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (!project) {
    statements.push(
      db
        .prepare(`INSERT INTO story_projects
      (id, title, premise, story_bible_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          projectId,
          brief.title,
          brief.inspiration,
          JSON.stringify(brief),
          now,
          now,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(`UPDATE story_projects SET
          premise = ?, story_bible_json = ?, updated_at = ? WHERE id = ?`)
        .bind(brief.inspiration, JSON.stringify(brief), now, projectId),
    );
  }
  const previousSequence = await db
    .prepare(
      'SELECT MAX(sequence) AS max_sequence FROM chapters WHERE project_id = ?',
    )
    .bind(projectId)
    .first<{ max_sequence: number | null }>();
  const sequence = Number(previousSequence?.max_sequence ?? 0) + 1;
  const continuityFeedback = buildContinuityFeedback(
    polished,
    continuityAudit,
    sequence,
  );
  // ---- 头号写手 v2：12类变更声明 + 节奏曲线 + 文风指纹 + AI味审计 ----
  const v2Changes = extractChapterChanges(
    polished,
    continuity.map((item) => ({ title: item.title, currentState: item.currentState })),
    sequence,
  );
  const v2Mechanism = {
    changes: v2Changes,
    pacing: analyzePacing(polished),
    fingerprint: styleFingerprint(polished),
    aiTaste: auditAiTaste(polished),
    hooks: HOOK_TYPES.slice(0, 3),
  };
  statements.push(
    db
      .prepare(`INSERT INTO chapters
    (id, project_id, sequence, title, outline, content, prompt_snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        chapterId,
        projectId,
        sequence,
        brief.chapterTitle,
        brief.chapterGoal,
        polished,
        JSON.stringify({
          brief,
          compiledPrompt: prompt,
          mechanism: {
            name: '多阶段成文润色',
            stages: [
              '读取创作简报与上一章',
              '检索写作大脑',
              '生成初稿',
              'AI味专项初审',
              '生活气息润色',
              '人物力度润色',
              '冲突代价润色',
              '成稿复审',
              '问题反哺写作大脑',
            ],
            draft,
            polished,
            findingsBefore,
            findingsAfter,
            appliedChanges: polishResult.appliedChanges,
            memoryTitles: polishResult.memoryTitles,
          },
          continuityMechanism: {
            name: '故事逻辑与接续机制',
            sequence,
            activeItems: continuity.filter((item) => item.status === 'active'),
            audit: continuityAudit,
            feedback: continuityFeedback,
            rules: [
              '相关才提，不为打卡机械复述',
              '人物与环境变化必须经过原因、反应和新状态',
              '关键词出现只算触达，填坑需要人工确认',
              '久未演变不一定错误，但必须检查维持不变的代价',
            ],
          },
          v2Mechanism,
        }),
        now,
        now,
      ),
  );
  statements.push(
    ...finalFindings.map((finding) =>
      db
        .prepare(`INSERT INTO review_findings
    (id, chapter_id, review_type, dimension, severity, start_offset, end_offset,
      message, suggestion, memory_candidate_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
        .bind(
          crypto.randomUUID(),
          chapterId,
          finding.reviewType,
          finding.dimension,
          finding.severity,
          finding.startOffset ?? null,
          finding.endOffset ?? null,
          finding.message,
          finding.suggestion,
          finding.memoryCandidate
            ? JSON.stringify(finding.memoryCandidate)
            : null,
          now,
        ),
    ),
  );
  const mentionedItemIds = [
    ...new Set(
      continuityAudit
        .filter((finding) => finding.mentioned)
        .map((finding) => finding.itemId),
    ),
  ];
  statements.push(
    ...mentionedItemIds.flatMap((itemId) => {
      const autoResolved = continuityAudit.some(
        (finding) => finding.itemId === itemId && finding.autoResolved,
      );
      return [
        db
          .prepare(`UPDATE continuity_items SET
          last_touched_sequence = ?, mention_count = mention_count + 1,
          status = ?, resolved_sequence = ?, updated_at = ? WHERE id = ?`)
          .bind(
            sequence,
            autoResolved ? 'resolved' : 'active',
            autoResolved ? sequence : null,
            now,
            itemId,
          ),
        db
          .prepare(`INSERT INTO continuity_events
          (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            crypto.randomUUID(),
            itemId,
            chapterId,
            sequence,
            autoResolved ? 'auto-resolved' : 'mentioned',
            autoResolved
              ? '正文同时给出明确揭示和行动后果，机制自动判定兑现。'
              : '正文检测到相关关键词；是否形成推进仍由后续因果判断。',
            now,
          ),
      ];
    }),
    ...continuityAudit
      .filter((finding) => finding.severity === 'warning')
      .map((finding) =>
        db
          .prepare(`INSERT INTO continuity_events
          (id, continuity_item_id, chapter_id, sequence, action, note, created_at)
          VALUES (?, ?, ?, ?, 'warning', ?, ?)`)
          .bind(
            crypto.randomUUID(),
            finding.itemId,
            chapterId,
            sequence,
            finding.message,
            now,
          ),
      ),
  );
  const reviewCandidates = [...findingsBefore, ...findingsAfter]
    .flatMap((finding) =>
      finding.memoryCandidate
        ? [{ ...finding.memoryCandidate, suggestion: finding.suggestion }]
        : [],
    )
    .filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.title === item.title) ===
        index,
    );
  if (reviewCandidates.length) {
    const existingWeaknesses = await db
      .prepare("SELECT title FROM memory_items WHERE kind = 'weakness'")
      .all<{ title: string }>();
    const existingTitles = new Set(
      existingWeaknesses.results.map((item) => item.title),
    );
    statements.push(
      ...reviewCandidates
        .filter((item) => !existingTitles.has(item.title))
        .map((item) =>
          db
            .prepare(`INSERT INTO memory_items
      (id, analysis_run_id, kind, status, title, content_json, confidence,
        evidence_ids_json, use_count, success_count, created_at, updated_at)
      VALUES (?, NULL, 'weakness', 'candidate', ?, ?, 70, '[]', 0, 0, ?, ?)`)
            .bind(
              crypto.randomUUID(),
              item.title,
              JSON.stringify({
                rule: item.rule,
                suggestedFix: item.suggestion,
                lastChapter: brief.chapterTitle,
              }),
              now,
              now,
            ),
        ),
    );
  }
  if (techniqueRows.length) {
    statements.push(
      ...techniqueRows.map((row) =>
        db
          .prepare(
            'UPDATE memory_items SET use_count = use_count + 1, updated_at = ? WHERE id = ?',
          )
          .bind(now, row.id),
      ),
    );
  }
  // ---- 头号写手 v2：章节摘要（双记忆） ----
  const chapterSummary = summarizeChapter(polished, brief.chapterTitle, sequence);
  statements.push(
    db
      .prepare(`INSERT INTO chapter_summaries
      (id, project_id, chapter_id, sequence, title, summary, key_facts_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_id) DO UPDATE SET
        summary = excluded.summary, key_facts_json = excluded.key_facts_json,
        updated_at = excluded.updated_at`)
      .bind(
        crypto.randomUUID(),
        projectId,
        chapterId,
        sequence,
        chapterSummary.title,
        chapterSummary.summary,
        JSON.stringify(chapterSummary.keyFacts),
        now,
        now,
      ),
  );
  await db.batch(statements);
  await seedProjectContinuity(db, projectId, brief, now);
  await persistContinuityFeedback(db, {
    projectId,
    chapterId,
    sequence,
    chapterGoal: brief.chapterGoal,
    content: polished,
    feedback: continuityFeedback,
    now,
  });
  return {
    projectId,
    chapterId,
    brief,
    prompt,
    draft,
    polished,
    findingsBefore,
    findingsAfter,
    continuityAudit,
    continuityFeedback,
  };
}

function outlineChapterTask(line: string, index: number) {
  const [label, ...goalParts] = line.split('｜');
  const goal = goalParts.join('｜').trim() || label.trim();
  const title = label
    .replace(/^第\s*[零一二三四五六七八九十百千0-9]{1,8}\s*章\s*/u, '')
    .replace(/[：:].*$/u, '')
    .trim();
  return {
    chapterTitle: title || goal.split(/[：:]/u)[0] || `第 ${index + 1} 章`,
    chapterGoal: goal,
  };
}

/**
 * Remove only a project's generated chapters and their derived records, then
 * run the normal write/review loop against the first five outline tasks.
 */
export async function rebuildProjectChapters(db: D1Database, input?: unknown) {
  const body =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const requestedProjectId =
    typeof body.projectId === 'string' ? body.projectId : undefined;
  const requestedTitle = typeof body.title === 'string' ? body.title : undefined;
  const project = requestedProjectId
    ? await db
        .prepare('SELECT * FROM story_projects WHERE id = ? LIMIT 1')
        .bind(requestedProjectId)
        .first<Record<string, unknown>>()
    : await db
        .prepare('SELECT * FROM story_projects WHERE title = ? LIMIT 1')
        .bind(requestedTitle ?? defaultWritingBrief.title)
        .first<Record<string, unknown>>();
  if (!project) throw new Error('找不到需要重建的作品。');
  const storedBrief = (() => {
    try {
      return JSON.parse(String(project.story_bible_json ?? '{}'));
    } catch {
      return defaultWritingBrief;
    }
  })();
  const baseBrief = normalizeWritingBrief(body.brief ?? storedBrief);
  const outlineLines = baseBrief.outline
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (outlineLines.length < 5) {
    throw new Error('重建前五章需要至少 5 条大纲任务。');
  }
  const chapterRows = await db
    .prepare('SELECT id FROM chapters WHERE project_id = ?')
    .bind(project.id)
    .all<{ id: string }>();
  const cleanup = chapterRows.results.flatMap((row) => [
    db.prepare('DELETE FROM review_findings WHERE chapter_id = ?').bind(row.id),
    db.prepare('DELETE FROM continuity_events WHERE chapter_id = ?').bind(row.id),
  ]);
  cleanup.push(
    db.prepare('DELETE FROM chapters WHERE project_id = ?').bind(project.id),
    db
      .prepare(
        "DELETE FROM continuity_items WHERE project_id = ? AND title LIKE '第 % 章章尾承诺'",
      )
      .bind(project.id),
    db
      .prepare(`UPDATE continuity_items SET
        current_state = ?, status = 'active', resolved_sequence = NULL,
        last_touched_sequence = 0, mention_count = 0, evolution_json = '[]', updated_at = ?
        WHERE project_id = ? AND title = '全书主线'`)
      .bind(outlineChapterTask(outlineLines[0], 0).chapterGoal, Date.now(), project.id),
    db
      .prepare(`UPDATE continuity_items SET
        last_touched_sequence = 0, mention_count = 0, evolution_json = '[]', updated_at = ?
        WHERE project_id = ? AND (title LIKE '%｜行为基线' OR title = '世界环境基线')`)
      .bind(Date.now(), project.id),
  );
  if (cleanup.length) await db.batch(cleanup);
  const results = [];
  const maritimeTitles = /潮汐|海上|旧港|航线/u.test(
    `${baseBrief.worldSetting} ${baseBrief.plotDirection}`,
  )
    ? ['慢了七分钟的潮钟', '白线之外', '明日拘留册', '白鹭渡轮', '第七码头']
    : [];
  for (const [index, line] of outlineLines.entries()) {
    const task = outlineChapterTask(line, index);
    results.push(
      await runWritingLoop(db, {
        ...baseBrief,
        chapterTitle: maritimeTitles[index] || task.chapterTitle,
        chapterGoal: task.chapterGoal,
      }),
    );
  }
  return {
    projectId: String(project.id),
    chapters: results.map((result) => ({
      chapterId: result.chapterId,
      sequence: result.continuityFeedback.sequence,
      title: result.brief.chapterTitle,
      characterCount: result.polished.length,
    })),
  };
}

export async function workspaceSnapshot(db: D1Database) {
  const [
    books,
    analyses,
    evidence,
    memories,
    projects,
    chapters,
    findings,
    continuityItems,
    continuityEvents,
    ideas,
    chapterSummaries,
    preferences,
    volumes,
  ] = await Promise.all([
    db.prepare('SELECT * FROM books ORDER BY created_at DESC LIMIT 20').all(),
    db
      .prepare('SELECT * FROM analysis_runs ORDER BY created_at DESC LIMIT 10')
      .all(),
    db
      .prepare('SELECT * FROM evidence_spans ORDER BY score DESC LIMIT 30')
      .all(),
    db
      .prepare('SELECT * FROM memory_items ORDER BY updated_at DESC LIMIT 30')
      .all(),
    db
      .prepare('SELECT * FROM story_projects ORDER BY updated_at DESC LIMIT 10')
      .all(),
    db
      .prepare('SELECT * FROM chapters ORDER BY updated_at DESC LIMIT 200')
      .all(),
    db
      .prepare(
        'SELECT * FROM review_findings ORDER BY created_at DESC LIMIT 500',
      )
      .all(),
    db
      .prepare(
        'SELECT * FROM continuity_items ORDER BY updated_at DESC LIMIT 500',
      )
      .all(),
    db
      .prepare(
        'SELECT * FROM continuity_events ORDER BY created_at DESC LIMIT 1000',
      )
      .all(),
    db
      .prepare('SELECT * FROM ideas ORDER BY updated_at DESC LIMIT 100')
      .all(),
    db
      .prepare(
        'SELECT * FROM chapter_summaries ORDER BY sequence DESC LIMIT 200',
      )
      .all(),
    db.prepare('SELECT * FROM user_preferences ORDER BY updated_at DESC').all(),
    db.prepare('SELECT * FROM volumes ORDER BY volume_no ASC LIMIT 50').all(),
  ]);
  return {
    books: books.results,
    analyses: analyses.results,
    evidence: evidence.results,
    memories: memories.results,
    projects: projects.results,
    chapters: chapters.results,
    findings: findings.results,
    continuityItems: continuityItems.results,
    continuityEvents: continuityEvents.results,
    ideas: ideas.results,
    chapterSummaries: chapterSummaries.results,
    preferences: preferences.results,
    volumes: volumes.results,
  };
}

// ----------------------------------------------------------------
// 头号写手 v2：灵感库 / 偏好记忆 / 卷规划（确定性 CRUD）
// ----------------------------------------------------------------

export type IdeaInput = {
  kind?: string;
  title: string;
  content: string;
  priority?: number;
  personTag?: string;
  tags?: string[];
  placement?: string;
};

export async function saveIdea(
  db: D1Database,
  input: IdeaInput,
): Promise<{ id: string }> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO ideas
      (id, kind, title, content, priority, person_tag, tags_json, placement, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(
      id,
      input.kind?.trim() || '情节点',
      input.title.trim(),
      input.content.trim(),
      Math.max(1, Math.min(5, Number(input.priority) || 3)),
      input.personTag?.trim() || null,
      JSON.stringify(input.tags ?? []),
      input.placement?.trim() || null,
      now,
      now,
    )
    .run();
  return { id };
}

export async function updateIdeaStatus(
  db: D1Database,
  id: string,
  status: 'active' | 'used' | 'discarded',
  usedInSequence?: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE ideas SET status = ?, used_in_sequence = ?, updated_at = ? WHERE id = ?',
    )
    .bind(status, usedInSequence ?? null, Date.now(), id)
    .run();
}

export async function saveUserPreference(
  db: D1Database,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .prepare(`INSERT INTO user_preferences (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value), Date.now())
    .run();
}

export async function getUserPreferences(
  db: D1Database,
): Promise<Record<string, unknown>> {
  const rows = await db
    .prepare('SELECT key, value_json FROM user_preferences')
    .all<{ key: string; value_json: string }>();
  const result: Record<string, unknown> = {};
  for (const row of rows.results) {
    try {
      result[row.key] = JSON.parse(row.value_json);
    } catch {
      // 忽略损坏的偏好项
    }
  }
  return result;
}

export async function saveVolumePlan(
  db: D1Database,
  projectId: string,
  totalChapters: number,
): Promise<{ volumeCount: number }> {
  const plan = planVolumes(totalChapters);
  const now = Date.now();
  await db
    .prepare('DELETE FROM volumes WHERE project_id = ?')
    .bind(projectId)
    .run();
  for (const volume of plan.volumes) {
    await db
      .prepare(`INSERT INTO volumes
        (id, project_id, volume_no, title, strategy, pacing, start_sequence, end_sequence, climax_sequence, chapter_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        projectId,
        volume.volumeNo,
        volume.title,
        volume.strategy,
        volume.pacing,
        volume.startSequence,
        volume.endSequence,
        volume.climaxChapter,
        volume.chapterCount,
        now,
        now,
      )
      .run();
  }
  return { volumeCount: plan.volumes.length };
}

export async function listIdeas(
  db: D1Database,
  status?: 'active' | 'used' | 'discarded',
): Promise<Array<Record<string, unknown>>> {
  const rows = status
    ? await db
        .prepare('SELECT * FROM ideas WHERE status = ? ORDER BY priority ASC, updated_at DESC')
        .bind(status)
        .all()
    : await db
        .prepare('SELECT * FROM ideas ORDER BY status ASC, priority ASC, updated_at DESC')
        .all();
  return rows.results;
}
