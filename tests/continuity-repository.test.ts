import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';

import { defaultWritingBrief } from '../lib/pipeline.ts';
import {
  compilePromptForBrief,
  runWritingLoop,
  saveContinuityItem,
  saveContinuityNote,
  saveWritingBrief,
  updateContinuityItem,
  workspaceSnapshot,
} from '../lib/workspace-repository.ts';

class TestStatement {
  private values: SQLInputValue[] = [];
  private statement: ReturnType<DatabaseSync['prepare']>;

  constructor(statement: ReturnType<DatabaseSync['prepare']>) {
    this.statement = statement;
  }

  bind(...values: unknown[]) {
    this.values = values as SQLInputValue[];
    return this;
  }

  async run() {
    return this.statement.run(...this.values);
  }

  async first<T>() {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.statement.all(...this.values) as T[] };
  }
}

class TestD1 {
  private database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(sql: string) {
    return new TestStatement(this.database.prepare(sql));
  }

  async batch(statements: TestStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function applyMigration(database: DatabaseSync, filename: string) {
  const sql = readFileSync(
    new URL(`../drizzle/${filename}`, import.meta.url),
    'utf8',
  );
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) database.exec(statement);
  }
}

void test('persists a project-specific continuity mechanism and compiles it into writing', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  applyMigration(database, '0000_modern_mockingbird.sql');
  applyMigration(database, '0001_steady_arachne.sql');
  applyMigration(database, '0002_v2_enhancements.sql');
  const db = new TestD1(database) as unknown as D1Database;

  const saved = await saveWritingBrief(db, defaultWritingBrief);
  const seeded = await workspaceSnapshot(db);
  assert.ok(
    seeded.continuityItems.some(
      (item) =>
        item.project_id === saved.projectId && item.kind === 'character',
    ),
  );
  assert.ok(
    seeded.continuityItems.some(
      (item) =>
        item.project_id === saved.projectId && item.kind === 'environment',
    ),
  );

  const created = await saveContinuityItem(db, {
    projectId: saved.projectId,
    kind: 'foreshadow',
    title: '潮汐线铜币',
    description: '铜币由陌生人留下，来源还未揭示。',
    currentState: '铜币在许照手里，潮汐线含义未知。',
    changeRule: '找到同样标记的人以后才能揭示来源。',
    importance: 'critical',
    introducedSequence: 1,
    targetSequence: 5,
    keywords: ['铜币', '潮汐线'],
  });
  const compiled = await compilePromptForBrief(db, defaultWritingBrief);
  assert.match(compiled.prompt.assembled, /作品连续性账本/);
  assert.match(compiled.prompt.assembled, /潮汐线铜币/);

  const correction = await saveContinuityNote(db, {
    projectId: saved.projectId,
    mode: 'correction',
    sequence: 2,
    note: '许照从第 2 章起开始信任亲历停电的人，但仍不接受口头保证。',
  });
  assert.equal(correction.action, 'replaced');
  const corrected = await workspaceSnapshot(db);
  assert.ok(
    corrected.continuityItems.some(
      (item) =>
        item.project_id === saved.projectId &&
        String(item.title).startsWith('作者修正') &&
        item.status === 'active',
    ),
  );

  await updateContinuityItem(db, {
    id: created.id,
    status: 'resolved',
    sequence: 5,
    evolutionNote: '确认铜币来自被控制者留下的互认标记。',
    currentState: '铜币的来源已经揭示，并改变了许照对队长的判断。',
  });
  const finalSnapshot = await workspaceSnapshot(db);
  const item = finalSnapshot.continuityItems.find(
    (candidate) => candidate.id === created.id,
  );
  assert.equal(item?.status, 'resolved');
  assert.equal(item?.resolved_sequence, 5);
  assert.match(String(item?.current_state), /改变了许照对队长的判断/);
  assert.match(String(item?.evolution_json), /互认标记/);
  assert.ok(
    finalSnapshot.continuityEvents.some(
      (event) =>
        event.continuity_item_id === created.id && event.action === 'resolved',
    ),
  );

  const loop = await runWritingLoop(db, defaultWritingBrief);
  assert.equal(loop.continuityFeedback.sequence, 1);
  const feedbackSnapshot = await workspaceSnapshot(db);
  assert.ok(
    feedbackSnapshot.continuityEvents.some(
      (event) =>
        event.chapter_id === loop.chapterId && event.action === 'auto-feedback',
    ),
  );
  const savedChapter = feedbackSnapshot.chapters.find(
    (chapter) => chapter.id === loop.chapterId,
  );
  assert.match(String(savedChapter?.prompt_snapshot_json), /feedback/);

  database.close();
});
