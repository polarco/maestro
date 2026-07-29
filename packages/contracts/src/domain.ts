import { z } from "zod";

export const entityIdSchema = z.string().min(1).max(128);
export const isoDateSchema = z.string().datetime({ offset: true });

export const runModeSchema = z.enum(["maestro", "agent", "chat"]);
export type RunMode = z.infer<typeof runModeSchema>;

export const sessionKindSchema = z.enum(["structured", "pty"]);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const effortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof effortSchema>;

export const runStateSchema = z.enum([
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
]);
export type RunState = z.infer<typeof runStateSchema>;

export const taskStateSchema = z.enum([
  "pending",
  "blocked",
  "queued",
  "running",
  "validating",
  "completed",
  "failed",
  "canceled",
  "skipped",
]);
export type TaskState = z.infer<typeof taskStateSchema>;

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageStatusSchema = z.enum(["pending", "streaming", "completed", "failed"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const workspaceRootSchema = z.object({
  id: entityIdSchema,
  projectId: entityIdSchema,
  path: z.string().min(1),
  canonicalPath: z.string().min(1),
  displayName: z.string().min(1),
  writable: z.boolean(),
  createdAt: isoDateSchema,
});
export type WorkspaceRoot = z.infer<typeof workspaceRootSchema>;

export const projectSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(120),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  lastOpenedAt: isoDateSchema,
  roots: z.array(workspaceRootSchema),
});
export type Project = z.infer<typeof projectSchema>;

export const attachmentSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  localPath: z.string().min(1),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const conversationSchema = z.object({
  id: entityIdSchema,
  projectId: entityIdSchema,
  title: z.string().min(1).max(200),
  mode: runModeSchema,
  sessionKind: sessionKindSchema,
  providerId: z.string().min(1).nullable(),
  providerConnectionId: entityIdSchema.nullable(),
  modelId: z.string().min(1).nullable(),
  workspaceRootId: entityIdSchema.nullable(),
  providerSessionId: z.string().min(1).nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageSchema = z.object({
  id: entityIdSchema,
  conversationId: entityIdSchema,
  runId: entityIdSchema.nullable(),
  role: messageRoleSchema,
  content: z.string(),
  status: messageStatusSchema,
  attachments: z.array(attachmentSchema),
  providerMessageId: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const modelSelectionSchema = z.object({
  providerId: z.string().min(1),
  connectionId: entityIdSchema.optional(),
  modelId: z.string().min(1),
  effort: effortSchema.optional(),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const permissionSpecSchema = z.object({
  readWorkspace: z.boolean().default(true),
  writeWorkspace: z.boolean().default(false),
  runCommands: z.boolean().default(false),
  network: z.boolean().default(false),
  allowedCommands: z.array(z.string().min(1)).default([]),
  deniedCommands: z
    .array(z.string().min(1))
    .default(["sudo", "su", "ssh", "scp", "rsync", "curl", "wget", "docker", "kubectl"]),
});
export type PermissionSpec = z.infer<typeof permissionSpecSchema>;

export const budgetSpecSchema = z.object({
  maxTokens: z.number().int().positive().nullable().default(null),
  maxCostUsd: z.number().positive().nullable().default(null),
  maxDurationMinutes: z.number().int().positive().default(60),
  maxTurns: z.number().int().positive().default(24),
});
export type BudgetSpec = z.infer<typeof budgetSpecSchema>;

export const commandSpecSchema = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000),
});
export type CommandSpec = z.infer<typeof commandSpecSchema>;

export const taskRoleSchema = z.enum([
  "implementer",
  "tester",
  "reviewer",
  "researcher",
  "integrator",
]);
export type TaskRole = z.infer<typeof taskRoleSchema>;

export const taskSpecSchema = z.object({
  id: entityIdSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  role: taskRoleSchema,
  dependencies: z.array(entityIdSchema).default([]),
  workspaceRootId: entityIdSchema,
  workspaceStrategy: z.enum(["worktree", "shared-readonly", "single-writer"]),
  model: modelSelectionSchema,
  tools: z.array(z.string().min(1)).default([]),
  validationCommands: z.array(commandSpecSchema).default([]),
  successCriteria: z.array(z.string().min(1)).min(1),
  estimatedMinutes: z.number().int().positive().optional(),
});
export type TaskSpec = z.infer<typeof taskSpecSchema>;

export const planSpecSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    version: z.number().int().positive(),
    summary: z.string().min(1),
    assumptions: z.array(z.string().min(1)).default([]),
    risks: z.array(z.string().min(1)).default([]),
    successCriteria: z.array(z.string().min(1)).min(1),
    tasks: z.array(taskSpecSchema).min(1),
    createdAt: isoDateSchema,
  })
  .superRefine((plan, context) => {
    const ids = new Set(plan.tasks.map((task) => task.id));
    if (ids.size !== plan.tasks.length) {
      context.addIssue({ code: "custom", message: "Task ids must be unique", path: ["tasks"] });
    }
    for (const [index, task] of plan.tasks.entries()) {
      for (const dependency of task.dependencies) {
        if (!ids.has(dependency)) {
          context.addIssue({
            code: "custom",
            message: `Unknown dependency: ${dependency}`,
            path: ["tasks", index, "dependencies"],
          });
        }
        if (dependency === task.id) {
          context.addIssue({
            code: "custom",
            message: "A task cannot depend on itself",
            path: ["tasks", index, "dependencies"],
          });
        }
      }
    }
  });
export type PlanSpec = z.infer<typeof planSpecSchema>;

export const analysisResultSchema = z.object({
  objective: z.string().min(1),
  risks: z.array(z.string().min(1)),
  requiredCapabilities: z.array(z.string().min(1)),
  recommendedPlanner: modelSelectionSchema,
  rationale: z.string().min(1),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const runSpecSchema = z.object({
  id: entityIdSchema,
  mode: runModeSchema,
  projectId: entityIdSchema,
  conversationId: entityIdSchema,
  workspaceRootIds: z.array(entityIdSchema).min(1),
  prompt: z.string().min(1),
  requestedModel: modelSelectionSchema.nullable(),
  roleModels: z.record(z.string(), modelSelectionSchema).default({}),
  permissions: permissionSpecSchema,
  budget: budgetSpecSchema,
  concurrency: z.number().int().positive().max(16).default(4),
  createdAt: isoDateSchema,
});
export type RunSpec = z.infer<typeof runSpecSchema>;

export const runSchema = z.object({
  id: entityIdSchema,
  projectId: entityIdSchema,
  conversationId: entityIdSchema,
  mode: runModeSchema,
  state: runStateSchema,
  spec: runSpecSchema,
  currentPlanVersion: z.number().int().positive().nullable(),
  integrationBranch: z.string().nullable(),
  integrationPath: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  startedAt: isoDateSchema.nullable(),
  finishedAt: isoDateSchema.nullable(),
});
export type Run = z.infer<typeof runSchema>;

export const taskRunSchema = z.object({
  id: entityIdSchema,
  runId: entityIdSchema,
  planVersion: z.number().int().positive(),
  taskId: entityIdSchema,
  spec: taskSpecSchema,
  state: taskStateSchema,
  attempt: z.number().int().positive(),
  providerSessionId: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  startedAt: isoDateSchema.nullable(),
  finishedAt: isoDateSchema.nullable(),
});
export type TaskRun = z.infer<typeof taskRunSchema>;

export interface RunDetail {
  run: Run;
  plans: PlanSpec[];
  tasks: TaskRun[];
}

export const appSettingsSchema = z.object({
  locale: z.enum(["pt-BR", "en"]).default("pt-BR"),
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  globalConcurrency: z.number().int().min(1).max(16).default(4),
  subscriptionRouting: z.enum(["least-active", "priority", "round-robin"]).default("priority"),
  autoUpdateEnabled: z.boolean().default(true),
  updateChannel: z.enum(["stable", "beta"]).default("stable"),
  telemetryEnabled: z.boolean().default(false),
  defaultMode: runModeSchema.default("maestro"),
  defaultModels: z.record(z.string(), modelSelectionSchema).default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  locale: "pt-BR",
  theme: "dark",
  globalConcurrency: 4,
  subscriptionRouting: "priority",
  autoUpdateEnabled: true,
  updateChannel: "stable",
  telemetryEnabled: false,
  defaultMode: "maestro",
  defaultModels: {
    maestro: { providerId: "anthropic", modelId: "claude-fable-5", effort: "high" },
    analyst: { providerId: "anthropic", modelId: "claude-fable-5", effort: "medium" },
    planner: { providerId: "anthropic", modelId: "claude-fable-5", effort: "high" },
    implementer: { providerId: "codex", modelId: "default", effort: "high" },
    reviewer: { providerId: "claude-code", modelId: "sonnet", effort: "high" },
  },
};
