import path from "node:path";
import { mkdirSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { and, asc, desc, eq, exists, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ulid } from "ulid";
import {
  DEFAULT_APP_SETTINGS,
  appSettingsSchema,
  planSpecSchema,
  runSpecSchema,
  type AppSettings,
  type Attachment,
  type Conversation,
  type EventPage,
  type Message,
  type MessageRole,
  type MessageStatus,
  type NewRunEvent,
  type PlanSpec,
  type Project,
  type ProviderConnection,
  type Run,
  type RunDetail,
  type RunEvent,
  type RunMode,
  type RunSpec,
  type RunState,
  type SessionKind,
  type TaskRun,
  type TaskSpec,
  type WorkspaceRoot,
} from "@maestro/contracts";
import { assertRunTransition, MaestroError } from "@maestro/core";
import { INITIAL_MIGRATION, MULTI_ACCOUNT_MIGRATION } from "./migration.js";
import {
  appMetadata,
  conversations,
  messages,
  plans,
  projects,
  providerConfigs,
  providerConnections,
  runs,
  schema,
  secrets,
  settings,
  taskRuns,
  workspaceRoots,
} from "./schema.js";

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
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

export class MaestroRepository {
  readonly sqlite: BetterSqlite3.Database;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.sqlite = new BetterSqlite3(filename);
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    if (filename !== ":memory:") this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = NORMAL");
    this.sqlite.exec(INITIAL_MIGRATION);
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
    return row;
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
      // Run events remain append-only during normal operation. A confirmed parent
      // deletion is the sole exception and removes the complete related graph.
      this.sqlite.exec("DROP TRIGGER IF EXISTS run_events_no_delete");
      this.sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      this.sqlite.exec(`
        CREATE TRIGGER run_events_no_delete
        BEFORE DELETE ON run_events BEGIN
          SELECT RAISE(ABORT, 'run_events is append-only');
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

  async addMessage(input: {
    conversationId: string;
    runId?: string | null;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
    attachments?: Attachment[];
    providerMessageId?: string | null;
  }): Promise<Message> {
    await this.getConversation(input.conversationId);
    const timestamp = now();
    const row: Message = {
      id: ulid(),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      role: input.role,
      content: input.content,
      status: input.status ?? "completed",
      attachments: input.attachments ?? [],
      providerMessageId: input.providerMessageId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(messages).values(row);
    await this.db
      .update(conversations)
      .set({ updatedAt: timestamp })
      .where(eq(conversations.id, input.conversationId));
    return row;
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
    return row;
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  }

  async createRun(spec: RunSpec, initialState: RunState): Promise<Run> {
    const parsed = runSpecSchema.parse(spec);
    const timestamp = now();
    const row: Run = {
      id: parsed.id,
      projectId: parsed.projectId,
      conversationId: parsed.conversationId,
      mode: parsed.mode,
      state: initialState,
      spec: parsed,
      currentPlanVersion: null,
      integrationBranch: null,
      integrationPath: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: initialState === "running" ? timestamp : null,
      finishedAt: null,
    };
    await this.db.insert(runs).values(row);
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
    if (rows.length > 0) await this.db.insert(taskRuns).values(rows);
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
      this.sqlite
        .prepare(
          "INSERT INTO run_events(id, run_id, sequence, type, payload, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, event.runId, sequence, event.type, JSON.stringify(event.data), occurredAt);
      return {
        id,
        runId: event.runId,
        sequence,
        type: event.type,
        data: event.data,
        occurredAt,
      } as RunEvent<K>;
    });
    return Promise.resolve(insert());
  }

  getEvents(runId: string, afterSequence = 0, limit = 500): Promise<EventPage> {
    const rows = this.sqlite
      .prepare(
        "SELECT id, run_id, sequence, type, payload, occurred_at FROM run_events WHERE run_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?",
      )
      .all(runId, afterSequence, Math.max(1, Math.min(limit, 2_000))) as Array<{
      id: string;
      run_id: string;
      sequence: number;
      type: RunEvent["type"];
      payload: string;
      occurred_at: string;
    }>;
    const events = rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      data: parseJson(row.payload),
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
