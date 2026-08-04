import path from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq, exists, inArray, isNotNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ulid } from "ulid";
import {
  DEFAULT_APP_SETTINGS,
  artifactSchema,
  artifactVersionSchema,
  autonomyProfileSchema,
  backgroundJobSchema,
  connectorGrantSchema,
  connectorInvocationSchema,
  connectorSchema,
  citationSchema,
  memoryRecordSchema,
  sessionBranchSchema,
  sourceSnapshotSchema,
  appSettingsSchema,
  contextCheckpointSchema,
  executionPolicySchema,
  planSpecSchema,
  runSpecSchema,
  toolCallSchema,
  toolResultSchema,
  turnSchema,
  type AppSettings,
  type Artifact,
  type ArtifactDetail,
  type AutonomyLevel,
  type AutonomyProfile,
  type BackgroundJob,
  type Connector,
  type ConnectorGrant,
  type ConnectorInvocation,
  type Citation,
  type CreateArtifactInput,
  type Attachment,
  type ContextAssetSummary,
  type ContextCheckpoint,
  type Conversation,
  type EventPage,
  type GlobalSearchResult,
  type Message,
  type MessageRole,
  type MessageStatus,
  type MemoryFilter,
  type MemoryRecord,
  type ModelSelection,
  type ModelTelemetry,
  type NewRunEvent,
  type PlanSpec,
  type Project,
  type ProviderConnection,
  type RecoveryAttempt,
  type RoutingDecision,
  type Run,
  type RunDetail,
  type RunEvent,
  type RunMode,
  type RunSpec,
  type RunState,
  type SaveMemoryInput,
  type SessionKind,
  type SessionBranch,
  type SessionTimelinePage,
  type SourceSnapshot,
  type TaskRun,
  type TaskSpec,
  type ToolCall,
  type ToolResult,
  type Turn,
  type TurnItem,
  type TurnState,
  type TimelineItem,
  type UpdateArtifactInput,
  type UpdateMemoryInput,
  type ExecutionPolicy,
  type WorkspaceRoot,
} from "@maestro/contracts";
import { assertRunTransition, extractMemoryCandidates, MaestroError } from "@maestro/core";
import {
  AGENT_RUNTIME_MIGRATION,
  INITIAL_MIGRATION,
  MAESTRO_NEXT_MIGRATION,
  MULTI_ACCOUNT_MIGRATION,
  MULTIMODAL_CONTEXT_MIGRATION,
} from "./migration.js";
import {
  appMetadata,
  approvals,
  artifacts,
  artifactVersions,
  auditEvents,
  autonomyProfiles,
  backgroundJobs,
  citations,
  connectorGrants,
  connectorInvocations,
  connectors,
  conversations,
  contextAssets,
  contextCheckpoints,
  messages,
  memoryRecords,
  messageContextAssets,
  modelTelemetry,
  pendingModelSwitches,
  plans,
  projects,
  providerConfigs,
  providerConnections,
  recoveryAttempts,
  routingDecisions,
  runs,
  schema,
  secrets,
  settings,
  sessionBranches,
  sourceSnapshots,
  taskRuns,
  toolCalls,
  toolArtifacts,
  toolResults,
  turnItems,
  turns,
  workspaceRoots,
} from "./schema.js";

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function configContainsSecret(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => configContainsSecret(item, seen));
  return Object.entries(value).some(
    ([key, entry]) =>
      /token|secret|password|authorization|bearer|api.?key|private.?key/i.test(key) ||
      configContainsSecret(entry, seen),
  );
}

function jobStateForRun(state: RunState): BackgroundJob["state"] {
  if (state === "completed" || state === "failed" || state === "canceled") return state;
  if (state === "awaiting_clarification" || state === "awaiting_approval") return "blocked";
  if (state === "queued") return "queued";
  return "running";
}

export interface SecretRecord {
  key: string;
  backend: "safe-storage" | "password-vault";
  encrypted: string;
  salt: string | null;
  iv: string | null;
  tag: string | null;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  turnId: string | null;
  planVersion: number | null;
  kind: "plan" | "command" | "file" | "tool" | "network";
  status: "pending" | "approved" | "denied" | "superseded";
  scope: ExecutionPolicy;
  scopeHash: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface PendingModelSwitchRecord {
  runId: string;
  selection: ModelSelection;
  timing: "next_checkpoint" | "immediate";
  noFallback: boolean;
  requestedAt: string;
}

interface ConversationInput {
  projectId: string;
  title: string;
  mode: RunMode;
  sessionKind: SessionKind;
  providerId?: string | null;
  providerConnectionId?: string | null;
  modelId?: string | null;
  workspaceRootId: string;
}

export type ContextAssetRecord = typeof contextAssets.$inferSelect;

export interface ContextChunkRecord {
  id: string;
  assetId: string;
  ordinal: number;
  content: string;
  tokenCount: number;
  rank?: number;
}

function contextAssetSummary(record: ContextAssetRecord): ContextAssetSummary {
  const canPreview =
    record.status !== "missing" &&
    record.kind !== "folder" &&
    Boolean(record.managedPath ?? record.sourcePath);
  return {
    id: record.id,
    projectId: record.projectId,
    conversationId: record.conversationId,
    source: record.source,
    kind: record.kind,
    status: record.status,
    changeState: record.changeState,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    workspaceRootId: record.workspaceRootId,
    relativePath: record.relativePath,
    contentHash: record.contentHash,
    sourceModifiedAt: record.sourceModifiedAt,
    durationMs: record.durationMs,
    pageCount: record.pageCount,
    previewUrl: canPreview
      ? `maestro-attachment://asset/${record.conversationId}/${record.id}`
      : null,
    thumbnailUrl: record.thumbnailPath
      ? `maestro-attachment://asset/${record.conversationId}/${record.id}?thumbnail=1`
      : null,
    requiresVision: record.kind === "image" || record.metadata.scannedPdf === true,
    extractedTextAvailable: Boolean(record.extractedText),
    transcription: record.transcription,
    warning: record.warning,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class MaestroRepository {
  readonly sqlite: BetterSqlite3.Database;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  readonly migrationBackupPath: string | null;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.sqlite = new BetterSqlite3(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    if (filename !== ":memory:") this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = NORMAL");
    this.sqlite.exec(INITIAL_MIGRATION);
    const appliedBeforeUpgrade = this.sqlite
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    this.migrationBackupPath =
      filename !== ":memory:" &&
      appliedBeforeUpgrade.length > 0 &&
      !appliedBeforeUpgrade.some((row) => row.version === 5)
        ? `${filename}.pre-v5-${Date.now()}.bak`
        : null;
    if (this.migrationBackupPath) {
      const escaped = this.migrationBackupPath.replaceAll("'", "''");
      // VACUUM INTO produces a transactionally consistent snapshot, including WAL state.
      this.sqlite.exec(`VACUUM INTO '${escaped}'`);
    }
    this.sqlite
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(1, now());
    const migration2 = this.sqlite
      .prepare("SELECT version FROM schema_migrations WHERE version = 2")
      .get();
    if (!migration2) {
      this.sqlite.transaction(() => {
        this.sqlite.exec(MULTI_ACCOUNT_MIGRATION);
        this.sqlite
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(2, now());
      })();
    }
    const migration3 = this.sqlite
      .prepare("SELECT version FROM schema_migrations WHERE version = 3")
      .get();
    if (!migration3) {
      this.sqlite.transaction(() => {
        this.sqlite.exec(MULTIMODAL_CONTEXT_MIGRATION);
        this.sqlite
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(3, now());
      })();
    }
    const migration4 = this.sqlite
      .prepare("SELECT version FROM schema_migrations WHERE version = 4")
      .get();
    if (!migration4) {
      this.sqlite.transaction(() => {
        this.sqlite.exec(AGENT_RUNTIME_MIGRATION);
        this.sqlite
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(4, now());
      })();
    }
    const migration5 = this.sqlite
      .prepare("SELECT version FROM schema_migrations WHERE version = 5")
      .get();
    if (!migration5) {
      this.sqlite.transaction(() => {
        this.sqlite.exec(MAESTRO_NEXT_MIGRATION);
        this.sqlite
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(5, now());
      })();
    }
    this.db = drizzle(this.sqlite, { schema });
  }

  close(): void {
    this.sqlite.close();
  }

  async createProject(input: {
    name: string;
    path: string;
    canonicalPath: string;
    displayName: string;
  }): Promise<Project> {
    const timestamp = now();
    const projectId = ulid();
    const rootId = ulid();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          "INSERT INTO projects(id, name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(projectId, input.name, timestamp, timestamp, timestamp);
      this.sqlite
        .prepare(
          "INSERT INTO workspace_roots(id, project_id, path, canonical_path, display_name, writable, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
        )
        .run(rootId, projectId, input.path, input.canonicalPath, input.displayName, timestamp);
      this.sqlite
        .prepare(
          "INSERT INTO app_metadata(key, value, updated_at) VALUES ('active_project_id', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        )
        .run(projectId, timestamp);
    })();
    return this.getProject(projectId);
  }

  async addWorkspaceRoot(
    projectId: string,
    input: {
      path: string;
      canonicalPath: string;
      displayName: string;
      writable?: boolean;
    },
  ): Promise<Project> {
    await this.requireProject(projectId);
    await this.db
      .insert(workspaceRoots)
      .values({
        id: ulid(),
        projectId,
        path: input.path,
        canonicalPath: input.canonicalPath,
        displayName: input.displayName,
        writable: input.writable ?? true,
        createdAt: now(),
      })
      .onConflictDoNothing();
    return this.getProject(projectId);
  }

  async updateProject(projectId: string, name: string): Promise<Project> {
    await this.requireProject(projectId);
    await this.db
      .update(projects)
      .set({ name, updatedAt: now() })
      .where(eq(projects.id, projectId));
    return this.getProject(projectId);
  }

  async removeWorkspaceRoot(projectId: string, rootId: string): Promise<Project> {
    const project = await this.getProject(projectId);
    const root = project.roots.find((candidate) => candidate.id === rootId);
    if (!root)
      throw new MaestroError(
        "WORKSPACE_PROJECT_MISMATCH",
        "A raiz não pertence ao projeto selecionado.",
      );
    if (project.roots.length <= 1)
      throw new MaestroError(
        "PROJECT_REQUIRES_ROOT",
        "Um projeto precisa manter pelo menos uma pasta autorizada.",
        { recoverable: true },
      );
    await this.db.delete(workspaceRoots).where(eq(workspaceRoots.id, rootId));
    await this.db.update(projects).set({ updatedAt: now() }).where(eq(projects.id, projectId));
    return this.getProject(projectId);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.requireProject(projectId);
    this.deleteWithRunEventCascade("projects", projectId);
    await this.db
      .delete(appMetadata)
      .where(and(eq(appMetadata.key, "active_project_id"), eq(appMetadata.value, projectId)));
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.db.select().from(projects).orderBy(desc(projects.lastOpenedAt));
    if (rows.length === 0) return [];
    const roots = await this.db
      .select()
      .from(workspaceRoots)
      .where(
        inArray(
          workspaceRoots.projectId,
          rows.map((row) => row.id),
        ),
      );
    return rows.map((row) => ({
      ...row,
      roots: roots.filter((root) => root.projectId === row.id),
    }));
  }

  async getProject(projectId: string): Promise<Project> {
    const row = await this.requireProject(projectId);
    const roots = await this.db
      .select()
      .from(workspaceRoots)
      .where(eq(workspaceRoots.projectId, projectId));
    return { ...row, roots };
  }

  private async requireProject(projectId: string) {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!row) throw new MaestroError("PROJECT_NOT_FOUND", "Projeto não encontrado.");
    return row;
  }

  async getWorkspaceRoot(rootId: string): Promise<WorkspaceRoot> {
    const [root] = await this.db
      .select()
      .from(workspaceRoots)
      .where(eq(workspaceRoots.id, rootId))
      .limit(1);
    if (!root)
      throw new MaestroError("WORKSPACE_ROOT_NOT_FOUND", "Raiz de workspace não encontrada.");
    return root;
  }

  async selectProject(projectId: string): Promise<void> {
    await this.requireProject(projectId);
    const timestamp = now();
    await this.db
      .update(projects)
      .set({ lastOpenedAt: timestamp, updatedAt: timestamp })
      .where(eq(projects.id, projectId));
    await this.db
      .insert(appMetadata)
      .values({ key: "active_project_id", value: projectId, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: appMetadata.key,
        set: { value: projectId, updatedAt: timestamp },
      });
  }

  async getActiveProjectId(): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(appMetadata)
      .where(eq(appMetadata.key, "active_project_id"))
      .limit(1);
    return row?.value ?? null;
  }

  async createConversation(input: ConversationInput): Promise<Conversation> {
    const root = await this.getWorkspaceRoot(input.workspaceRootId);
    if (root.projectId !== input.projectId)
      throw new MaestroError("WORKSPACE_PROJECT_MISMATCH", "A raiz não pertence ao projeto.");
    const timestamp = now();
    const row: Conversation = {
      id: ulid(),
      projectId: input.projectId,
      title: input.title,
      mode: input.mode,
      sessionKind: input.sessionKind,
      providerId: input.providerId ?? null,
      providerConnectionId: input.providerConnectionId ?? null,
      modelId: input.modelId ?? null,
      workspaceRootId: input.workspaceRootId,
      providerSessionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(conversations).values(row);
    return this.getConversation(row.id);
  }

  async createConversationDraft(input: ConversationInput): Promise<Conversation> {
    const root = await this.getWorkspaceRoot(input.workspaceRootId);
    if (root.projectId !== input.projectId)
      throw new MaestroError("WORKSPACE_PROJECT_MISMATCH", "A raiz não pertence ao projeto.");

    const timestamp = now();
    const conversationId = this.sqlite.transaction(() => {
      const drafts = this.sqlite
        .prepare(
          `SELECT conversation.id
           FROM conversations AS conversation
           WHERE conversation.project_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM messages AS message
               WHERE message.conversation_id = conversation.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM runs AS run
               WHERE run.conversation_id = conversation.id
             )
           ORDER BY conversation.updated_at DESC, conversation.created_at DESC`,
        )
        .all(input.projectId) as Array<{ id: string }>;
      const reusable = drafts[0];

      if (reusable) {
        const removeDraft = this.sqlite.prepare("DELETE FROM conversations WHERE id = ?");
        for (const stale of drafts.slice(1)) removeDraft.run(stale.id);
        this.sqlite
          .prepare(
            `UPDATE conversations
             SET title = ?, mode = ?, session_kind = ?, provider_id = ?,
                 provider_connection_id = ?, model_id = ?, workspace_root_id = ?,
                 provider_session_id = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.title,
            input.mode,
            input.sessionKind,
            input.providerId ?? null,
            input.providerConnectionId ?? null,
            input.modelId ?? null,
            input.workspaceRootId,
            timestamp,
            reusable.id,
          );
        return reusable.id;
      }

      const id = ulid();
      this.sqlite
        .prepare(
          `INSERT INTO conversations (
             id, project_id, title, mode, session_kind, provider_id,
             provider_connection_id, model_id, workspace_root_id,
             provider_session_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.title,
          input.mode,
          input.sessionKind,
          input.providerId ?? null,
          input.providerConnectionId ?? null,
          input.modelId ?? null,
          input.workspaceRootId,
          timestamp,
          timestamp,
        );
      return id;
    })();

    return this.getConversation(conversationId);
  }

  pruneConversationDrafts(): number {
    return this.sqlite
      .prepare(
        `DELETE FROM conversations
         WHERE NOT EXISTS (
           SELECT 1 FROM messages AS message
           WHERE message.conversation_id = conversations.id
         )
           AND NOT EXISTS (
             SELECT 1 FROM runs AS run
             WHERE run.conversation_id = conversations.id
           )`,
      )
      .run().changes;
  }

  async updateConversation(
    conversationId: string,
    values: Partial<
      Pick<
        Conversation,
        | "title"
        | "mode"
        | "sessionKind"
        | "providerId"
        | "providerConnectionId"
        | "modelId"
        | "workspaceRootId"
        | "providerSessionId"
      >
    >,
  ): Promise<Conversation> {
    await this.db
      .update(conversations)
      .set({ ...values, updatedAt: now() })
      .where(eq(conversations.id, conversationId));
    return this.getConversation(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.getConversation(conversationId);
    this.deleteWithRunEventCascade("conversations", conversationId);
  }

  private deleteWithRunEventCascade(table: "projects" | "conversations", id: string): void {
    this.sqlite.transaction(() => {
      // Logs remain append-only during normal operation. A confirmed parent deletion
      // removes run events and lets SQLite detach the retained audit trail from the
      // deleted parent through its ON DELETE SET NULL foreign keys.
      this.sqlite.exec("DROP TRIGGER IF EXISTS run_events_no_delete");
      this.sqlite.exec("DROP TRIGGER IF EXISTS audit_events_no_update");
      this.sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      this.sqlite.exec(`
        CREATE TRIGGER run_events_no_delete
        BEFORE DELETE ON run_events BEGIN
          SELECT RAISE(ABORT, 'run_events is append-only');
        END;
        CREATE TRIGGER audit_events_no_update
        BEFORE UPDATE ON audit_events BEGIN
          SELECT RAISE(ABORT, 'audit_events is append-only');
        END;
      `);
    })();
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!row) throw new MaestroError("CONVERSATION_NOT_FOUND", "Conversa não encontrada.");
    return row;
  }

  async listConversations(projectId: string, limit = 100): Promise<Conversation[]> {
    const messagesForConversation = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conversations.id));
    return this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), exists(messagesForConversation)))
      .orderBy(desc(conversations.updatedAt))
      .limit(Math.max(1, Math.min(limit, 500)));
  }

  async listSessionBranches(sessionId: string): Promise<SessionBranch[]> {
    await this.getConversation(sessionId);
    const rows = await this.db
      .select()
      .from(sessionBranches)
      .where(eq(sessionBranches.sessionId, sessionId))
      .orderBy(asc(sessionBranches.createdAt));
    return rows.map((row) => sessionBranchSchema.parse(row));
  }

  async getSessionBranch(branchId: string): Promise<SessionBranch> {
    const [row] = await this.db
      .select()
      .from(sessionBranches)
      .where(eq(sessionBranches.id, branchId))
      .limit(1);
    if (!row) throw new MaestroError("BRANCH_NOT_FOUND", "Ramificação não encontrada.");
    return sessionBranchSchema.parse(row);
  }

  private async branchLineage(
    branchId: string,
  ): Promise<Array<{ branch: SessionBranch; cutoff: string | null }>> {
    const lineage: Array<{ branch: SessionBranch; cutoff: string | null }> = [];
    const seen = new Set<string>();
    let current = await this.getSessionBranch(branchId);
    let cutoff: string | null = null;
    while (true) {
      if (seen.has(current.id))
        throw new MaestroError("BRANCH_GRAPH_CYCLE", "O grafo de ramificações contém um ciclo.");
      seen.add(current.id);
      lineage.push({ branch: current, cutoff });
      if (!current.parentBranchId) break;
      if (!current.forkedFromTurnId)
        throw new MaestroError(
          "BRANCH_DIVERGENCE_MISSING",
          "A ramificação não possui um ponto de divergência verificável.",
        );
      const divergence = await this.getTurn(current.forkedFromTurnId);
      cutoff = divergence.createdAt;
      const parent = await this.getSessionBranch(current.parentBranchId);
      if (parent.sessionId !== current.sessionId)
        throw new MaestroError(
          "BRANCH_SESSION_MISMATCH",
          "A ramificação pai pertence a outra sessão.",
        );
      current = parent;
    }
    return lineage.reverse();
  }

  async forkAtTurn(input: {
    sessionId: string;
    turnId: string;
    name?: string;
  }): Promise<SessionBranch> {
    const [conversation, turn] = await Promise.all([
      this.getConversation(input.sessionId),
      this.getTurn(input.turnId),
    ]);
    if (turn.conversationId !== conversation.id)
      throw new MaestroError("TURN_SESSION_MISMATCH", "O turno não pertence à sessão selecionada.");
    const parentBranchId = conversation.activeBranchId ?? turn.branchId ?? null;
    if (!parentBranchId)
      throw new MaestroError("BRANCH_NOT_FOUND", "A sessão não possui uma branch ativa.");
    const parent = await this.getSessionBranch(parentBranchId);
    const lineage = await this.branchLineage(parent.id);
    if (
      !lineage.some(
        (segment) =>
          segment.branch.id === turn.branchId &&
          (!segment.cutoff || turn.createdAt <= segment.cutoff),
      )
    )
      throw new MaestroError("TURN_NOT_IN_BRANCH", "O turno não está visível na branch ativa.");
    const timestamp = now();
    const branch = sessionBranchSchema.parse({
      id: ulid(),
      sessionId: conversation.id,
      parentBranchId: parent.id,
      forkedFromTurnId: turn.id,
      name:
        input.name?.trim() ||
        `Alternativa ${((await this.listSessionBranches(conversation.id)).length + 1).toString()}`,
      isRoot: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO session_branches(
             id, session_id, parent_branch_id, forked_from_turn_id, name, is_root,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          branch.id,
          branch.sessionId,
          branch.parentBranchId,
          branch.forkedFromTurnId,
          branch.name,
          branch.createdAt,
          branch.updatedAt,
        );
      this.sqlite
        .prepare("UPDATE conversations SET active_branch_id = ?, updated_at = ? WHERE id = ?")
        .run(branch.id, timestamp, conversation.id);
    })();
    await this.appendAuditEvent({
      projectId: conversation.projectId,
      sessionId: conversation.id,
      type: "session.branch.created",
      payload: { branchId: branch.id, parentBranchId: parent.id, turnId: turn.id },
    });
    return branch;
  }

  async switchSessionBranch(sessionId: string, branchId: string): Promise<SessionBranch> {
    const [conversation, branch] = await Promise.all([
      this.getConversation(sessionId),
      this.getSessionBranch(branchId),
    ]);
    if (branch.sessionId !== conversation.id)
      throw new MaestroError(
        "BRANCH_SESSION_MISMATCH",
        "A ramificação não pertence à sessão selecionada.",
      );
    await this.db
      .update(conversations)
      .set({ activeBranchId: branch.id, updatedAt: now() })
      .where(eq(conversations.id, conversation.id));
    return branch;
  }

  async createContextAsset(
    input: Omit<ContextAssetRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<ContextAssetRecord> {
    const timestamp = now();
    const row: ContextAssetRecord = {
      ...input,
      id: input.id ?? ulid(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(contextAssets).values(row);
    return row;
  }

  async updateContextAsset(
    assetId: string,
    values: Partial<
      Omit<ContextAssetRecord, "id" | "projectId" | "conversationId" | "createdAt" | "updatedAt">
    >,
  ): Promise<ContextAssetRecord> {
    await this.db
      .update(contextAssets)
      .set({ ...values, updatedAt: now() })
      .where(eq(contextAssets.id, assetId));
    return this.getContextAsset(assetId);
  }

  async getContextAsset(assetId: string): Promise<ContextAssetRecord> {
    const [record] = await this.db
      .select()
      .from(contextAssets)
      .where(eq(contextAssets.id, assetId))
      .limit(1);
    if (!record)
      throw new MaestroError("CONTEXT_ASSET_NOT_FOUND", "Item de contexto não encontrado.");
    return record;
  }

  async getContextAssets(assetIds: readonly string[]): Promise<ContextAssetRecord[]> {
    if (assetIds.length === 0) return [];
    const records = await this.db
      .select()
      .from(contextAssets)
      .where(inArray(contextAssets.id, [...assetIds]));
    const byId = new Map(records.map((record) => [record.id, record]));
    return assetIds.flatMap((id) => {
      const record = byId.get(id);
      return record ? [record] : [];
    });
  }

  async findContextAssetByHash(
    conversationId: string,
    contentHash: string,
  ): Promise<ContextAssetRecord | null> {
    const [record] = await this.db
      .select()
      .from(contextAssets)
      .where(
        and(
          eq(contextAssets.conversationId, conversationId),
          eq(contextAssets.contentHash, contentHash),
          isNotNull(contextAssets.managedPath),
        ),
      )
      .limit(1);
    return record ?? null;
  }

  async listContextAssetRecords(conversationId: string): Promise<ContextAssetRecord[]> {
    return this.db
      .select()
      .from(contextAssets)
      .where(eq(contextAssets.conversationId, conversationId))
      .orderBy(asc(contextAssets.createdAt));
  }

  async listProjectContextAssetRecords(projectId: string): Promise<ContextAssetRecord[]> {
    return this.db
      .select()
      .from(contextAssets)
      .where(eq(contextAssets.projectId, projectId))
      .orderBy(asc(contextAssets.createdAt));
  }

  async listContextAssets(conversationId: string): Promise<ContextAssetSummary[]> {
    return (await this.listContextAssetRecords(conversationId)).map(contextAssetSummary);
  }

  toContextAssetSummary(record: ContextAssetRecord): ContextAssetSummary {
    return contextAssetSummary(record);
  }

  async deleteContextAsset(conversationId: string, assetId: string): Promise<ContextAssetRecord> {
    const record = await this.getContextAsset(assetId);
    if (record.conversationId !== conversationId)
      throw new MaestroError(
        "CONTEXT_CONVERSATION_MISMATCH",
        "O item de contexto não pertence a esta conversa.",
      );
    await this.db.delete(contextAssets).where(eq(contextAssets.id, assetId));
    return record;
  }

  async isContextAssetLinked(assetId: string): Promise<boolean> {
    const [link] = await this.db
      .select({ assetId: messageContextAssets.assetId })
      .from(messageContextAssets)
      .where(eq(messageContextAssets.assetId, assetId))
      .limit(1);
    return Boolean(link);
  }

  async replaceContextChunks(
    assetId: string,
    chunks: Array<{ content: string; tokenCount: number }>,
  ): Promise<void> {
    await this.getContextAsset(assetId);
    const timestamp = now();
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM context_chunks WHERE asset_id = ?").run(assetId);
      const insert = this.sqlite.prepare(
        "INSERT INTO context_chunks(id, asset_id, ordinal, content, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      chunks.forEach((chunk, ordinal) =>
        insert.run(ulid(), assetId, ordinal, chunk.content, chunk.tokenCount, timestamp),
      );
    })();
  }

  searchContextChunks(
    assetIds: readonly string[],
    query: string,
    limit = 24,
  ): Promise<ContextChunkRecord[]> {
    if (assetIds.length === 0) return Promise.resolve([]);
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const placeholders = assetIds.map(() => "?").join(", ");
    const terms = query
      .normalize("NFKC")
      .match(/[\p{L}\p{N}_-]{2,}/gu)
      ?.slice(0, 16)
      .map((term) => `"${term.replaceAll('"', '""')}"*`);
    if (!terms?.length) {
      return Promise.resolve(
        this.sqlite
          .prepare(
            `SELECT id, asset_id AS assetId, ordinal, content, token_count AS tokenCount
             FROM context_chunks
             WHERE asset_id IN (${placeholders})
             ORDER BY asset_id, ordinal
             LIMIT ?`,
          )
          .all(...assetIds, boundedLimit) as ContextChunkRecord[],
      );
    }
    const ranked = this.sqlite
      .prepare(
        `SELECT chunk.id, chunk.asset_id AS assetId, chunk.ordinal, chunk.content,
                chunk.token_count AS tokenCount, bm25(context_chunks_fts) AS rank
         FROM context_chunks_fts
         JOIN context_chunks AS chunk ON chunk.id = context_chunks_fts.chunk_id
         WHERE context_chunks_fts MATCH ?
           AND context_chunks_fts.asset_id IN (${placeholders})
         ORDER BY rank, chunk.ordinal
         LIMIT ?`,
      )
      .all(terms.join(" OR "), ...assetIds, boundedLimit) as ContextChunkRecord[];
    if (ranked.length > 0) return Promise.resolve(ranked);
    return Promise.resolve(
      this.sqlite
        .prepare(
          `SELECT id, asset_id AS assetId, ordinal, content, token_count AS tokenCount
           FROM context_chunks
           WHERE asset_id IN (${placeholders})
           ORDER BY asset_id, ordinal
           LIMIT ?`,
        )
        .all(...assetIds, boundedLimit) as ContextChunkRecord[],
    );
  }

  async listManagedContextPaths(input: {
    conversationId?: string;
    projectId?: string;
  }): Promise<string[]> {
    const records = input.conversationId
      ? await this.db
          .select({ managedPath: contextAssets.managedPath })
          .from(contextAssets)
          .where(eq(contextAssets.conversationId, input.conversationId))
      : input.projectId
        ? await this.db
            .select({ managedPath: contextAssets.managedPath })
            .from(contextAssets)
            .where(eq(contextAssets.projectId, input.projectId))
        : [];
    return records.flatMap((record) => (record.managedPath ? [record.managedPath] : []));
  }

  async addMessage(input: {
    conversationId: string;
    runId?: string | null;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
    attachments?: Attachment[];
    contextAssetIds?: string[];
    providerMessageId?: string | null;
    branchId?: string | null;
  }): Promise<Message> {
    const conversation = await this.getConversation(input.conversationId);
    const timestamp = now();
    const row: typeof messages.$inferInsert = {
      id: ulid(),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      role: input.role,
      content: input.content,
      status: input.status ?? "completed",
      attachments: input.attachments ?? [],
      providerMessageId: input.providerMessageId ?? null,
      branchId: input.branchId ?? conversation.activeBranchId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO messages(
             id, conversation_id, run_id, role, content, status, attachments,
             provider_message_id, branch_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.conversationId,
          row.runId,
          row.role,
          row.content,
          row.status,
          JSON.stringify(row.attachments),
          row.providerMessageId,
          row.branchId,
          row.createdAt,
          row.updatedAt,
        );
      const assetIds = [...new Set(input.contextAssetIds ?? [])];
      const insertLink = this.sqlite.prepare(
        "INSERT INTO message_context_assets(message_id, asset_id, ordinal) VALUES (?, ?, ?)",
      );
      assetIds.forEach((assetId, ordinal) => {
        const asset = this.sqlite
          .prepare("SELECT conversation_id AS conversationId FROM context_assets WHERE id = ?")
          .get(assetId) as { conversationId: string } | undefined;
        if (!asset)
          throw new MaestroError("CONTEXT_ASSET_NOT_FOUND", "Item de contexto não encontrado.");
        if (asset.conversationId !== input.conversationId)
          throw new MaestroError(
            "CONTEXT_CONVERSATION_MISMATCH",
            "O item de contexto não pertence a esta conversa.",
          );
        insertLink.run(row.id, assetId, ordinal);
      });
    })();
    await this.db
      .update(conversations)
      .set({ updatedAt: timestamp })
      .where(eq(conversations.id, input.conversationId));
    return {
      id: row.id,
      conversationId: row.conversationId,
      runId: row.runId ?? null,
      role: row.role,
      content: row.content,
      status: row.status ?? "completed",
      attachments: row.attachments ?? [],
      contextAssets: await this.contextAssetsForMessage(row.id),
      providerMessageId: row.providerMessageId ?? null,
      branchId: row.branchId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async updateMessage(
    messageId: string,
    values: Partial<Pick<Message, "content" | "status" | "providerMessageId" | "runId">>,
  ): Promise<Message> {
    await this.db
      .update(messages)
      .set({ ...values, updatedAt: now() })
      .where(eq(messages.id, messageId));
    const [row] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!row) throw new MaestroError("MESSAGE_NOT_FOUND", "Mensagem não encontrada.");
    return { ...row, contextAssets: await this.contextAssetsForMessage(row.id) };
  }

  async listMessages(conversationId: string, branchId?: string | null): Promise<Message[]> {
    const conversation = await this.getConversation(conversationId);
    const activeBranchId = branchId ?? conversation.activeBranchId ?? null;
    const lineage = activeBranchId ? await this.branchLineage(activeBranchId) : [];
    const rows =
      lineage.length === 0
        ? await this.db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conversationId))
            .orderBy(asc(messages.createdAt), asc(messages.id))
        : (
            await Promise.all(
              lineage.map((segment) =>
                this.db
                  .select()
                  .from(messages)
                  .where(
                    and(
                      eq(messages.conversationId, conversationId),
                      eq(messages.branchId, segment.branch.id),
                      ...(segment.cutoff ? [lte(messages.createdAt, segment.cutoff)] : []),
                    ),
                  )
                  .orderBy(asc(messages.createdAt), asc(messages.id)),
              ),
            )
          )
            .flat()
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
            );
    if (rows.length === 0) return [];
    const links = await this.db
      .select()
      .from(messageContextAssets)
      .where(
        inArray(
          messageContextAssets.messageId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(messageContextAssets.ordinal));
    const assets = await this.getContextAssets([...new Set(links.map((link) => link.assetId))]);
    const byId = new Map(assets.map((asset) => [asset.id, contextAssetSummary(asset)]));
    return rows.map((row) => ({
      ...row,
      contextAssets: links
        .filter((link) => link.messageId === row.id)
        .flatMap((link) => {
          const asset = byId.get(link.assetId);
          return asset ? [asset] : [];
        }),
    }));
  }

  private async contextAssetsForMessage(messageId: string): Promise<ContextAssetSummary[]> {
    const links = await this.db
      .select()
      .from(messageContextAssets)
      .where(eq(messageContextAssets.messageId, messageId))
      .orderBy(asc(messageContextAssets.ordinal));
    return (await this.getContextAssets(links.map((link) => link.assetId))).map(
      contextAssetSummary,
    );
  }

  async createRun(spec: RunSpec, initialState: RunState): Promise<Run> {
    const parsed = runSpecSchema.parse(spec);
    const conversation = await this.getConversation(parsed.conversationId);
    const branchId = parsed.branchId ?? conversation.activeBranchId ?? null;
    const persistedSpec = runSpecSchema.parse({ ...parsed, branchId });
    const timestamp = now();
    const row: Run = {
      id: parsed.id,
      projectId: parsed.projectId,
      conversationId: parsed.conversationId,
      mode: parsed.mode,
      state: initialState,
      spec: persistedSpec,
      currentPlanVersion: null,
      integrationBranch: null,
      integrationPath: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: initialState === "running" ? timestamp : null,
      finishedAt: null,
      branchId,
    };
    await this.db.insert(runs).values(row);
    await this.db.insert(backgroundJobs).values({
      id: `run-${row.id}`,
      projectId: row.projectId,
      sessionId: row.conversationId,
      branchId,
      runId: row.id,
      parentJobId: null,
      title: parsed.prompt.slice(0, 180) || `Execução ${row.id.slice(0, 8)}`,
      kind: "run",
      state: jobStateForRun(initialState),
      progress: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      detail: { mode: row.mode },
      createdAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
    });
    return row;
  }

  async getRun(runId: string): Promise<Run> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!row) throw new MaestroError("RUN_NOT_FOUND", "Execução não encontrada.");
    return { ...row, spec: runSpecSchema.parse(row.spec) };
  }

  async listRuns(
    input: {
      projectId?: string;
      conversationId?: string;
      states?: RunState[];
      limit?: number;
    } = {},
  ): Promise<Run[]> {
    const conditions = [];
    if (input.projectId) conditions.push(eq(runs.projectId, input.projectId));
    if (input.conversationId) conditions.push(eq(runs.conversationId, input.conversationId));
    if (input.states && input.states.length > 0) conditions.push(inArray(runs.state, input.states));
    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);
    const rows = await this.db
      .select()
      .from(runs)
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(input.limit ?? 200);
    return rows.map((row) => ({ ...row, spec: runSpecSchema.parse(row.spec) }));
  }

  async transitionRun(
    runId: string,
    to: RunState,
    options: {
      reason?: string;
      error?: string | null;
      integrationBranch?: string | null;
      integrationPath?: string | null;
    } = {},
  ): Promise<Run> {
    const current = await this.getRun(runId);
    assertRunTransition(current.state, to);
    const timestamp = now();
    const terminal = to === "completed" || to === "failed" || to === "canceled";
    await this.db
      .update(runs)
      .set({
        state: to,
        updatedAt: timestamp,
        startedAt: current.startedAt ?? (to === "running" ? timestamp : null),
        finishedAt: terminal ? timestamp : null,
        error: options.error === undefined ? current.error : options.error,
        integrationBranch:
          options.integrationBranch === undefined
            ? current.integrationBranch
            : options.integrationBranch,
        integrationPath:
          options.integrationPath === undefined ? current.integrationPath : options.integrationPath,
      })
      .where(eq(runs.id, runId));
    await this.db
      .update(backgroundJobs)
      .set({
        state: jobStateForRun(to),
        progress: to === "completed" ? 1 : null,
        updatedAt: timestamp,
        finishedAt: terminal ? timestamp : null,
      })
      .where(eq(backgroundJobs.id, `run-${runId}`));
    return this.getRun(runId);
  }

  /**
   * Recovery-only rewind to a checkpointable state. Normal state changes must
   * continue to use transitionRun and its stricter transition graph.
   */
  async recoverRunState(
    runId: string,
    to: "discovering" | "researching" | "running" | "queued",
  ): Promise<Run> {
    const current = await this.getRun(runId);
    if (current.state === "completed" || current.state === "failed" || current.state === "canceled")
      throw new MaestroError(
        "TERMINAL_RUN_NOT_RECOVERABLE",
        "Execução terminal não pode ser retomada.",
      );
    await this.db
      .update(runs)
      .set({
        state: to,
        updatedAt: now(),
        error: null,
        finishedAt: null,
      })
      .where(eq(runs.id, runId));
    return this.getRun(runId);
  }

  /** Explicit user retry from a failed run, still gated by a safe checkpoint in orchestration. */
  async retryFailedRunState(runId: string, to: "discovering" | "queued"): Promise<Run> {
    const current = await this.getRun(runId);
    if (current.state !== "failed")
      throw new MaestroError(
        "RUN_NOT_RETRYABLE",
        "Somente uma execução com falha pode ser repetida.",
      );
    await this.db
      .update(runs)
      .set({ state: to, updatedAt: now(), error: null, finishedAt: null })
      .where(eq(runs.id, runId));
    return this.getRun(runId);
  }

  async addPlan(plan: PlanSpec, markdown: string): Promise<PlanSpec> {
    const parsed = planSpecSchema.parse(plan);
    await this.db
      .update(plans)
      .set({ status: "superseded" })
      .where(and(eq(plans.runId, parsed.runId), eq(plans.status, "draft")));
    await this.db.insert(plans).values({
      id: parsed.id,
      runId: parsed.runId,
      version: parsed.version,
      summary: parsed.summary,
      markdown,
      spec: parsed,
      status: "draft",
      createdAt: parsed.createdAt,
      approvedAt: null,
    });
    await this.db
      .update(runs)
      .set({ currentPlanVersion: parsed.version, updatedAt: now() })
      .where(eq(runs.id, parsed.runId));
    return parsed;
  }

  async listPlans(runId: string): Promise<PlanSpec[]> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(eq(plans.runId, runId))
      .orderBy(asc(plans.version));
    return rows.map((row) => planSpecSchema.parse(row.spec));
  }

  async getPlan(
    runId: string,
    version: number,
  ): Promise<{ plan: PlanSpec; markdown: string; status: string }> {
    const [row] = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.runId, runId), eq(plans.version, version)))
      .limit(1);
    if (!row) throw new MaestroError("PLAN_NOT_FOUND", "Plano não encontrado.");
    return { plan: planSpecSchema.parse(row.spec), markdown: row.markdown, status: row.status };
  }

  async approvePlan(runId: string, version: number): Promise<void> {
    const selected = await this.getPlan(runId, version);
    if (selected.status !== "draft")
      throw new MaestroError("PLAN_NOT_APPROVABLE", "Esta versão do plano não pode ser aprovada.");
    const timestamp = now();
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare("UPDATE plans SET status='superseded' WHERE run_id=? AND version<>?")
        .run(runId, version);
      this.sqlite
        .prepare("UPDATE plans SET status='approved', approved_at=? WHERE run_id=? AND version=?")
        .run(timestamp, runId, version);
      this.sqlite
        .prepare("UPDATE runs SET current_plan_version=?, updated_at=? WHERE id=?")
        .run(version, timestamp, runId);
    })();
  }

  async createTaskRuns(
    runId: string,
    planVersion: number,
    specs: readonly TaskSpec[],
  ): Promise<TaskRun[]> {
    const run = await this.getRun(runId);
    const timestamp = now();
    const rows: TaskRun[] = specs.map((spec) => ({
      id: ulid(),
      runId,
      planVersion,
      taskId: spec.id,
      spec,
      state: "pending",
      attempt: 1,
      providerSessionId: null,
      branch: null,
      worktreePath: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
    }));
    if (rows.length > 0) {
      await this.db.insert(taskRuns).values(rows);
      await this.db.insert(backgroundJobs).values(
        rows.map((task) => ({
          id: `task-${task.id}`,
          projectId: run.projectId,
          sessionId: run.conversationId,
          branchId: run.branchId,
          runId,
          parentJobId: `run-${runId}`,
          title: task.spec.title,
          kind: "agent" as const,
          state: "queued" as const,
          progress: 0,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          detail: {
            taskId: task.taskId,
            role: task.spec.role,
            dependencies: task.spec.dependencies,
            model: task.spec.model,
            successCriteria: task.spec.successCriteria,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
          finishedAt: null,
        })),
      );
    }
    return rows;
  }

  async listTaskRuns(runId: string): Promise<TaskRun[]> {
    return this.db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.runId, runId))
      .orderBy(asc(taskRuns.createdAt));
  }

  async updateTaskRun(
    runId: string,
    taskId: string,
    values: Partial<
      Pick<TaskRun, "state" | "providerSessionId" | "branch" | "worktreePath" | "error">
    >,
  ): Promise<TaskRun> {
    const currentRows = await this.db
      .select()
      .from(taskRuns)
      .where(and(eq(taskRuns.runId, runId), eq(taskRuns.taskId, taskId)))
      .orderBy(desc(taskRuns.attempt))
      .limit(1);
    const current = currentRows[0];
    if (!current)
      throw new MaestroError("TASK_RUN_NOT_FOUND", "Execução de tarefa não encontrada.");
    const timestamp = now();
    const state = values.state ?? current.state;
    const terminal =
      state === "completed" || state === "failed" || state === "canceled" || state === "skipped";
    await this.db
      .update(taskRuns)
      .set({
        ...values,
        updatedAt: timestamp,
        startedAt: current.startedAt ?? (state === "running" ? timestamp : null),
        finishedAt: terminal ? timestamp : null,
      })
      .where(eq(taskRuns.id, current.id));
    const [updated] = await this.db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.id, current.id))
      .limit(1);
    if (!updated)
      throw new MaestroError("TASK_RUN_NOT_FOUND", "Execução de tarefa não encontrada.");
    const jobState =
      state === "pending"
        ? "queued"
        : state === "skipped"
          ? "completed"
          : state === "validating"
            ? "running"
            : state;
    await this.db
      .update(backgroundJobs)
      .set({
        state: jobState,
        progress: state === "completed" || state === "skipped" ? 1 : null,
        updatedAt: timestamp,
        finishedAt: terminal ? timestamp : null,
        detail: {
          taskId: updated.taskId,
          role: updated.spec.role,
          dependencies: updated.spec.dependencies,
          model: updated.spec.model,
          successCriteria: updated.spec.successCriteria,
          branch: updated.branch,
          worktreePath: updated.worktreePath,
          error: updated.error,
        },
      })
      .where(eq(backgroundJobs.id, `task-${current.id}`));
    return updated;
  }

  appendEvent<K extends NewRunEvent["type"]>(
    event: Extract<NewRunEvent, { type: K }>,
  ): Promise<RunEvent<K>> {
    const insert = this.sqlite.transaction(() => {
      const result = this.sqlite
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM run_events WHERE run_id=?")
        .get(event.runId) as { sequence: number };
      const sequence = result.sequence + 1;
      const id = ulid();
      const occurredAt = event.occurredAt ?? now();
      const schemaVersion = event.schemaVersion ?? 2;
      this.sqlite
        .prepare(
          "INSERT INTO run_events(id, run_id, sequence, type, payload, schema_version, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          event.runId,
          sequence,
          event.type,
          JSON.stringify(event.data),
          schemaVersion,
          occurredAt,
        );
      return {
        id,
        runId: event.runId,
        sequence,
        type: event.type,
        data: event.data,
        schemaVersion,
        occurredAt,
      } as RunEvent<K>;
    });
    return Promise.resolve(insert());
  }

  getEvents(runId: string, afterSequence = 0, limit = 500): Promise<EventPage> {
    const rows = this.sqlite
      .prepare(
        "SELECT id, run_id, sequence, type, payload, schema_version, occurred_at FROM run_events WHERE run_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?",
      )
      .all(runId, afterSequence, Math.max(1, Math.min(limit, 2_000))) as Array<{
      id: string;
      run_id: string;
      sequence: number;
      type: RunEvent["type"];
      payload: string;
      schema_version: number;
      occurred_at: string;
    }>;
    const events = rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      data: parseJson(row.payload),
      schemaVersion: row.schema_version,
      occurredAt: row.occurred_at,
    })) as RunEvent[];
    const [last] = events.slice(-1);
    const more = last
      ? this.sqlite
          .prepare("SELECT 1 FROM run_events WHERE run_id=? AND sequence>? LIMIT 1")
          .get(runId, last.sequence)
      : null;
    return Promise.resolve({ events, nextSequence: more && last ? last.sequence : null });
  }

  async getRunDetail(runId: string): Promise<RunDetail> {
    const [run, planValues, tasks] = await Promise.all([
      this.getRun(runId),
      this.listPlans(runId),
      this.listTaskRuns(runId),
    ]);
    return { run, plans: planValues, tasks };
  }

  async nextTurnSequence(conversationId: string): Promise<number> {
    await this.getConversation(conversationId);
    const row = this.sqlite
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM turns WHERE conversation_id = ?",
      )
      .get(conversationId) as { sequence: number };
    return row.sequence;
  }

  async createTurn(turn: Turn): Promise<Turn> {
    const parsed = turnSchema.parse(turn);
    const conversation = await this.getConversation(parsed.conversationId);
    if (parsed.runId) await this.getRun(parsed.runId);
    const value = turnSchema.parse({
      ...parsed,
      branchId: parsed.branchId ?? conversation.activeBranchId ?? null,
    });
    await this.db.insert(turns).values(value);
    return value;
  }

  async getTurn(turnId: string): Promise<Turn> {
    const [row] = await this.db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
    if (!row) throw new MaestroError("TURN_NOT_FOUND", "Turno não encontrado.");
    return turnSchema.parse(row);
  }

  async getLatestTurn(input: { conversationId?: string; runId?: string }): Promise<Turn | null> {
    if (!input.conversationId && !input.runId)
      throw new MaestroError("TURN_FILTER_REQUIRED", "Informe a conversa ou a execução.");
    const rows = input.runId
      ? await this.db
          .select()
          .from(turns)
          .where(eq(turns.runId, input.runId))
          .orderBy(desc(turns.sequence))
          .limit(1)
      : await this.db
          .select()
          .from(turns)
          .where(eq(turns.conversationId, input.conversationId!))
          .orderBy(desc(turns.sequence))
          .limit(1);
    return rows[0] ? turnSchema.parse(rows[0]) : null;
  }

  async listTurns(input: {
    conversationId?: string;
    runId?: string;
    states?: TurnState[];
  }): Promise<Turn[]> {
    const clauses = [
      ...(input.conversationId ? [eq(turns.conversationId, input.conversationId)] : []),
      ...(input.runId ? [eq(turns.runId, input.runId)] : []),
      ...(input.states?.length ? [inArray(turns.state, input.states)] : []),
    ];
    const rows = await this.db
      .select()
      .from(turns)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(asc(turns.sequence));
    return rows.map((row) => turnSchema.parse(row));
  }

  async updateTurn(
    turnId: string,
    values: Partial<
      Pick<
        Turn,
        | "runId"
        | "state"
        | "policy"
        | "modelPreference"
        | "selectedModel"
        | "inputMessageId"
        | "outputMessageId"
        | "completedAt"
        | "error"
      >
    >,
  ): Promise<Turn> {
    await this.getTurn(turnId);
    await this.db
      .update(turns)
      .set({ ...values, updatedAt: now() })
      .where(eq(turns.id, turnId));
    return this.getTurn(turnId);
  }

  async transitionTurn(turnId: string, state: TurnState, error?: string | null): Promise<Turn> {
    const terminal = state === "completed" || state === "failed" || state === "canceled";
    return this.updateTurn(turnId, {
      state,
      ...(error !== undefined ? { error } : {}),
      ...(terminal ? { completedAt: now() } : {}),
    });
  }

  appendTurnItem(turnId: string, kind: TurnItem["kind"], payload: unknown): Promise<TurnItem> {
    const insert = this.sqlite.transaction(() => {
      const exists = this.sqlite.prepare("SELECT id FROM turns WHERE id = ?").get(turnId);
      if (!exists) throw new MaestroError("TURN_NOT_FOUND", "Turno não encontrado.");
      const sequenceRow = this.sqlite
        .prepare(
          "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM turn_items WHERE turn_id = ?",
        )
        .get(turnId) as { sequence: number };
      const item: TurnItem = {
        id: ulid(),
        turnId,
        sequence: sequenceRow.sequence,
        kind,
        payload,
        createdAt: now(),
      };
      this.sqlite
        .prepare(
          "INSERT INTO turn_items(id, turn_id, sequence, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          item.id,
          item.turnId,
          item.sequence,
          item.kind,
          JSON.stringify(item.payload),
          item.createdAt,
        );
      return item;
    });
    return Promise.resolve(insert());
  }

  async listTurnItems(turnId: string): Promise<TurnItem[]> {
    await this.getTurn(turnId);
    const rows = await this.db
      .select()
      .from(turnItems)
      .where(eq(turnItems.turnId, turnId))
      .orderBy(asc(turnItems.sequence));
    return rows.map((row) => ({ ...row, payload: row.payload }));
  }

  async createToolCall(call: ToolCall): Promise<void> {
    const parsed = toolCallSchema.parse(call);
    await this.getTurn(parsed.turnId);
    await this.db.insert(toolCalls).values(parsed);
    await this.appendTurnItem(parsed.turnId, "tool_call", parsed);
  }

  async updateToolCall(call: ToolCall): Promise<void> {
    const parsed = toolCallSchema.parse(call);
    await this.db
      .update(toolCalls)
      .set({
        status: parsed.status,
        checkpointId: parsed.checkpointId,
        startedAt: parsed.startedAt,
        finishedAt: parsed.finishedAt,
      })
      .where(eq(toolCalls.id, parsed.id));
  }

  async saveToolResult(result: ToolResult): Promise<void> {
    const parsed = toolResultSchema.parse(result);
    const [call] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, parsed.toolCallId))
      .limit(1);
    if (!call)
      throw new MaestroError("TOOL_CALL_NOT_FOUND", "Chamada de ferramenta não encontrada.");
    await this.db
      .insert(toolResults)
      .values(parsed)
      .onConflictDoUpdate({
        target: toolResults.toolCallId,
        set: {
          output: parsed.output,
          isError: parsed.isError,
          error: parsed.error,
          artifactRef: parsed.artifactRef,
          truncated: parsed.truncated,
          contentHash: parsed.contentHash,
          createdAt: parsed.createdAt,
        },
      });
    await this.appendTurnItem(call.turnId, "tool_result", parsed);
  }

  async findToolCallByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<{ call: ToolCall; result: ToolResult | null } | null> {
    const [call] = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!call) return null;
    const [result] = await this.db
      .select()
      .from(toolResults)
      .where(eq(toolResults.toolCallId, call.id))
      .limit(1);
    return {
      call: toolCallSchema.parse(call),
      result: result ? toolResultSchema.parse(result) : null,
    };
  }

  async createApproval(input: {
    id?: string;
    runId: string;
    turnId?: string | null;
    planVersion?: number | null;
    kind?: ApprovalRecord["kind"];
    scope: ExecutionPolicy;
  }): Promise<ApprovalRecord> {
    await this.getRun(input.runId);
    const record: ApprovalRecord = {
      id: input.id ?? ulid(),
      runId: input.runId,
      turnId: input.turnId ?? null,
      planVersion: input.planVersion ?? null,
      kind: input.kind ?? "plan",
      status: "pending",
      scope: input.scope,
      scopeHash: input.scope.scopeHash,
      requestedAt: now(),
      resolvedAt: null,
      resolution: null,
    };
    await this.db.insert(approvals).values(record);
    return record;
  }

  async resolveApproval(
    approvalId: string,
    decision: "approved" | "denied" | "superseded",
    resolution?: string,
  ): Promise<ApprovalRecord> {
    await this.db
      .update(approvals)
      .set({ status: decision, resolvedAt: now(), resolution: resolution ?? null })
      .where(eq(approvals.id, approvalId));
    const [record] = await this.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);
    if (!record) throw new MaestroError("APPROVAL_NOT_FOUND", "Aprovação não encontrada.");
    return record;
  }

  async updateApprovalScope(approvalId: string, scope: ExecutionPolicy): Promise<ApprovalRecord> {
    const parsed = executionPolicySchema.parse(scope);
    await this.db
      .update(approvals)
      .set({ scope: parsed, scopeHash: parsed.scopeHash })
      .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")));
    const [record] = await this.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);
    if (!record) throw new MaestroError("APPROVAL_NOT_FOUND", "Aprovação não encontrada.");
    if (record.status !== "pending")
      throw new MaestroError("APPROVAL_ALREADY_RESOLVED", "A aprovação já foi resolvida.");
    return record;
  }

  async getApprovedExecutionPolicy(
    runId: string,
    planVersion?: number,
  ): Promise<ApprovalRecord | null> {
    const rows = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.status, "approved")))
      .orderBy(desc(approvals.resolvedAt));
    return rows.find((row) => planVersion === undefined || row.planVersion === planVersion) ?? null;
  }

  async saveCheckpoint(checkpoint: ContextCheckpoint): Promise<ContextCheckpoint> {
    const parsed = contextCheckpointSchema.parse(checkpoint);
    await this.getTurn(parsed.turnId);
    await this.db.insert(contextCheckpoints).values({
      id: parsed.id,
      conversationId: parsed.conversationId,
      runId: parsed.runId,
      turnId: parsed.turnId,
      version: parsed.version,
      checkpoint: parsed,
      safeToResume: parsed.safeToResume,
      createdAt: parsed.createdAt,
    });
    await this.appendTurnItem(parsed.turnId, "checkpoint", parsed);
    return parsed;
  }

  async getCheckpoint(checkpointId: string): Promise<ContextCheckpoint> {
    const [row] = await this.db
      .select()
      .from(contextCheckpoints)
      .where(eq(contextCheckpoints.id, checkpointId))
      .limit(1);
    if (!row) throw new MaestroError("CHECKPOINT_NOT_FOUND", "Checkpoint não encontrado.");
    return contextCheckpointSchema.parse(row.checkpoint);
  }

  async getLatestCheckpoint(input: {
    conversationId?: string;
    runId?: string;
    turnId?: string;
    safeOnly?: boolean;
  }): Promise<ContextCheckpoint | null> {
    const clauses = [
      ...(input.conversationId
        ? [eq(contextCheckpoints.conversationId, input.conversationId)]
        : []),
      ...(input.runId ? [eq(contextCheckpoints.runId, input.runId)] : []),
      ...(input.turnId ? [eq(contextCheckpoints.turnId, input.turnId)] : []),
      ...(input.safeOnly ? [eq(contextCheckpoints.safeToResume, true)] : []),
    ];
    if (clauses.length === 0)
      throw new MaestroError("CHECKPOINT_FILTER_REQUIRED", "Informe o escopo do checkpoint.");
    const [row] = await this.db
      .select()
      .from(contextCheckpoints)
      .where(and(...clauses))
      .orderBy(desc(contextCheckpoints.createdAt), desc(contextCheckpoints.version))
      .limit(1);
    return row ? contextCheckpointSchema.parse(row.checkpoint) : null;
  }

  async saveRoutingDecision(
    decision: RoutingDecision,
    runId?: string | null,
  ): Promise<RoutingDecision> {
    await this.db.insert(routingDecisions).values({
      id: decision.id,
      turnId: decision.turnId,
      runId: runId ?? null,
      role: decision.role,
      providerId: decision.selected.selection.providerId,
      connectionId: decision.selected.selection.connectionId ?? null,
      modelId: decision.selected.selection.modelId,
      decision,
      createdAt: decision.createdAt,
    });
    if (decision.turnId) await this.appendTurnItem(decision.turnId, "route", decision);
    return decision;
  }

  async getLatestRoutingDecision(runId: string): Promise<RoutingDecision | null> {
    const [row] = await this.db
      .select()
      .from(routingDecisions)
      .where(eq(routingDecisions.runId, runId))
      .orderBy(desc(routingDecisions.createdAt))
      .limit(1);
    return row?.decision ?? null;
  }

  async saveRecoveryAttempt(attempt: RecoveryAttempt): Promise<RecoveryAttempt> {
    await this.db
      .insert(recoveryAttempts)
      .values({
        id: attempt.id,
        turnId: attempt.turnId,
        runId: attempt.runId,
        attempt,
        createdAt: attempt.createdAt,
        finishedAt: attempt.finishedAt,
      })
      .onConflictDoUpdate({
        target: recoveryAttempts.id,
        set: { attempt, finishedAt: attempt.finishedAt },
      });
    return attempt;
  }

  async listRecoveryAttempts(runId: string): Promise<RecoveryAttempt[]> {
    const rows = await this.db
      .select({ attempt: recoveryAttempts.attempt })
      .from(recoveryAttempts)
      .where(eq(recoveryAttempts.runId, runId))
      .orderBy(asc(recoveryAttempts.createdAt));
    return rows.map((row) => row.attempt);
  }

  async finishRecoveryAttempt(
    id: string,
    outcome: Exclude<RecoveryAttempt["outcome"], "pending">,
  ): Promise<RecoveryAttempt> {
    const [row] = await this.db
      .select({ attempt: recoveryAttempts.attempt })
      .from(recoveryAttempts)
      .where(eq(recoveryAttempts.id, id))
      .limit(1);
    if (!row)
      throw new MaestroError(
        "RECOVERY_ATTEMPT_NOT_FOUND",
        "Tentativa de recuperação não encontrada.",
      );
    const finishedAt = now();
    const attempt: RecoveryAttempt = { ...row.attempt, outcome, finishedAt };
    await this.db
      .update(recoveryAttempts)
      .set({ attempt, finishedAt })
      .where(eq(recoveryAttempts.id, id));
    return attempt;
  }

  async putToolArtifact(
    content: string,
    metadata: { toolCallId: string; toolName: string },
  ): Promise<string> {
    const id = ulid();
    await this.db.insert(toolArtifacts).values({
      id,
      toolCallId: metadata.toolCallId,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      byteLength: Buffer.byteLength(content),
      createdAt: now(),
    });
    return `maestro-artifact://${id}`;
  }

  async getToolArtifact(reference: string): Promise<string> {
    const id = reference.replace(/^maestro-artifact:\/\//, "");
    const [row] = await this.db
      .select()
      .from(toolArtifacts)
      .where(eq(toolArtifacts.id, id))
      .limit(1);
    if (!row) throw new MaestroError("TOOL_ARTIFACT_NOT_FOUND", "Artefato não encontrado.");
    return row.content;
  }

  async setPendingModelSwitch(record: PendingModelSwitchRecord): Promise<void> {
    await this.db
      .insert(pendingModelSwitches)
      .values(record)
      .onConflictDoUpdate({
        target: pendingModelSwitches.runId,
        set: {
          selection: record.selection,
          timing: record.timing,
          noFallback: record.noFallback,
          requestedAt: record.requestedAt,
        },
      });
  }

  async getPendingModelSwitch(runId: string): Promise<PendingModelSwitchRecord | null> {
    const [record] = await this.db
      .select()
      .from(pendingModelSwitches)
      .where(eq(pendingModelSwitches.runId, runId))
      .limit(1);
    return record ?? null;
  }

  async clearPendingModelSwitch(runId: string): Promise<void> {
    await this.db.delete(pendingModelSwitches).where(eq(pendingModelSwitches.runId, runId));
  }

  async upsertModelTelemetry(value: ModelTelemetry): Promise<void> {
    const key = `${value.providerId}:${value.connectionId ?? "default"}:${value.modelId}`;
    const row = {
      key,
      providerId: value.providerId,
      connectionId: value.connectionId,
      modelId: value.modelId,
      successes: value.successes,
      failures: value.failures,
      consecutiveFailures: value.consecutiveFailures,
      latencyEwmaMs: value.latencyEwmaMs,
      quotaRemaining: value.quotaRemaining,
      quotaLimit: value.quotaLimit,
      activeSessions: value.activeSessions,
      concurrencyLimit: value.concurrencyLimit,
      cooldownUntil: value.cooldownUntil,
      circuitState: value.circuitState,
      cachedInputTokens: value.cachedInputTokens,
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      costUsd: value.costUsd,
      updatedAt: value.updatedAt,
    };
    await this.db
      .insert(modelTelemetry)
      .values(row)
      .onConflictDoUpdate({ target: modelTelemetry.key, set: row });
  }

  async listModelTelemetry(): Promise<ModelTelemetry[]> {
    const rows = await this.db.select().from(modelTelemetry);
    const timestamp = Date.now();
    return rows.map(({ key: _key, ...row }) => {
      const cooldown = row.cooldownUntil ? Date.parse(row.cooldownUntil) : 0;
      return {
        ...row,
        circuitState:
          row.circuitState === "open" && cooldown > 0 && cooldown <= timestamp
            ? ("half_open" as const)
            : row.circuitState,
        successRate:
          row.successes + row.failures > 0 ? row.successes / (row.successes + row.failures) : 1,
      };
    });
  }

  async recordModelOutcome(input: {
    selection: ModelSelection;
    success: boolean;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    costUsd?: number;
    cooldownUntil?: string | null;
  }): Promise<ModelTelemetry> {
    const existing = (await this.listModelTelemetry()).find(
      (item) =>
        item.providerId === input.selection.providerId &&
        item.modelId === input.selection.modelId &&
        item.connectionId === (input.selection.connectionId ?? null),
    );
    const successes = (existing?.successes ?? 0) + (input.success ? 1 : 0);
    const failures = (existing?.failures ?? 0) + (input.success ? 0 : 1);
    const consecutiveFailures = input.success ? 0 : (existing?.consecutiveFailures ?? 0) + 1;
    const circuitOpen = !input.success && consecutiveFailures >= 3;
    const cooldownUntil = input.success
      ? null
      : circuitOpen
        ? (input.cooldownUntil ?? new Date(Date.now() + 60_000).toISOString())
        : (input.cooldownUntil ?? existing?.cooldownUntil ?? null);
    const value: ModelTelemetry = {
      providerId: input.selection.providerId,
      connectionId: input.selection.connectionId ?? null,
      modelId: input.selection.modelId,
      successes,
      failures,
      consecutiveFailures,
      latencyEwmaMs:
        input.latencyMs === undefined
          ? (existing?.latencyEwmaMs ?? null)
          : existing?.latencyEwmaMs === null || existing?.latencyEwmaMs === undefined
            ? input.latencyMs
            : existing.latencyEwmaMs * 0.7 + input.latencyMs * 0.3,
      successRate: successes + failures > 0 ? successes / (successes + failures) : 1,
      quotaRemaining: existing?.quotaRemaining ?? null,
      quotaLimit: existing?.quotaLimit ?? null,
      activeSessions: existing?.activeSessions ?? 0,
      concurrencyLimit: existing?.concurrencyLimit ?? null,
      cooldownUntil,
      circuitState: circuitOpen ? "open" : "closed",
      cachedInputTokens: (existing?.cachedInputTokens ?? 0) + (input.cachedTokens ?? 0),
      inputTokens: (existing?.inputTokens ?? 0) + (input.inputTokens ?? 0),
      outputTokens: (existing?.outputTokens ?? 0) + (input.outputTokens ?? 0),
      costUsd: (existing?.costUsd ?? 0) + (input.costUsd ?? 0),
      updatedAt: now(),
    };
    await this.upsertModelTelemetry(value);
    return value;
  }

  async appendAuditEvent(input: {
    projectId?: string | null;
    sessionId?: string | null;
    runId?: string | null;
    type: string;
    payload: Record<string, unknown>;
    occurredAt?: string;
  }): Promise<string> {
    const id = ulid();
    await this.db.insert(auditEvents).values({
      id,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      runId: input.runId ?? null,
      type: input.type,
      payload: input.payload,
      schemaVersion: 2,
      occurredAt: input.occurredAt ?? now(),
    });
    return id;
  }

  async saveSourceSnapshot(
    input: Omit<SourceSnapshot, "id" | "contentHash" | "accessedAt"> & {
      id?: string;
      accessedAt?: string;
    },
  ): Promise<SourceSnapshot> {
    await this.getProject(input.projectId);
    const snapshot = sourceSnapshotSchema.parse({
      ...input,
      id: input.id ?? ulid(),
      contentHash: createHash("sha256")
        .update(`${input.url}\n${input.title}\n${input.excerpt}`)
        .digest("hex"),
      accessedAt: input.accessedAt ?? now(),
    });
    await this.db.insert(sourceSnapshots).values(snapshot);
    await this.appendAuditEvent({
      projectId: snapshot.projectId,
      type: "source.accessed",
      payload: {
        sourceSnapshotId: snapshot.id,
        url: snapshot.url,
        provider: snapshot.provider,
      },
      occurredAt: snapshot.accessedAt,
    });
    return snapshot;
  }

  async saveCitation(input: Omit<Citation, "id" | "createdAt">): Promise<Citation> {
    const citation = citationSchema.parse({ ...input, id: ulid(), createdAt: now() });
    const [source] = await this.db
      .select()
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, citation.sourceSnapshotId))
      .limit(1);
    if (!source) throw new MaestroError("SOURCE_NOT_FOUND", "Fonte citada não encontrada.");
    if (source.projectId !== citation.projectId)
      throw new MaestroError("SOURCE_PROJECT_MISMATCH", "A fonte pertence a outro projeto.");
    await this.db.insert(citations).values(citation);
    return citation;
  }

  async listCitationSources(
    sessionId: string,
  ): Promise<Array<{ source: SourceSnapshot; citation: Citation }>> {
    const rows = await this.db
      .select({ source: sourceSnapshots, citation: citations })
      .from(citations)
      .innerJoin(sourceSnapshots, eq(sourceSnapshots.id, citations.sourceSnapshotId))
      .where(eq(citations.sessionId, sessionId))
      .orderBy(asc(citations.createdAt));
    return rows.map((row) => ({
      source: sourceSnapshotSchema.parse(row.source),
      citation: citationSchema.parse(row.citation),
    }));
  }

  async getSessionTimeline(
    sessionId: string,
    cursor?: number,
    limit = 250,
    branchId?: string,
  ): Promise<SessionTimelinePage> {
    const conversation = await this.getConversation(sessionId);
    const activeBranchId = branchId ?? conversation.activeBranchId ?? null;
    const [branches, sessionMessages, branchArtifacts, allTurns, citationSources] =
      await Promise.all([
        this.listSessionBranches(sessionId),
        this.listMessages(sessionId, activeBranchId),
        this.listArtifacts(conversation.projectId, sessionId),
        this.listTurns({ conversationId: sessionId }),
        this.listCitationSources(sessionId),
      ]);
    const messageIds = new Set(sessionMessages.map((message) => message.id));
    const visibleTurns = allTurns.filter(
      (turn) =>
        (turn.inputMessageId !== null && messageIds.has(turn.inputMessageId)) ||
        (turn.outputMessageId !== null && messageIds.has(turn.outputMessageId)),
    );
    const turnByMessage = new Map<string, Turn>();
    const turnByRun = new Map<string, Turn>();
    for (const turn of visibleTurns) {
      if (turn.inputMessageId) turnByMessage.set(turn.inputMessageId, turn);
      if (turn.outputMessageId) turnByMessage.set(turn.outputMessageId, turn);
      if (turn.runId) turnByRun.set(turn.runId, turn);
    }
    const runIds = new Set([
      ...sessionMessages.flatMap((message) => (message.runId ? [message.runId] : [])),
      ...visibleTurns.flatMap((turn) => (turn.runId ? [turn.runId] : [])),
    ]);
    const sessionRuns = (
      await Promise.all([...runIds].map((runId) => this.getRun(runId).catch(() => null)))
    ).filter((run): run is Run => run !== null);
    const eventGroups = await Promise.all(
      sessionRuns.map((run) => this.getEvents(run.id, 0, 2_000).then((page) => page.events)),
    );
    const items: Array<TimelineItem & { sortAt: string; sortRank: number }> = [];
    for (const message of sessionMessages) {
      const turn = turnByMessage.get(message.id);
      items.push({
        id: `message:${message.id}`,
        sessionId,
        branchId: message.branchId ?? activeBranchId,
        turnId: turn?.id ?? null,
        runId: message.runId,
        sequence: 0,
        kind: "message",
        message,
        createdAt: message.createdAt,
        sortAt: message.role === "assistant" ? message.updatedAt : message.createdAt,
        sortRank: message.role === "user" ? 0 : 9,
      });
    }
    for (const events of eventGroups) {
      for (const event of events) {
        const turn = turnByRun.get(event.runId);
        const run = sessionRuns.find((candidate) => candidate.id === event.runId);
        const base = {
          id: `event:${event.id}`,
          sessionId,
          branchId: run?.branchId ?? turn?.branchId ?? activeBranchId,
          turnId: turn?.id ?? null,
          runId: event.runId,
          sequence: 0,
          createdAt: event.occurredAt,
          sortAt: event.occurredAt,
          sortRank: 4,
        };
        switch (event.type) {
          case "clarification.requested":
            items.push({
              ...base,
              kind: "question",
              questions: event.data.questions,
              status: "pending",
            });
            break;
          case "clarification.answered":
            items.push({
              ...base,
              kind: "research",
              title: "Requisitos esclarecidos",
              summary: event.data.answer,
              status: "completed",
            });
            break;
          case "research.started":
            items.push({
              ...base,
              kind: "research",
              title: "Pesquisa",
              summary: event.data.topics.join(" · "),
              status: "running",
            });
            break;
          case "research.finding":
            items.push({
              ...base,
              kind: "research",
              title: event.data.finding.title,
              summary: event.data.finding.detail,
              status: "completed",
            });
            break;
          case "plan.created":
            items.push({ ...base, kind: "plan", plan: event.data.plan });
            break;
          case "agent.started":
            items.push({
              ...base,
              kind: "agent",
              agentId: event.data.agentId,
              label: event.data.label,
              status: "running",
              detail: `${event.data.providerId} · ${event.data.modelId}`,
            });
            break;
          case "agent.stopped":
            items.push({
              ...base,
              kind: "agent",
              agentId: event.data.agentId,
              label: "Agente",
              status: event.data.outcome,
              detail: null,
            });
            break;
          case "tool.started":
            items.push({
              ...base,
              kind: "tool",
              name: event.data.name,
              status: "running",
              summary: "Ferramenta iniciada",
            });
            break;
          case "tool.completed":
            items.push({
              ...base,
              kind: "tool",
              name: event.data.name,
              status: event.data.isError ? "failed" : "completed",
              summary: event.data.isError
                ? "A ferramenta retornou um erro"
                : "Ferramenta concluída",
            });
            break;
          case "connector.invoked":
            items.push({
              ...base,
              kind: "tool",
              name: `connector:${event.data.operation}`,
              status: event.data.status,
              summary: `${event.data.mutability} · ${event.data.connectorId}`,
            });
            break;
          case "approval.required":
            items.push({
              ...base,
              kind: "approval",
              approvalId: event.data.approvalId,
              status: "pending",
              summary: event.data.summary,
            });
            break;
          case "approval.resolved":
            items.push({
              ...base,
              kind: "approval",
              approvalId: event.data.approvalId,
              status: event.data.decision,
              summary: event.data.decision === "approved" ? "Limite aprovado" : "Limite negado",
            });
            break;
          case "file.diff":
            items.push({
              ...base,
              kind: "diff",
              path: event.data.path,
              patch: event.data.patch,
              additions: event.data.additions ?? null,
              deletions: event.data.deletions ?? null,
            });
            break;
          case "command.completed":
            items.push({
              ...base,
              kind: "validation",
              label: "Comando",
              status: event.data.exitCode === 0 ? "passed" : "failed",
              detail:
                event.data.exitCode === null ? event.data.signal : `exit ${event.data.exitCode}`,
            });
            break;
          case "checkpoint.created":
            items.push({ ...base, kind: "checkpoint", checkpoint: event.data.checkpoint });
            break;
          case "error":
            items.push({
              ...base,
              kind: "error",
              code: event.data.code,
              message: event.data.message,
              recoverable: event.data.recoverable,
            });
            break;
          default:
            break;
        }
      }
    }
    for (const artifact of branchArtifacts) {
      if (artifact.branchId && activeBranchId && artifact.branchId !== activeBranchId) continue;
      items.push({
        id: `artifact:${artifact.id}:${artifact.currentVersion}`,
        sessionId,
        branchId: artifact.branchId,
        turnId: artifact.turnId,
        runId: null,
        sequence: 0,
        kind: "artifact",
        artifact,
        createdAt: artifact.updatedAt,
        sortAt: artifact.updatedAt,
        sortRank: 7,
      });
    }
    for (const { source, citation } of citationSources) {
      if (citation.branchId && activeBranchId && citation.branchId !== activeBranchId) continue;
      items.push({
        id: `source:${citation.id}`,
        sessionId,
        branchId: citation.branchId,
        turnId: citation.turnId,
        runId: null,
        sequence: 0,
        kind: "source",
        source,
        citation,
        createdAt: citation.createdAt,
        sortAt: citation.createdAt,
        sortRank: 6,
      });
    }
    items.sort(
      (left, right) =>
        left.sortAt.localeCompare(right.sortAt) ||
        left.sortRank - right.sortRank ||
        left.id.localeCompare(right.id),
    );
    const normalized = items.map(({ sortAt: _sortAt, sortRank: _sortRank, ...item }, sequence) => ({
      ...item,
      sequence,
    })) as TimelineItem[];
    const boundedLimit = Math.max(1, Math.min(limit, 1_000));
    const latestPageStart =
      normalized.length === 0
        ? 0
        : Math.floor((normalized.length - 1) / boundedLimit) * boundedLimit;
    const start = Math.min(
      normalized.length,
      Math.max(0, cursor === undefined ? latestPageStart : cursor),
    );
    const pageItems = normalized.slice(start, start + boundedLimit);
    return {
      sessionId,
      activeBranchId,
      branches,
      items: pageItems,
      cursor: start,
      total: normalized.length,
      previousCursor: start > 0 ? Math.max(0, start - boundedLimit) : null,
      nextCursor: start + pageItems.length < normalized.length ? start + pageItems.length : null,
    };
  }

  async listArtifacts(projectId: string, sessionId?: string): Promise<Artifact[]> {
    await this.getProject(projectId);
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(
        sessionId
          ? and(eq(artifacts.projectId, projectId), eq(artifacts.sessionId, sessionId))
          : eq(artifacts.projectId, projectId),
      )
      .orderBy(desc(artifacts.pinned), desc(artifacts.updatedAt));
    return rows.map((row) => artifactSchema.parse(row));
  }

  async openArtifact(artifactId: string): Promise<ArtifactDetail> {
    const [row] = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .limit(1);
    if (!row) throw new MaestroError("ARTIFACT_NOT_FOUND", "Artefato não encontrado.");
    const versions = await this.db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.version));
    return {
      artifact: artifactSchema.parse(row),
      versions: versions.map((version) => artifactVersionSchema.parse(version)),
    };
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactDetail> {
    await this.getProject(input.projectId);
    if (input.sessionId) {
      const conversation = await this.getConversation(input.sessionId);
      if (conversation.projectId !== input.projectId)
        throw new MaestroError("ARTIFACT_PROJECT_MISMATCH", "A sessão pertence a outro projeto.");
    }
    const timestamp = now();
    const artifactId = ulid();
    const contentHash = createHash("sha256").update(input.content).digest("hex");
    const mimeByKind: Record<Artifact["kind"], string> = {
      markdown: "text/markdown",
      code: "text/plain",
      diff: "text/x-diff",
      json: "application/json",
      html: "text/html",
      svg: "image/svg+xml",
    };
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO artifacts(
             id, project_id, session_id, branch_id, turn_id, title, kind, language,
             mime_type, current_version, pinned, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(
          artifactId,
          input.projectId,
          input.sessionId ?? null,
          input.branchId ?? null,
          input.turnId ?? null,
          input.title.trim(),
          input.kind,
          input.language ?? null,
          input.mimeType ?? mimeByKind[input.kind],
          input.pinned ? 1 : 0,
          timestamp,
          timestamp,
        );
      this.sqlite
        .prepare(
          `INSERT INTO artifact_versions(
             id, artifact_id, version, content, content_hash, created_by,
             source_event_id, created_at
           ) VALUES (?, ?, 1, ?, ?, ?, NULL, ?)`,
        )
        .run(ulid(), artifactId, input.content, contentHash, input.createdBy ?? "user", timestamp);
    })();
    await this.appendAuditEvent({
      projectId: input.projectId,
      sessionId: input.sessionId ?? null,
      type: "artifact.updated",
      payload: { artifactId, version: 1, kind: input.kind },
    });
    return this.openArtifact(artifactId);
  }

  async updateArtifact(input: UpdateArtifactInput): Promise<ArtifactDetail> {
    const current = await this.openArtifact(input.artifactId);
    const timestamp = now();
    const version = current.artifact.currentVersion + 1;
    const contentHash = createHash("sha256").update(input.content).digest("hex");
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO artifact_versions(
             id, artifact_id, version, content, content_hash, created_by,
             source_event_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ulid(),
          input.artifactId,
          version,
          input.content,
          contentHash,
          input.createdBy ?? "user",
          input.sourceEventId ?? null,
          timestamp,
        );
      this.sqlite
        .prepare(
          `UPDATE artifacts SET
             current_version = ?,
             title = CASE WHEN ? THEN ? ELSE title END,
             language = CASE WHEN ? THEN ? ELSE language END,
             pinned = CASE WHEN ? THEN ? ELSE pinned END,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          version,
          Number(input.title !== undefined),
          input.title?.trim() ?? null,
          Number(input.language !== undefined),
          input.language ?? null,
          Number(input.pinned !== undefined),
          input.pinned === undefined ? null : Number(input.pinned),
          timestamp,
          input.artifactId,
        );
    })();
    await this.appendAuditEvent({
      projectId: current.artifact.projectId,
      sessionId: current.artifact.sessionId,
      type: "artifact.updated",
      payload: { artifactId: input.artifactId, version, kind: current.artifact.kind },
    });
    return this.openArtifact(input.artifactId);
  }

  async listMemories(filter: MemoryFilter = {}): Promise<MemoryRecord[]> {
    const clauses = [
      ...(filter.projectId ? [eq(memoryRecords.projectId, filter.projectId)] : []),
      ...(filter.scope ? [eq(memoryRecords.scope, filter.scope)] : []),
      ...(filter.state ? [eq(memoryRecords.state, filter.state)] : []),
    ];
    const rows = await this.db
      .select()
      .from(memoryRecords)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(memoryRecords.updatedAt));
    const query = filter.query?.trim().toLocaleLowerCase();
    return rows
      .filter((row) => !query || row.content.toLocaleLowerCase().includes(query))
      .map((row) => memoryRecordSchema.parse(row));
  }

  async saveMemory(input: SaveMemoryInput): Promise<MemoryRecord> {
    const conversation = await this.getConversation(input.sessionId);
    if (conversation.projectId !== input.projectId)
      throw new MaestroError("MEMORY_PROJECT_MISMATCH", "A sessão pertence a outro projeto.");
    if (input.turnId) {
      const turn = await this.getTurn(input.turnId);
      if (turn.conversationId !== input.sessionId)
        throw new MaestroError("MEMORY_TURN_MISMATCH", "O turno pertence a outra sessão.");
    }
    let source: "user" | "assistant" = "assistant";
    if (input.messageId) {
      const [message] = await this.db
        .select()
        .from(messages)
        .where(eq(messages.id, input.messageId))
        .limit(1);
      if (!message || message.conversationId !== input.sessionId)
        throw new MaestroError("MEMORY_MESSAGE_MISMATCH", "A mensagem pertence a outra sessão.");
      source = message.role === "user" ? "user" : "assistant";
    }
    const content = input.content.trim();
    const [duplicate] = await this.db
      .select()
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.projectId, input.projectId),
          eq(memoryRecords.scope, "project"),
          eq(memoryRecords.content, content),
          inArray(memoryRecords.state, ["suggested", "accepted"]),
        ),
      )
      .limit(1);
    if (duplicate) return memoryRecordSchema.parse(duplicate);
    const timestamp = now();
    const memory = memoryRecordSchema.parse({
      id: ulid(),
      projectId: input.projectId,
      scope: "project",
      kind: input.kind ?? "fact",
      content,
      provenance: {
        sessionId: input.sessionId,
        turnId: input.turnId ?? null,
        messageId: input.messageId ?? null,
        source,
        excerpt: content.slice(0, 2_000),
      },
      confidence: 1,
      state: "accepted",
      expiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.db.insert(memoryRecords).values(memory);
    await this.appendAuditEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      type: "memory.changed",
      payload: { memoryId: memory.id, action: "accepted", scope: "project" },
    });
    return memory;
  }

  async suggestMemoriesFromMessage(
    message: Message,
    turnId: string | null = null,
    scope: "project" | "personal" = "project",
  ): Promise<MemoryRecord[]> {
    if (message.role !== "user" || message.status !== "completed") return [];
    const conversation = await this.getConversation(message.conversationId);
    const candidates = extractMemoryCandidates(message.content);
    const created: MemoryRecord[] = [];
    for (const candidate of candidates) {
      const duplicate = this.sqlite
        .prepare(
          `SELECT id FROM memory_records
           WHERE scope = ? AND project_id IS ? AND lower(content) = lower(?)
             AND state IN ('suggested', 'accepted') LIMIT 1`,
        )
        .get(scope, scope === "project" ? conversation.projectId : null, candidate.content);
      if (duplicate) continue;
      const timestamp = now();
      const memory = memoryRecordSchema.parse({
        id: ulid(),
        projectId: scope === "project" ? conversation.projectId : null,
        scope,
        kind: candidate.kind,
        content: candidate.content,
        provenance: {
          sessionId: conversation.id,
          turnId,
          messageId: message.id,
          source: "user",
          excerpt: candidate.evidence,
        },
        confidence: candidate.confidence,
        state: "suggested",
        expiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await this.db.insert(memoryRecords).values(memory);
      await this.appendAuditEvent({
        projectId: conversation.projectId,
        sessionId: conversation.id,
        type: "memory.changed",
        payload: { memoryId: memory.id, action: "suggested", scope },
      });
      created.push(memory);
    }
    return created;
  }

  async updateMemory(
    input: UpdateMemoryInput & { state?: MemoryRecord["state"] },
  ): Promise<MemoryRecord> {
    const [current] = await this.db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.id, input.memoryId))
      .limit(1);
    if (!current) throw new MaestroError("MEMORY_NOT_FOUND", "Memória não encontrada.");
    await this.db
      .update(memoryRecords)
      .set({
        ...(input.content === undefined ? {} : { content: input.content.trim() }),
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        ...(input.state === undefined ? {} : { state: input.state }),
        updatedAt: now(),
      })
      .where(eq(memoryRecords.id, input.memoryId));
    const [updated] = await this.db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.id, input.memoryId))
      .limit(1);
    const parsed = memoryRecordSchema.parse(updated);
    await this.appendAuditEvent({
      projectId: parsed.projectId,
      sessionId: parsed.provenance.sessionId,
      type: "memory.changed",
      payload: {
        memoryId: parsed.id,
        action:
          parsed.state === "accepted"
            ? "accepted"
            : parsed.state === "forgotten"
              ? "forgotten"
              : "updated",
        scope: parsed.scope,
      },
    });
    return parsed;
  }

  async listConnectors(projectId: string): Promise<Connector[]> {
    await this.getProject(projectId);
    const rows = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.projectId, projectId))
      .orderBy(asc(connectors.name));
    return rows.map((row) => connectorSchema.parse(row));
  }

  async configureConnector(input: {
    projectId: string;
    connectorId?: string;
    name: string;
    kind: Connector["kind"];
    enabled: boolean;
    config: Record<string, unknown>;
  }): Promise<Connector> {
    await this.getProject(input.projectId);
    if (configContainsSecret(input.config))
      throw new MaestroError(
        "CONNECTOR_SECRET_FORBIDDEN",
        "Segredos devem ser guardados no vault, nunca na configuração do conector.",
      );
    const timestamp = now();
    const id = input.connectorId ?? ulid();
    await this.db
      .insert(connectors)
      .values({
        id,
        projectId: input.projectId,
        name: input.name.trim(),
        kind: input.kind,
        enabled: input.enabled,
        config: input.config,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: connectors.id,
        set: {
          name: input.name.trim(),
          kind: input.kind,
          enabled: input.enabled,
          config: input.config,
          updatedAt: timestamp,
        },
      });
    const [row] = await this.db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
    const parsed = connectorSchema.parse(row);
    await this.appendAuditEvent({
      projectId: parsed.projectId,
      type: "connector.configured",
      payload: { connectorId: parsed.id, kind: parsed.kind, enabled: parsed.enabled },
    });
    return parsed;
  }

  async grantConnector(input: {
    connectorId: string;
    capability: ConnectorGrant["capability"];
    scope?: Record<string, unknown>;
    expiresAt?: string | null;
  }): Promise<ConnectorGrant> {
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.id, input.connectorId))
      .limit(1);
    if (!connector) throw new MaestroError("CONNECTOR_NOT_FOUND", "Conector não encontrado.");
    const timestamp = now();
    const grant = connectorGrantSchema.parse({
      id: ulid(),
      connectorId: input.connectorId,
      capability: input.capability,
      scope: input.scope ?? {},
      granted: true,
      expiresAt: input.expiresAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.db.insert(connectorGrants).values(grant);
    await this.appendAuditEvent({
      projectId: connector.projectId,
      type: "authorization.changed",
      payload: { subject: "connector_grant", grantId: grant.id, action: "granted" },
    });
    return grant;
  }

  async revokeConnector(connectorId: string, grantId: string): Promise<ConnectorGrant> {
    const [grant] = await this.db
      .select()
      .from(connectorGrants)
      .where(and(eq(connectorGrants.id, grantId), eq(connectorGrants.connectorId, connectorId)))
      .limit(1);
    if (!grant) throw new MaestroError("CONNECTOR_GRANT_NOT_FOUND", "Grant não encontrado.");
    await this.db
      .update(connectorGrants)
      .set({ granted: false, updatedAt: now() })
      .where(eq(connectorGrants.id, grantId));
    const [updated] = await this.db
      .select()
      .from(connectorGrants)
      .where(eq(connectorGrants.id, grantId))
      .limit(1);
    const parsed = connectorGrantSchema.parse(updated);
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.id, connectorId))
      .limit(1);
    await this.appendAuditEvent({
      projectId: connector?.projectId ?? null,
      type: "authorization.changed",
      payload: { subject: "connector_grant", grantId: parsed.id, action: "revoked" },
    });
    return parsed;
  }

  async listConnectorGrants(connectorId: string): Promise<ConnectorGrant[]> {
    const rows = await this.db
      .select()
      .from(connectorGrants)
      .where(eq(connectorGrants.connectorId, connectorId))
      .orderBy(desc(connectorGrants.updatedAt));
    return rows.map((row) => connectorGrantSchema.parse(row));
  }

  async startConnectorInvocation(input: {
    connectorId: string;
    runId?: string | null;
    turnId?: string | null;
    operation: string;
    mutability: ConnectorInvocation["mutability"];
    inputSummary: string;
    status?: ConnectorInvocation["status"];
  }): Promise<ConnectorInvocation> {
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.id, input.connectorId))
      .limit(1);
    if (!connector) throw new MaestroError("CONNECTOR_NOT_FOUND", "Conector não encontrado.");
    const invocation = connectorInvocationSchema.parse({
      id: ulid(),
      connectorId: input.connectorId,
      runId: input.runId ?? null,
      turnId: input.turnId ?? null,
      operation: input.operation,
      mutability: input.mutability,
      status: input.status ?? "running",
      inputSummary: input.inputSummary,
      outputSummary: null,
      error: null,
      startedAt: now(),
      finishedAt: input.status === "denied" ? now() : null,
    });
    await this.db.insert(connectorInvocations).values(invocation);
    return invocation;
  }

  async finishConnectorInvocation(
    invocationId: string,
    input: {
      status: "completed" | "failed" | "denied";
      outputSummary?: string | null;
      error?: string | null;
    },
  ): Promise<ConnectorInvocation> {
    await this.db
      .update(connectorInvocations)
      .set({
        status: input.status,
        outputSummary: input.outputSummary ?? null,
        error: input.error ?? null,
        finishedAt: now(),
      })
      .where(eq(connectorInvocations.id, invocationId));
    const [row] = await this.db
      .select()
      .from(connectorInvocations)
      .where(eq(connectorInvocations.id, invocationId))
      .limit(1);
    if (!row) throw new MaestroError("CONNECTOR_INVOCATION_NOT_FOUND", "Invocação não encontrada.");
    const invocation = connectorInvocationSchema.parse(row);
    const [connector] = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.id, invocation.connectorId))
      .limit(1);
    await this.appendAuditEvent({
      projectId: connector?.projectId ?? null,
      runId: invocation.runId,
      type: "connector.invoked",
      payload: {
        connectorId: invocation.connectorId,
        invocationId: invocation.id,
        operation: invocation.operation,
        mutability: invocation.mutability,
        status: invocation.status,
      },
    });
    return invocation;
  }

  async listConnectorInvocations(connectorId: string): Promise<ConnectorInvocation[]> {
    const rows = await this.db
      .select()
      .from(connectorInvocations)
      .where(eq(connectorInvocations.connectorId, connectorId))
      .orderBy(desc(connectorInvocations.startedAt));
    return rows.map((row) => connectorInvocationSchema.parse(row));
  }

  async getProjectAutonomy(projectId: string): Promise<AutonomyProfile> {
    const project = await this.getProject(projectId);
    const [existing] = await this.db
      .select()
      .from(autonomyProfiles)
      .where(eq(autonomyProfiles.projectId, projectId))
      .limit(1);
    if (existing) return autonomyProfileSchema.parse(existing);
    const value = autonomyProfileSchema.parse({
      projectId,
      level: "review",
      allowedPaths: project.roots.map((root) => root.canonicalPath),
      allowedTools: [],
      allowedCommands: [],
      network: "denied",
      maxCostUsd: null,
      maxTokens: null,
      updatedAt: now(),
    });
    await this.db.insert(autonomyProfiles).values(value);
    return value;
  }

  async setProjectAutonomy(projectId: string, level: AutonomyLevel): Promise<AutonomyProfile> {
    const current = await this.getProjectAutonomy(projectId);
    const project = await this.getProject(projectId);
    const updated = autonomyProfileSchema.parse({
      ...current,
      level,
      allowedPaths:
        current.allowedPaths.length > 0
          ? current.allowedPaths
          : project.roots.map((root) => root.canonicalPath),
      allowedTools:
        level === "autopilot" && current.allowedTools.length === 0
          ? ["fs.read", "fs.glob", "search.grep", "lsp.query", "fs.edit", "fs.write"]
          : current.allowedTools,
      updatedAt: now(),
    });
    await this.db
      .insert(autonomyProfiles)
      .values(updated)
      .onConflictDoUpdate({ target: autonomyProfiles.projectId, set: updated });
    await this.appendAuditEvent({
      projectId,
      type: "authorization.changed",
      payload: { subject: "project_autonomy", action: "updated", level },
    });
    return updated;
  }

  async listJobs(projectId: string, activeOnly = false): Promise<BackgroundJob[]> {
    const rows = await this.db
      .select()
      .from(backgroundJobs)
      .where(
        activeOnly
          ? and(
              eq(backgroundJobs.projectId, projectId),
              inArray(backgroundJobs.state, ["queued", "running", "blocked"]),
            )
          : eq(backgroundJobs.projectId, projectId),
      )
      .orderBy(desc(backgroundJobs.updatedAt));
    return rows.map((row) => backgroundJobSchema.parse(row));
  }

  async getJob(jobId: string): Promise<BackgroundJob> {
    const [row] = await this.db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId))
      .limit(1);
    if (!row) throw new MaestroError("JOB_NOT_FOUND", "Trabalho em background não encontrado.");
    return backgroundJobSchema.parse(row);
  }

  async updateJob(
    jobId: string,
    values: Partial<Pick<BackgroundJob, "state" | "progress" | "detail">>,
  ): Promise<BackgroundJob> {
    const current = await this.getJob(jobId);
    const terminal =
      values.state === "completed" || values.state === "failed" || values.state === "canceled";
    await this.db
      .update(backgroundJobs)
      .set({ ...values, updatedAt: now(), ...(terminal ? { finishedAt: now() } : {}) })
      .where(eq(backgroundJobs.id, current.id));
    return this.getJob(jobId);
  }

  globalSearch(projectId: string, query: string, limit = 30): Promise<GlobalSearchResult[]> {
    const tokens = query
      .normalize("NFKC")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 12)
      .map((token) => `"${token.replaceAll('"', '""')}"`);
    if (tokens.length === 0) return Promise.resolve([]);
    const match = tokens.join(" AND ");
    const rows = this.sqlite
      .prepare(
        `SELECT entity_type AS type, entity_id AS id, project_id AS projectId,
                NULLIF(session_id, '') AS sessionId, title,
                snippet(global_search_fts, 5, '<mark>', '</mark>', '…', 20) AS excerpt,
                bm25(global_search_fts, 4.0, 1.0) AS rank
         FROM global_search_fts
         WHERE global_search_fts MATCH ? AND project_id = ?
         ORDER BY rank ASC LIMIT ?`,
      )
      .all(match, projectId, Math.max(1, Math.min(limit, 100))) as Array<{
      type: GlobalSearchResult["type"];
      id: string;
      projectId: string;
      sessionId: string | null;
      title: string;
      excerpt: string;
      rank: number;
    }>;
    const timestamp = now();
    return Promise.resolve(
      rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        type: row.type,
        title: row.title,
        excerpt: row.excerpt,
        sessionId: row.sessionId,
        score: Math.max(0, -row.rank),
        updatedAt: timestamp,
      })),
    );
  }

  async getSettings(): Promise<AppSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.scope, "app")).limit(1);
    if (!row) return DEFAULT_APP_SETTINGS;
    const parsed = appSettingsSchema.safeParse(row.value);
    return parsed.success
      ? { ...parsed.data, subscriptionRouting: "priority" }
      : DEFAULT_APP_SETTINGS;
  }

  async setSettings(value: AppSettings): Promise<AppSettings> {
    const parsed = appSettingsSchema.parse({ ...value, subscriptionRouting: "priority" });
    const timestamp = now();
    await this.db
      .insert(settings)
      .values({ scope: "app", value: parsed, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: settings.scope,
        set: { value: parsed, updatedAt: timestamp },
      });
    return parsed;
  }

  async getProviderConfig(
    providerId: string,
  ): Promise<Record<string, string | number | boolean | null>> {
    const [row] = await this.db
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.providerId, providerId))
      .limit(1);
    return row?.values ?? {};
  }

  async setProviderConfig(
    providerId: string,
    values: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const timestamp = now();
    await this.db
      .insert(providerConfigs)
      .values({ providerId, values, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: providerConfigs.providerId,
        set: { values, updatedAt: timestamp },
      });
  }

  async listProviderConnections(providerId?: string): Promise<ProviderConnection[]> {
    const rows = providerId
      ? await this.db
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.providerId, providerId as "codex" | "claude-code"))
          .orderBy(asc(providerConnections.priority), asc(providerConnections.createdAt))
      : await this.db
          .select()
          .from(providerConnections)
          .orderBy(asc(providerConnections.priority), asc(providerConnections.createdAt));
    return rows;
  }

  async getProviderConnection(connectionId: string): Promise<ProviderConnection> {
    const [connection] = await this.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connectionId))
      .limit(1);
    if (!connection)
      throw new MaestroError(
        "PROVIDER_CONNECTION_NOT_FOUND",
        "Conta de assinatura não encontrada.",
      );
    return connection;
  }

  async createProviderConnection(input: {
    id?: string;
    providerId: "codex" | "claude-code";
    name: string;
    isDefault?: boolean;
    stateDirectory?: string | null;
    priority?: number;
    concurrencyLimit?: number;
  }): Promise<ProviderConnection> {
    const timestamp = now();
    const latest = this.sqlite
      .prepare("SELECT MAX(priority) AS priority FROM provider_connections")
      .get() as { priority: number | null };
    const row: ProviderConnection = {
      id: input.id ?? ulid(),
      providerId: input.providerId,
      name: input.name,
      billingMode: "subscription",
      enabled: true,
      isDefault: input.isDefault ?? false,
      stateDirectory: input.stateDirectory ?? null,
      priority: input.priority ?? (latest.priority ?? -1) + 1,
      concurrencyLimit: input.concurrencyLimit ?? 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: null,
    };
    await this.db.insert(providerConnections).values(row);
    return row;
  }

  async updateProviderConnection(
    connectionId: string,
    values: Partial<
      Pick<ProviderConnection, "name" | "enabled" | "priority" | "concurrencyLimit" | "lastUsedAt">
    >,
  ): Promise<ProviderConnection> {
    await this.getProviderConnection(connectionId);
    await this.db
      .update(providerConnections)
      .set({ ...values, updatedAt: now() })
      .where(eq(providerConnections.id, connectionId));
    return this.getProviderConnection(connectionId);
  }

  async reorderProviderConnections(connectionIds: string[]): Promise<ProviderConnection[]> {
    const current = await this.listProviderConnections();
    const currentIds = new Set(current.map((connection) => connection.id));
    if (
      connectionIds.length !== current.length ||
      new Set(connectionIds).size !== connectionIds.length ||
      connectionIds.some((connectionId) => !currentIds.has(connectionId))
    ) {
      throw new MaestroError(
        "INVALID_PROVIDER_CONNECTION_ORDER",
        "A ordem enviada precisa conter todas as contas conectadas exatamente uma vez.",
        { recoverable: true },
      );
    }
    const timestamp = now();
    this.sqlite.transaction(() => {
      const update = this.sqlite.prepare(
        "UPDATE provider_connections SET priority = ?, updated_at = ? WHERE id = ?",
      );
      connectionIds.forEach((connectionId, index) => update.run(index, timestamp, connectionId));
    })();
    return this.listProviderConnections();
  }

  async deleteProviderConnection(connectionId: string): Promise<void> {
    const connection = await this.getProviderConnection(connectionId);
    if (connection.isDefault)
      throw new MaestroError(
        "DEFAULT_CONNECTION_REQUIRED",
        "A conta padrão preserva o login atual do CLI e não pode ser excluída; desative-a.",
        { recoverable: true },
      );
    await this.db.delete(providerConnections).where(eq(providerConnections.id, connectionId));
  }

  async getSecret(key: string): Promise<SecretRecord | null> {
    const [row] = await this.db.select().from(secrets).where(eq(secrets.key, key)).limit(1);
    return row ?? null;
  }

  async hasSecret(key: string): Promise<boolean> {
    return (await this.getSecret(key)) !== null;
  }

  async setSecret(record: SecretRecord): Promise<void> {
    await this.db
      .insert(secrets)
      .values(record)
      .onConflictDoUpdate({
        target: secrets.key,
        set: {
          backend: record.backend,
          encrypted: record.encrypted,
          salt: record.salt,
          iv: record.iv,
          tag: record.tag,
          updatedAt: record.updatedAt,
        },
      });
  }

  async deleteSecret(key: string): Promise<void> {
    await this.db.delete(secrets).where(eq(secrets.key, key));
  }
}
