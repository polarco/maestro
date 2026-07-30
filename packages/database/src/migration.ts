export const INITIAL_MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_last_opened_idx ON projects(last_opened_at);

CREATE TABLE IF NOT EXISTS workspace_roots (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  writable INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_roots_project_path_uidx ON workspace_roots(project_id, canonical_path);
CREATE INDEX IF NOT EXISTS workspace_roots_project_idx ON workspace_roots(project_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  session_kind TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  workspace_root_id TEXT REFERENCES workspace_roots(id) ON DELETE SET NULL,
  provider_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_project_updated_idx ON conversations(project_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  attachments TEXT NOT NULL,
  provider_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  state TEXT NOT NULL,
  spec TEXT NOT NULL,
  current_plan_version INTEGER,
  integration_branch TEXT,
  integration_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_project_state_idx ON runs(project_id, state);
CREATE INDEX IF NOT EXISTS runs_conversation_created_idx ON runs(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  summary TEXT NOT NULL,
  markdown TEXT NOT NULL,
  spec TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS plans_run_version_uidx ON plans(run_id, version);
CREATE INDEX IF NOT EXISTS plans_run_idx ON plans(run_id);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  spec TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  provider_session_id TEXT,
  branch TEXT,
  worktree_path TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS task_runs_run_task_attempt_uidx ON task_runs(run_id, task_id, attempt);
CREATE INDEX IF NOT EXISTS task_runs_run_state_idx ON task_runs(run_id, state);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS run_events_run_sequence_uidx ON run_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS run_events_occurred_idx ON run_events(occurred_at);

CREATE TRIGGER IF NOT EXISTS run_events_no_update
BEFORE UPDATE ON run_events BEGIN
  SELECT RAISE(ABORT, 'run_events is append-only');
END;
CREATE TRIGGER IF NOT EXISTS run_events_no_delete
BEFORE DELETE ON run_events BEGIN
  SELECT RAISE(ABORT, 'run_events is append-only');
END;

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  scope TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_configs (
  provider_id TEXT PRIMARY KEY NOT NULL,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY NOT NULL,
  backend TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  salt TEXT,
  iv TEXT,
  tag TEXT,
  updated_at TEXT NOT NULL
);
`;

export const MULTI_ACCOUNT_MIGRATION = `
ALTER TABLE conversations ADD COLUMN provider_connection_id TEXT;

CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  billing_mode TEXT NOT NULL CHECK (billing_mode = 'subscription'),
  enabled INTEGER NOT NULL,
  is_default INTEGER NOT NULL,
  state_directory TEXT,
  priority INTEGER NOT NULL,
  concurrency_limit INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX provider_connections_provider_idx
  ON provider_connections(provider_id, enabled, priority);
CREATE UNIQUE INDEX provider_connections_default_uidx
  ON provider_connections(provider_id) WHERE is_default = 1;
`;

export const MULTIMODAL_CONTEXT_MIGRATION = `
CREATE TABLE context_assets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_root_id TEXT REFERENCES workspace_roots(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  change_state TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  relative_path TEXT,
  source_path TEXT,
  managed_path TEXT,
  thumbnail_path TEXT,
  content_hash TEXT,
  current_hash TEXT,
  source_modified_at TEXT,
  duration_ms INTEGER,
  page_count INTEGER,
  extracted_text TEXT,
  transcription TEXT,
  frame_paths TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  warning TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX context_assets_conversation_idx
  ON context_assets(conversation_id, created_at);
CREATE INDEX context_assets_project_source_idx
  ON context_assets(project_id, source, workspace_root_id);
CREATE INDEX context_assets_hash_idx
  ON context_assets(conversation_id, content_hash);

CREATE TABLE message_context_assets (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES context_assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(message_id, asset_id)
);
CREATE UNIQUE INDEX message_context_assets_order_uidx
  ON message_context_assets(message_id, ordinal);
CREATE INDEX message_context_assets_asset_idx
  ON message_context_assets(asset_id);

CREATE TABLE context_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES context_assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX context_chunks_asset_order_uidx
  ON context_chunks(asset_id, ordinal);

CREATE VIRTUAL TABLE context_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  asset_id UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER context_chunks_fts_insert AFTER INSERT ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(chunk_id, asset_id, content)
  VALUES (new.id, new.asset_id, new.content);
END;
CREATE TRIGGER context_chunks_fts_update AFTER UPDATE OF content ON context_chunks BEGIN
  DELETE FROM context_chunks_fts WHERE chunk_id = old.id;
  INSERT INTO context_chunks_fts(chunk_id, asset_id, content)
  VALUES (new.id, new.asset_id, new.content);
END;
CREATE TRIGGER context_chunks_fts_delete AFTER DELETE ON context_chunks BEGIN
  DELETE FROM context_chunks_fts WHERE chunk_id = old.id;
END;
`;
