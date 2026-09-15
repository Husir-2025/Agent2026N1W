const statements = [
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT,
    original_filename TEXT NOT NULL, media_type TEXT NOT NULL,
    storage_key TEXT NOT NULL, text_storage_key TEXT NOT NULL,
    source_url TEXT, rights_basis TEXT NOT NULL, rights_note TEXT,
    sha256 TEXT NOT NULL, character_count INTEGER NOT NULL,
    chapter_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    goal TEXT NOT NULL, status TEXT NOT NULL, chapter_map_json TEXT,
    created_at INTEGER NOT NULL, completed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_spans (
    id TEXT PRIMARY KEY, analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    chapter_label TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
    excerpt TEXT NOT NULL, score INTEGER NOT NULL, reasons_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY, analysis_run_id TEXT REFERENCES analysis_runs(id) ON DELETE SET NULL,
    kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'candidate', title TEXT NOT NULL,
    content_json TEXT NOT NULL, confidence INTEGER NOT NULL, evidence_ids_json TEXT NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS story_projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, premise TEXT NOT NULL,
    story_bible_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, title TEXT NOT NULL, outline TEXT NOT NULL,
    content TEXT NOT NULL, prompt_snapshot_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS continuity_items (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    current_state TEXT NOT NULL, change_rule TEXT,
    status TEXT NOT NULL DEFAULT 'active', importance TEXT NOT NULL DEFAULT 'major',
    introduced_sequence INTEGER NOT NULL DEFAULT 0, target_sequence INTEGER,
    resolved_sequence INTEGER, last_touched_sequence INTEGER NOT NULL DEFAULT 0,
    mention_count INTEGER NOT NULL DEFAULT 0, keywords_json TEXT NOT NULL DEFAULT '[]',
    evolution_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS continuity_events (
    id TEXT PRIMARY KEY, continuity_item_id TEXT NOT NULL REFERENCES continuity_items(id) ON DELETE CASCADE,
    chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
    sequence INTEGER NOT NULL, action TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS review_findings (
    id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    review_type TEXT NOT NULL, dimension TEXT NOT NULL, severity TEXT NOT NULL,
    start_offset INTEGER, end_offset INTEGER, message TEXT NOT NULL,
    suggestion TEXT NOT NULL, memory_candidate_json TEXT,
    status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_events (
    id TEXT PRIMARY KEY, memory_item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    action TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL
  )`,
  // ---- 头号写手 v2：灵感库（写作素材库） ----
  `CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT '情节点',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 3,
    person_tag TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    placement TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    used_in_sequence INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  // ---- 头号写手 v2：章节摘要（双记忆：近期章节详细摘要） ----
  `CREATE TABLE IF NOT EXISTS chapter_summaries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, title TEXT NOT NULL,
    summary TEXT NOT NULL, key_facts_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(chapter_id)
  )`,
  // ---- 头号写手 v2：用户偏好记忆 ----
  `CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // ---- 头号写手 v2：卷→章分层 ----
  `CREATE TABLE IF NOT EXISTS volumes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
    volume_no INTEGER NOT NULL, title TEXT NOT NULL,
    strategy TEXT NOT NULL, pacing TEXT,
    start_sequence INTEGER NOT NULL, end_sequence INTEGER NOT NULL,
    climax_sequence INTEGER, chapter_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_books_sha256 ON books(sha256)',
  'CREATE INDEX IF NOT EXISTS idx_analysis_runs_book_created ON analysis_runs(book_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_evidence_run_score ON evidence_spans(analysis_run_id, score)',
  'CREATE INDEX IF NOT EXISTS idx_memory_status_kind ON memory_items(status, kind)',
  'CREATE INDEX IF NOT EXISTS idx_memory_analysis_run ON memory_items(analysis_run_id)',
  'CREATE INDEX IF NOT EXISTS idx_chapters_project_sequence ON chapters(project_id, sequence)',
  'CREATE INDEX IF NOT EXISTS idx_continuity_project_status_kind ON continuity_items(project_id, status, kind)',
  'CREATE INDEX IF NOT EXISTS idx_continuity_project_target ON continuity_items(project_id, target_sequence)',
  'CREATE INDEX IF NOT EXISTS idx_continuity_events_item_sequence ON continuity_events(continuity_item_id, sequence)',
  'CREATE INDEX IF NOT EXISTS idx_continuity_events_chapter ON continuity_events(chapter_id)',
  'CREATE INDEX IF NOT EXISTS idx_review_chapter_status ON review_findings(chapter_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_memory_events_item_created ON memory_events(memory_item_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_ideas_status_priority ON ideas(status, priority)',
  'CREATE INDEX IF NOT EXISTS idx_chapter_summaries_project_sequence ON chapter_summaries(project_id, sequence)',
  'CREATE INDEX IF NOT EXISTS idx_volumes_project_no ON volumes(project_id, volume_no)',
];

let initialized = false;

export async function ensureSchema(db: D1Database) {
  if (initialized) return;
  await db.batch(statements.map((statement) => db.prepare(statement)));
  await db.prepare('PRAGMA optimize').run();
  initialized = true;
}
