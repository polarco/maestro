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

/** Additive runtime state for adaptive Maestro turns. Existing runs/messages stay authoritative. */
export const AGENT_RUNTIME_MIGRATION = `
CREATE TABLE turns (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL,
  state TEXT NOT NULL,
  intent TEXT NOT NULL,
  policy TEXT NOT NULL,
  model_preference TEXT NOT NULL,
  selected_model TEXT,
  input_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  output_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);
CREATE UNIQUE INDEX turns_conversation_sequence_uidx
  ON turns(conversation_id, sequence);
CREATE INDEX turns_run_state_idx ON turns(run_id, state);

CREATE TABLE turn_items (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX turn_items_turn_sequence_uidx ON turn_items(turn_id, sequence);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL,
  mutability TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  checkpoint_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX tool_calls_idempotency_uidx ON tool_calls(idempotency_key);
CREATE INDEX tool_calls_turn_status_idx ON tool_calls(turn_id, status);

CREATE TABLE tool_results (
  id TEXT PRIMARY KEY NOT NULL,
  tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
  output TEXT,
  is_error INTEGER NOT NULL,
  error TEXT,
  artifact_ref TEXT,
  truncated INTEGER NOT NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tool_results_call_uidx ON tool_results(tool_call_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  plan_version INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
);
CREATE INDEX approvals_run_status_idx ON approvals(run_id, status);

CREATE TABLE context_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  checkpoint TEXT NOT NULL,
  safe_to_resume INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX checkpoints_turn_version_uidx
  ON context_checkpoints(turn_id, version);
CREATE INDEX checkpoints_conversation_created_idx
  ON context_checkpoints(conversation_id, created_at);

CREATE TABLE routing_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  connection_id TEXT,
  model_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX routing_decisions_run_created_idx ON routing_decisions(run_id, created_at);

CREATE TABLE model_telemetry (
  key TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  connection_id TEXT,
  model_id TEXT NOT NULL,
  successes INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  latency_ewma_ms REAL,
  quota_remaining REAL,
  quota_limit REAL,
  active_sessions INTEGER NOT NULL,
  concurrency_limit INTEGER,
  cooldown_until TEXT,
  circuit_state TEXT NOT NULL,
  cached_input_tokens INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX model_telemetry_selection_uidx
  ON model_telemetry(provider_id, IFNULL(connection_id, ''), model_id);

CREATE TABLE recovery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  attempt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX recovery_attempts_turn_idx ON recovery_attempts(turn_id, created_at);

CREATE TABLE tool_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX tool_artifacts_call_idx ON tool_artifacts(tool_call_id);

CREATE TABLE pending_model_switches (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  selection TEXT NOT NULL,
  timing TEXT NOT NULL,
  no_fallback INTEGER NOT NULL,
  requested_at TEXT NOT NULL
);
`;

/** Maestro Next session graph and local-first Studio. Strictly additive. */
export const MAESTRO_NEXT_MIGRATION = `
ALTER TABLE conversations ADD COLUMN active_branch_id TEXT;
ALTER TABLE messages ADD COLUMN branch_id TEXT;
ALTER TABLE runs ADD COLUMN branch_id TEXT;
ALTER TABLE turns ADD COLUMN branch_id TEXT;
ALTER TABLE run_events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE session_branches (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_branch_id TEXT,
  forked_from_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_root INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX session_branches_session_idx ON session_branches(session_id, created_at);
CREATE INDEX session_branches_parent_idx ON session_branches(parent_branch_id);
CREATE UNIQUE INDEX session_branches_one_root_uidx
  ON session_branches(session_id) WHERE is_root = 1;

CREATE TRIGGER session_branches_create_root AFTER INSERT ON conversations BEGIN
  INSERT INTO session_branches(
    id, session_id, parent_branch_id, forked_from_turn_id, name, is_root, created_at, updated_at
  ) VALUES ('root-' || new.id, new.id, NULL, NULL, 'Principal', 1, new.created_at, new.updated_at);
  UPDATE conversations SET active_branch_id = 'root-' || new.id WHERE id = new.id;
END;

INSERT INTO session_branches(
  id, session_id, parent_branch_id, forked_from_turn_id, name, is_root, created_at, updated_at
)
SELECT 'root-' || id, id, NULL, NULL, 'Principal', 1, created_at, updated_at
FROM conversations;
UPDATE conversations SET active_branch_id = 'root-' || id WHERE active_branch_id IS NULL;
UPDATE messages SET branch_id = 'root-' || conversation_id WHERE branch_id IS NULL;
UPDATE runs SET branch_id = 'root-' || conversation_id WHERE branch_id IS NULL;
UPDATE turns SET branch_id = 'root-' || conversation_id WHERE branch_id IS NULL;

CREATE INDEX messages_conversation_branch_created_idx
  ON messages(conversation_id, branch_id, created_at);
CREATE INDEX runs_conversation_branch_created_idx
  ON runs(conversation_id, branch_id, created_at);
CREATE INDEX turns_conversation_branch_sequence_idx
  ON turns(conversation_id, branch_id, sequence);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  branch_id TEXT,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT,
  mime_type TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX artifacts_project_updated_idx ON artifacts(project_id, updated_at);
CREATE INDEX artifacts_session_updated_idx ON artifacts(session_id, updated_at);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_event_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX artifact_versions_artifact_version_uidx
  ON artifact_versions(artifact_id, version);

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX source_snapshots_project_accessed_idx
  ON source_snapshots(project_id, accessed_at);

CREATE TABLE citations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  branch_id TEXT,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE CASCADE,
  response_start INTEGER,
  response_end INTEGER,
  quote TEXT,
  created_at TEXT NOT NULL,
  CHECK(response_start IS NULL OR response_end IS NULL OR response_end >= response_start)
);
CREATE INDEX citations_session_message_idx ON citations(session_id, message_id);

CREATE TABLE memory_records (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  provenance TEXT NOT NULL,
  confidence REAL NOT NULL,
  state TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(scope <> 'project' OR project_id IS NOT NULL),
  CHECK(confidence >= 0 AND confidence <= 1)
);
CREATE INDEX memory_records_project_state_idx ON memory_records(project_id, state);

CREATE TABLE connectors (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX connectors_project_idx ON connectors(project_id, enabled);

CREATE TABLE connector_grants (
  id TEXT PRIMARY KEY NOT NULL,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '{}',
  granted INTEGER NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX connector_grants_connector_idx ON connector_grants(connector_id, granted);

CREATE TABLE connector_invocations (
  id TEXT PRIMARY KEY NOT NULL,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  mutability TEXT NOT NULL,
  status TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  output_summary TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX connector_invocations_connector_started_idx
  ON connector_invocations(connector_id, started_at);

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  branch_id TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  parent_job_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  progress REAL,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX background_jobs_project_state_idx ON background_jobs(project_id, state);

INSERT INTO background_jobs(
  id, project_id, session_id, branch_id, run_id, parent_job_id, title, kind, state,
  progress, cost_usd, input_tokens, output_tokens, detail, created_at, updated_at, finished_at
)
SELECT
  'run-' || id, project_id, conversation_id, branch_id, id, NULL,
  'Execução ' || substr(id, 1, 8), 'run',
  CASE
    WHEN state IN ('completed') THEN 'completed'
    WHEN state IN ('failed') THEN 'failed'
    WHEN state IN ('canceled') THEN 'canceled'
    WHEN state IN ('awaiting_clarification', 'awaiting_approval') THEN 'blocked'
    WHEN state IN ('queued') THEN 'queued'
    ELSE 'running'
  END,
  CASE WHEN state = 'completed' THEN 1.0 ELSE NULL END,
  0, 0, 0, '{}', created_at, updated_at, finished_at
FROM runs;

CREATE TABLE autonomy_profiles (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  allowed_paths TEXT NOT NULL DEFAULT '[]',
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  allowed_commands TEXT NOT NULL DEFAULT '[]',
  network TEXT NOT NULL DEFAULT 'denied',
  max_cost_usd REAL,
  max_tokens INTEGER,
  updated_at TEXT NOT NULL
);
INSERT INTO autonomy_profiles(
  project_id, level, allowed_paths, allowed_tools, allowed_commands, network,
  max_cost_usd, max_tokens, updated_at
)
SELECT id, 'review', '[]', '[]', '[]', 'denied', NULL, NULL, updated_at FROM projects;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX audit_events_project_occurred_idx ON audit_events(project_id, occurred_at);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE VIRTUAL TABLE global_search_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  project_id UNINDEXED,
  session_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
SELECT 'conversation', id, project_id, id, title, '' FROM conversations;
INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
SELECT 'message', messages.id, conversations.project_id, messages.conversation_id,
       conversations.title, messages.content
FROM messages JOIN conversations ON conversations.id = messages.conversation_id;

CREATE TRIGGER global_search_conversation_insert AFTER INSERT ON conversations BEGIN
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  VALUES ('conversation', new.id, new.project_id, new.id, new.title, '');
END;
CREATE TRIGGER global_search_conversation_update AFTER UPDATE OF title ON conversations BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'conversation' AND entity_id = old.id;
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  VALUES ('conversation', new.id, new.project_id, new.id, new.title, '');
END;
CREATE TRIGGER global_search_conversation_delete AFTER DELETE ON conversations BEGIN
  DELETE FROM global_search_fts WHERE session_id = old.id;
END;
CREATE TRIGGER global_search_message_insert AFTER INSERT ON messages BEGIN
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  SELECT 'message', new.id, project_id, new.conversation_id, title, new.content
  FROM conversations WHERE id = new.conversation_id;
END;
CREATE TRIGGER global_search_message_update AFTER UPDATE OF content ON messages BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'message' AND entity_id = old.id;
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  SELECT 'message', new.id, project_id, new.conversation_id, title, new.content
  FROM conversations WHERE id = new.conversation_id;
END;
CREATE TRIGGER global_search_message_delete AFTER DELETE ON messages BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'message' AND entity_id = old.id;
END;
CREATE TRIGGER global_search_artifact_version_insert AFTER INSERT ON artifact_versions BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'artifact' AND entity_id = new.artifact_id;
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  SELECT 'artifact', artifacts.id, artifacts.project_id, artifacts.session_id,
         artifacts.title, new.content
  FROM artifacts WHERE artifacts.id = new.artifact_id;
END;
CREATE TRIGGER global_search_artifact_delete AFTER DELETE ON artifacts BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'artifact' AND entity_id = old.id;
END;
CREATE TRIGGER global_search_memory_insert AFTER INSERT ON memory_records BEGIN
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  VALUES ('memory', new.id, IFNULL(new.project_id, ''), NULL, new.kind, new.content);
END;
CREATE TRIGGER global_search_memory_update AFTER UPDATE OF content, state ON memory_records BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'memory' AND entity_id = old.id;
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  SELECT 'memory', new.id, IFNULL(new.project_id, ''), NULL, new.kind, new.content
  WHERE new.state NOT IN ('forgotten', 'rejected');
END;
CREATE TRIGGER global_search_memory_delete AFTER DELETE ON memory_records BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'memory' AND entity_id = old.id;
END;
CREATE TRIGGER global_search_source_insert AFTER INSERT ON source_snapshots BEGIN
  INSERT INTO global_search_fts(entity_type, entity_id, project_id, session_id, title, content)
  VALUES ('source', new.id, new.project_id, NULL, new.title, new.excerpt);
END;
CREATE TRIGGER global_search_source_delete AFTER DELETE ON source_snapshots BEGIN
  DELETE FROM global_search_fts WHERE entity_type = 'source' AND entity_id = old.id;
END;
`;
