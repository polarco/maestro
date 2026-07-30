-- Kept in sync with MULTIMODAL_CONTEXT_MIGRATION in src/migration.ts.
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
CREATE INDEX context_assets_conversation_idx ON context_assets(conversation_id, created_at);
CREATE INDEX context_assets_project_source_idx ON context_assets(project_id, source, workspace_root_id);
CREATE INDEX context_assets_hash_idx ON context_assets(conversation_id, content_hash);

CREATE TABLE message_context_assets (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES context_assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(message_id, asset_id)
);
CREATE UNIQUE INDEX message_context_assets_order_uidx ON message_context_assets(message_id, ordinal);
CREATE INDEX message_context_assets_asset_idx ON message_context_assets(asset_id);

CREATE TABLE context_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES context_assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX context_chunks_asset_order_uidx ON context_chunks(asset_id, ordinal);
CREATE VIRTUAL TABLE context_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  asset_id UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER context_chunks_fts_insert AFTER INSERT ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(chunk_id, asset_id, content) VALUES (new.id, new.asset_id, new.content);
END;
CREATE TRIGGER context_chunks_fts_update AFTER UPDATE OF content ON context_chunks BEGIN
  DELETE FROM context_chunks_fts WHERE chunk_id = old.id;
  INSERT INTO context_chunks_fts(chunk_id, asset_id, content) VALUES (new.id, new.asset_id, new.content);
END;
CREATE TRIGGER context_chunks_fts_delete AFTER DELETE ON context_chunks BEGIN
  DELETE FROM context_chunks_fts WHERE chunk_id = old.id;
END;
