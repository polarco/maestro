import type { AppSettings, Attachment, PlanSpec, RunSpec, TaskSpec } from "@maestro/contracts";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastOpenedAt: text("last_opened_at").notNull(),
  },
  (table) => [index("projects_last_opened_idx").on(table.lastOpenedAt)],
);

export const workspaceRoots = sqliteTable(
  "workspace_roots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    canonicalPath: text("canonical_path").notNull(),
    displayName: text("display_name").notNull(),
    writable: integer("writable", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_roots_project_path_uidx").on(table.projectId, table.canonicalPath),
    index("workspace_roots_project_idx").on(table.projectId),
  ],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    mode: text("mode", { enum: ["maestro", "agent", "chat"] }).notNull(),
    sessionKind: text("session_kind", { enum: ["structured", "pty"] }).notNull(),
    providerId: text("provider_id"),
    providerConnectionId: text("provider_connection_id"),
    modelId: text("model_id"),
    workspaceRootId: text("workspace_root_id").references(() => workspaceRoots.id, {
      onDelete: "set null",
    }),
    providerSessionId: text("provider_session_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("conversations_project_updated_idx").on(table.projectId, table.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: ["pending", "streaming", "completed", "failed"] }).notNull(),
    attachments: text("attachments", { mode: "json" }).$type<Attachment[]>().notNull(),
    providerMessageId: text("provider_message_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["maestro", "agent", "chat"] }).notNull(),
    state: text("state", {
      enum: [
        "analyzing",
        "planning",
        "awaiting_approval",
        "queued",
        "running",
        "validating",
        "integrating",
        "completed",
        "failed",
        "canceled",
      ],
    }).notNull(),
    spec: text("spec", { mode: "json" }).$type<RunSpec>().notNull(),
    currentPlanVersion: integer("current_plan_version"),
    integrationBranch: text("integration_branch"),
    integrationPath: text("integration_path"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("runs_project_state_idx").on(table.projectId, table.state),
    index("runs_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    summary: text("summary").notNull(),
    markdown: text("markdown").notNull(),
    spec: text("spec", { mode: "json" }).$type<PlanSpec>().notNull(),
    status: text("status", { enum: ["draft", "approved", "superseded"] }).notNull(),
    createdAt: text("created_at").notNull(),
    approvedAt: text("approved_at"),
  },
  (table) => [
    uniqueIndex("plans_run_version_uidx").on(table.runId, table.version),
    index("plans_run_idx").on(table.runId),
  ],
);

export const taskRuns = sqliteTable(
  "task_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    planVersion: integer("plan_version").notNull(),
    taskId: text("task_id").notNull(),
    spec: text("spec", { mode: "json" }).$type<TaskSpec>().notNull(),
    state: text("state", {
      enum: [
        "pending",
        "blocked",
        "queued",
        "running",
        "validating",
        "completed",
        "failed",
        "canceled",
        "skipped",
      ],
    }).notNull(),
    attempt: integer("attempt").notNull(),
    providerSessionId: text("provider_session_id"),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [
    uniqueIndex("task_runs_run_task_attempt_uidx").on(table.runId, table.taskId, table.attempt),
    index("task_runs_run_state_idx").on(table.runId, table.state),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("run_events_run_sequence_uidx").on(table.runId, table.sequence),
    index("run_events_occurred_idx").on(table.occurredAt),
  ],
);

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  scope: text("scope").primaryKey(),
  value: text("value", { mode: "json" }).$type<AppSettings>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const providerConfigs = sqliteTable("provider_configs", {
  providerId: text("provider_id").primaryKey(),
  values: text("config_json", { mode: "json" })
    .$type<Record<string, string | number | boolean | null>>()
    .notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id", { enum: ["codex", "claude-code"] }).notNull(),
    name: text("name").notNull(),
    billingMode: text("billing_mode", { enum: ["subscription"] }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull(),
    stateDirectory: text("state_directory"),
    priority: integer("priority").notNull(),
    concurrencyLimit: integer("concurrency_limit").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    index("provider_connections_provider_idx").on(table.providerId, table.enabled, table.priority),
  ],
);

export const secrets = sqliteTable("secrets", {
  key: text("key").primaryKey(),
  backend: text("backend", { enum: ["safe-storage", "password-vault"] }).notNull(),
  encrypted: text("encrypted").notNull(),
  salt: text("salt"),
  iv: text("iv"),
  tag: text("tag"),
  updatedAt: text("updated_at").notNull(),
});

export const schema = {
  projects,
  workspaceRoots,
  conversations,
  messages,
  runs,
  plans,
  taskRuns,
  runEvents,
  appMetadata,
  settings,
  providerConfigs,
  providerConnections,
  secrets,
};
