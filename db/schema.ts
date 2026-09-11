import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const books = sqliteTable(
  'books',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    author: text('author'),
    originalFilename: text('original_filename').notNull(),
    mediaType: text('media_type').notNull(),
    storageKey: text('storage_key').notNull(),
    textStorageKey: text('text_storage_key').notNull(),
    sourceUrl: text('source_url'),
    rightsBasis: text('rights_basis').notNull(),
    rightsNote: text('rights_note'),
    sha256: text('sha256').notNull(),
    characterCount: integer('character_count').notNull(),
    chapterCount: integer('chapter_count').notNull().default(0),
    status: text('status').notNull().default('ready'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_books_created_at').on(table.createdAt),
    index('idx_books_sha256').on(table.sha256),
  ],
);

export const analysisRuns = sqliteTable(
  'analysis_runs',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    goal: text('goal').notNull(),
    status: text('status').notNull(),
    chapterMapJson: text('chapter_map_json'),
    createdAt: integer('created_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [
    index('idx_analysis_runs_book_created').on(table.bookId, table.createdAt),
  ],
);

export const evidenceSpans = sqliteTable(
  'evidence_spans',
  {
    id: text('id').primaryKey(),
    analysisRunId: text('analysis_run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    chapterLabel: text('chapter_label').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    excerpt: text('excerpt').notNull(),
    score: integer('score').notNull(),
    reasonsJson: text('reasons_json').notNull(),
  },
  (table) => [
    index('idx_evidence_run_score').on(table.analysisRunId, table.score),
  ],
);

export const memoryItems = sqliteTable(
  'memory_items',
  {
    id: text('id').primaryKey(),
    analysisRunId: text('analysis_run_id').references(() => analysisRuns.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('candidate'),
    title: text('title').notNull(),
    contentJson: text('content_json').notNull(),
    confidence: integer('confidence').notNull(),
    evidenceIdsJson: text('evidence_ids_json').notNull(),
    useCount: integer('use_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_memory_status_kind').on(table.status, table.kind),
    index('idx_memory_analysis_run').on(table.analysisRunId),
  ],
);

export const storyProjects = sqliteTable('story_projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  premise: text('premise').notNull(),
  storyBibleJson: text('story_bible_json').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => storyProjects.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    title: text('title').notNull(),
    outline: text('outline').notNull(),
    content: text('content').notNull(),
    promptSnapshotJson: text('prompt_snapshot_json').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_chapters_project_sequence').on(table.projectId, table.sequence),
  ],
);

export const continuityItems = sqliteTable(
  'continuity_items',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => storyProjects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    currentState: text('current_state').notNull(),
    changeRule: text('change_rule'),
    status: text('status').notNull().default('active'),
    importance: text('importance').notNull().default('major'),
    introducedSequence: integer('introduced_sequence').notNull().default(0),
    targetSequence: integer('target_sequence'),
    resolvedSequence: integer('resolved_sequence'),
    lastTouchedSequence: integer('last_touched_sequence').notNull().default(0),
    mentionCount: integer('mention_count').notNull().default(0),
    keywordsJson: text('keywords_json').notNull().default('[]'),
    evolutionJson: text('evolution_json').notNull().default('[]'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_continuity_project_status_kind').on(
      table.projectId,
      table.status,
      table.kind,
    ),
    index('idx_continuity_project_target').on(
      table.projectId,
      table.targetSequence,
    ),
  ],
);

export const continuityEvents = sqliteTable(
  'continuity_events',
  {
    id: text('id').primaryKey(),
    continuityItemId: text('continuity_item_id')
      .notNull()
      .references(() => continuityItems.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').references(() => chapters.id, {
      onDelete: 'set null',
    }),
    sequence: integer('sequence').notNull(),
    action: text('action').notNull(),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_continuity_events_item_sequence').on(
      table.continuityItemId,
      table.sequence,
    ),
    index('idx_continuity_events_chapter').on(table.chapterId),
  ],
);

export const reviewFindings = sqliteTable(
  'review_findings',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    reviewType: text('review_type').notNull(),
    dimension: text('dimension').notNull(),
    severity: text('severity').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    message: text('message').notNull(),
    suggestion: text('suggestion').notNull(),
    memoryCandidateJson: text('memory_candidate_json'),
    status: text('status').notNull().default('open'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_review_chapter_status').on(table.chapterId, table.status),
  ],
);

export const memoryEvents = sqliteTable(
  'memory_events',
  {
    id: text('id').primaryKey(),
    memoryItemId: text('memory_item_id')
      .notNull()
      .references(() => memoryItems.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_memory_events_item_created').on(
      table.memoryItemId,
      table.createdAt,
    ),
  ],
);
