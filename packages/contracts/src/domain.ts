import { z } from "zod";

export const entityIdSchema = z.string().min(1).max(128);
export const isoDateSchema = z.string().datetime({ offset: true });

export const runModeSchema = z.enum(["maestro", "agent", "chat"]);
export type RunMode = z.infer<typeof runModeSchema>;

export const sessionKindSchema = z.enum(["structured", "pty"]);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const effortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof effortSchema>;

export const tokenOptimizationModeSchema = z.enum(["off", "balanced", "aggressive"]);
export type TokenOptimizationMode = z.infer<typeof tokenOptimizationModeSchema>;

export const runStateSchema = z.enum([
  "discovering",
  "awaiting_clarification",
  "researching",
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

export const contextAssetSourceSchema = z.enum(["upload", "workspace", "clipboard", "recording"]);
export type ContextAssetSource = z.infer<typeof contextAssetSourceSchema>;

export const contextAssetKindSchema = z.enum([
  "image",
  "document",
  "text",
  "audio",
  "video",
  "folder",
  "unknown",
]);
export type ContextAssetKind = z.infer<typeof contextAssetKindSchema>;

export const contextAssetStatusSchema = z.enum([
  "staging",
  "processing",
  "needs_model",
  "ready",
  "error",
  "missing",
]);
export type ContextAssetStatus = z.infer<typeof contextAssetStatusSchema>;

export const contextAssetChangeStateSchema = z.enum([
  "not_applicable",
  "current",
  "changed",
  "missing",
]);
export type ContextAssetChangeState = z.infer<typeof contextAssetChangeStateSchema>;

/** Renderer-safe asset metadata. Private paths never cross IPC. */
export const contextAssetSummarySchema = z.object({
  id: entityIdSchema,
  projectId: entityIdSchema,
  conversationId: entityIdSchema,
  source: contextAssetSourceSchema,
  kind: contextAssetKindSchema,
  status: contextAssetStatusSchema,
  changeState: contextAssetChangeStateSchema,
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  workspaceRootId: entityIdSchema.nullable(),
  relativePath: z.string().nullable(),
  contentHash: z.string().nullable(),
  sourceModifiedAt: isoDateSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  pageCount: z.number().int().positive().nullable(),
  previewUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  requiresVision: z.boolean(),
  extractedTextAvailable: z.boolean(),
  transcription: z.string().nullable(),
  warning: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type ContextAssetSummary = z.infer<typeof contextAssetSummarySchema>;

export const contextItemInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asset"), assetId: entityIdSchema }).strict(),
  z
    .object({
      type: z.literal("workspace"),
      workspaceRootId: entityIdSchema,
      relativePath: z.string().min(1).max(8_192),
      kind: z.enum(["file", "directory"]),
    })
    .strict(),
]);
export type ContextItemInput = z.infer<typeof contextItemInputSchema>;

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
  /** Active branch in the additive session graph. Missing on pre-v5 payloads. */
  activeBranchId: entityIdSchema.nullable().optional(),
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
  contextAssets: z.array(contextAssetSummarySchema).default([]),
  providerMessageId: z.string().nullable(),
  /** Branch ownership is additive; legacy messages are backfilled into the root branch. */
  branchId: entityIdSchema.nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Message = z.infer<typeof messageSchema>;

export const sessionBranchSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    parentBranchId: entityIdSchema.nullable(),
    forkedFromTurnId: entityIdSchema.nullable(),
    name: z.string().min(1).max(120),
    isRoot: z.boolean(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
export type SessionBranch = z.infer<typeof sessionBranchSchema>;

export const artifactKindSchema = z.enum(["markdown", "code", "diff", "json", "html", "svg"]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactVersionSchema = z
  .object({
    id: entityIdSchema,
    artifactId: entityIdSchema,
    version: z.number().int().positive(),
    content: z.string(),
    contentHash: z.string().min(1),
    createdBy: z.enum(["user", "assistant", "tool"]),
    sourceEventId: entityIdSchema.nullable(),
    createdAt: isoDateSchema,
  })
  .strict();
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

export const artifactSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    sessionId: entityIdSchema.nullable(),
    branchId: entityIdSchema.nullable(),
    turnId: entityIdSchema.nullable(),
    title: z.string().min(1).max(240),
    kind: artifactKindSchema,
    language: z.string().max(80).nullable(),
    mimeType: z.string().min(1).max(200),
    currentVersion: z.number().int().positive(),
    pinned: z.boolean(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
export type Artifact = z.infer<typeof artifactSchema>;

export const sourceSnapshotSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    url: z.string().url().max(8_192),
    title: z.string().min(1).max(500),
    excerpt: z.string().max(20_000),
    contentHash: z.string().min(1),
    accessedAt: isoDateSchema,
    provider: z.string().min(1).max(120),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const citationSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    sessionId: entityIdSchema,
    branchId: entityIdSchema.nullable(),
    turnId: entityIdSchema.nullable(),
    messageId: entityIdSchema.nullable(),
    sourceSnapshotId: entityIdSchema,
    responseStart: z.number().int().nonnegative().nullable(),
    responseEnd: z.number().int().nonnegative().nullable(),
    quote: z.string().max(2_000).nullable(),
    createdAt: isoDateSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.responseStart === null ||
      value.responseEnd === null ||
      value.responseEnd >= value.responseStart,
    { message: "O intervalo da citação é inválido." },
  );
export type Citation = z.infer<typeof citationSchema>;

export const memoryScopeSchema = z.enum(["project", "personal"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryStateSchema = z.enum(["suggested", "accepted", "rejected", "forgotten"]);
export type MemoryState = z.infer<typeof memoryStateSchema>;

export const memoryRecordSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema.nullable(),
    scope: memoryScopeSchema,
    kind: z.enum(["preference", "decision", "fact", "constraint", "instruction"]),
    content: z.string().min(1).max(20_000),
    provenance: z
      .object({
        sessionId: entityIdSchema.nullable(),
        turnId: entityIdSchema.nullable(),
        messageId: entityIdSchema.nullable(),
        source: z.enum(["user", "assistant", "import", "system"]),
        excerpt: z.string().max(2_000).nullable(),
      })
      .strict(),
    confidence: z.number().min(0).max(1),
    state: memoryStateSchema,
    expiresAt: isoDateSchema.nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()
  .refine((value) => value.scope !== "project" || value.projectId !== null, {
    message: "Memórias de projeto precisam de um projeto.",
  });
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const connectorSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    name: z.string().min(1).max(120),
    kind: z.enum(["mcp_stdio", "mcp_http", "github", "brave_search"]),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).default({}),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
export type Connector = z.infer<typeof connectorSchema>;

export const connectorGrantSchema = z
  .object({
    id: entityIdSchema,
    connectorId: entityIdSchema,
    capability: z.enum(["read", "write", "network", "external_mutation"]),
    scope: z.record(z.string(), z.unknown()).default({}),
    granted: z.boolean(),
    expiresAt: isoDateSchema.nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
export type ConnectorGrant = z.infer<typeof connectorGrantSchema>;

export const connectorInvocationSchema = z
  .object({
    id: entityIdSchema,
    connectorId: entityIdSchema,
    runId: entityIdSchema.nullable(),
    turnId: entityIdSchema.nullable(),
    operation: z.string().min(1).max(240),
    mutability: z.enum(["read", "workspace", "external"]),
    status: z.enum(["pending", "running", "completed", "failed", "denied"]),
    inputSummary: z.string().max(4_000),
    outputSummary: z.string().max(20_000).nullable(),
    error: z.string().max(20_000).nullable(),
    startedAt: isoDateSchema,
    finishedAt: isoDateSchema.nullable(),
  })
  .strict();
export type ConnectorInvocation = z.infer<typeof connectorInvocationSchema>;

export const autonomyLevelSchema = z.enum(["observe", "review", "autopilot"]);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

export const autonomyProfileSchema = z
  .object({
    projectId: entityIdSchema,
    level: autonomyLevelSchema,
    allowedPaths: z.array(z.string().min(1)).default([]),
    allowedTools: z.array(z.string().min(1)).default([]),
    allowedCommands: z.array(z.string().min(1)).default([]),
    network: z.enum(["denied", "web", "full"]).default("denied"),
    maxCostUsd: z.number().nonnegative().nullable().default(null),
    maxTokens: z.number().int().positive().nullable().default(null),
    updatedAt: isoDateSchema,
  })
  .strict();
export type AutonomyProfile = z.infer<typeof autonomyProfileSchema>;

export const backgroundJobSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    sessionId: entityIdSchema.nullable(),
    branchId: entityIdSchema.nullable(),
    runId: entityIdSchema.nullable(),
    parentJobId: entityIdSchema.nullable(),
    title: z.string().min(1).max(240),
    kind: z.enum(["run", "agent", "research", "connector", "indexing"]),
    state: z.enum(["queued", "running", "blocked", "completed", "failed", "canceled"]),
    progress: z.number().min(0).max(1).nullable(),
    costUsd: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    detail: z.record(z.string(), z.unknown()).default({}),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    finishedAt: isoDateSchema.nullable(),
  })
  .strict();
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;

export const modelSelectionSchema = z.object({
  providerId: z.string().min(1),
  connectionId: entityIdSchema.optional(),
  modelId: z.string().min(1),
  effort: effortSchema.optional(),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const routingProfileSchema = z.enum(["fast", "economical", "deep"]);
export type RoutingProfile = z.infer<typeof routingProfileSchema>;

export const modelPreferenceSchema = z
  .object({
    mode: z.enum(["auto", "manual"]).default("auto"),
    profile: routingProfileSchema.default("economical"),
    pin: modelSelectionSchema.nullable().default(null),
    noFallback: z.boolean().default(false),
  })
  .strict();
export type ModelPreference = z.infer<typeof modelPreferenceSchema>;

export const turnPathSchema = z.enum(["answer", "research", "plan", "execute"]);
export type TurnPath = z.infer<typeof turnPathSchema>;

export const turnIntentSchema = z
  .object({
    path: turnPathSchema,
    category: z.enum([
      "simple_question",
      "workspace_question",
      "change_request",
      "approved_execution",
      "continuation",
    ]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
    requiresWorkspace: z.boolean(),
    requiresApproval: z.boolean(),
    materialDecisions: z.array(z.string().min(1)).default([]),
    requestedCapabilities: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type TurnIntent = z.infer<typeof turnIntentSchema>;

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

export const executablePolicySchema = z
  .object({
    executable: z.string().min(1),
    /** Exact argument prefix. Empty means any argument list for this executable. */
    argsPrefix: z.array(z.string()).default([]),
    cwdRoots: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type ExecutablePolicy = z.infer<typeof executablePolicySchema>;

export const executionPolicySchema = z
  .object({
    readableRoots: z.array(z.string().min(1)).default([]),
    writableRoots: z.array(z.string().min(1)).default([]),
    allowedTools: z.array(z.string().min(1)).default([]),
    allowedExecutables: z.array(executablePolicySchema).default([]),
    network: z.enum(["denied", "web", "full"]).default("denied"),
    externalMutations: z.boolean().default(false),
    writeApproved: z.boolean().default(false),
    approvalId: entityIdSchema.nullable().default(null),
    approvedPlanVersion: z.number().int().positive().nullable().default(null),
    scopeHash: z.string().min(1),
  })
  .strict();
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

export const toolMutabilitySchema = z.enum(["read", "workspace", "external"]);
export type ToolMutability = z.infer<typeof toolMutabilitySchema>;

export const toolDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
    title: z.string().min(1).max(160),
    description: z.string().min(1),
    category: z.enum([
      "filesystem",
      "search",
      "language",
      "command",
      "question",
      "agent",
      "skill",
      "mcp",
      "web",
    ]),
    mutability: toolMutabilitySchema,
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()).nullable().default(null),
    requiresApproval: z.boolean().default(false),
    idempotent: z.boolean().default(true),
  })
  .strict();
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export const toolCallStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "denied",
  "unknown_effect",
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolCallSchema = z
  .object({
    id: entityIdSchema,
    turnId: entityIdSchema,
    runId: entityIdSchema.nullable(),
    toolName: z.string().min(1),
    input: z.unknown(),
    status: toolCallStatusSchema,
    mutability: toolMutabilitySchema,
    idempotencyKey: z.string().min(1),
    checkpointId: entityIdSchema.nullable(),
    createdAt: isoDateSchema,
    startedAt: isoDateSchema.nullable(),
    finishedAt: isoDateSchema.nullable(),
  })
  .strict();
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolResultSchema = z
  .object({
    id: entityIdSchema,
    toolCallId: entityIdSchema,
    output: z.unknown(),
    isError: z.boolean(),
    error: z.string().nullable(),
    artifactRef: z.string().nullable(),
    truncated: z.boolean().default(false),
    contentHash: z.string().nullable(),
    createdAt: isoDateSchema,
  })
  .strict();
export type ToolResult = z.infer<typeof toolResultSchema>;

export const contextCheckpointSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    runId: entityIdSchema.nullable(),
    turnId: entityIdSchema,
    version: z.number().int().positive(),
    objective: z.string(),
    decisions: z.array(z.string()).default([]),
    progress: z.array(z.string()).default([]),
    pending: z.array(z.string()).default([]),
    entities: z.record(z.string(), z.string()).default({}),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            state: z.enum(["read", "planned", "modified", "validated", "unknown"]),
            contentHash: z.string().nullable().default(null),
          })
          .strict(),
      )
      .default([]),
    toolState: z.record(z.string(), z.unknown()).default({}),
    safeToResume: z.boolean().default(true),
    createdAt: isoDateSchema,
  })
  .strict();
export type ContextCheckpoint = z.infer<typeof contextCheckpointSchema>;

export const turnStateSchema = z.enum([
  "classified",
  "running",
  "awaiting_question",
  "awaiting_approval",
  "completed",
  "failed",
  "canceled",
]);
export type TurnState = z.infer<typeof turnStateSchema>;

export const turnSchema = z
  .object({
    id: entityIdSchema,
    conversationId: entityIdSchema,
    runId: entityIdSchema.nullable(),
    sequence: z.number().int().positive(),
    state: turnStateSchema,
    intent: turnIntentSchema,
    policy: executionPolicySchema,
    modelPreference: modelPreferenceSchema,
    selectedModel: modelSelectionSchema.nullable(),
    inputMessageId: entityIdSchema.nullable(),
    outputMessageId: entityIdSchema.nullable(),
    branchId: entityIdSchema.nullable().optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    completedAt: isoDateSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type Turn = z.infer<typeof turnSchema>;

export const turnItemSchema = z
  .object({
    id: entityIdSchema,
    turnId: entityIdSchema,
    sequence: z.number().int().nonnegative(),
    kind: z.enum([
      "message",
      "question",
      "plan",
      "tool_call",
      "tool_result",
      "checkpoint",
      "route",
      "metric",
      "error",
    ]),
    payload: z.unknown(),
    createdAt: isoDateSchema,
  })
  .strict();
export type TurnItem = z.infer<typeof turnItemSchema>;

const timelineBase = {
  id: entityIdSchema,
  sessionId: entityIdSchema,
  branchId: entityIdSchema.nullable(),
  turnId: entityIdSchema.nullable(),
  runId: entityIdSchema.nullable(),
  sequence: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
};

/** Renderer-facing, stable visual protocol. Messages and run events remain authoritative. */
export const timelineItemSchema = z.discriminatedUnion("kind", [
  z.object({ ...timelineBase, kind: z.literal("message"), message: messageSchema }).strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("question"),
      questions: z.array(z.lazy(() => maestroQuestionSchema)),
      status: z.enum(["pending", "answered"]),
    })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("research"),
      title: z.string(),
      summary: z.string(),
      status: z.enum(["running", "completed", "failed"]),
    })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("source"),
      source: sourceSnapshotSchema,
      citation: citationSchema.nullable(),
    })
    .strict(),
  z
    .object({ ...timelineBase, kind: z.literal("plan"), plan: z.lazy(() => planSpecSchema) })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("agent"),
      agentId: entityIdSchema,
      label: z.string(),
      status: z.enum(["queued", "running", "completed", "failed", "canceled"]),
      detail: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("tool"),
      name: z.string(),
      status: z.enum(["pending", "running", "completed", "failed", "denied"]),
      summary: z.string(),
    })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("approval"),
      approvalId: entityIdSchema,
      status: z.enum(["pending", "approved", "denied", "superseded"]),
      summary: z.string(),
    })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("diff"),
      path: z.string(),
      patch: z.string(),
      additions: z.number().int().nonnegative().nullable(),
      deletions: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("validation"),
      label: z.string(),
      status: z.enum(["running", "passed", "failed"]),
      detail: z.string().nullable(),
    })
    .strict(),
  z.object({ ...timelineBase, kind: z.literal("artifact"), artifact: artifactSchema }).strict(),
  z
    .object({ ...timelineBase, kind: z.literal("checkpoint"), checkpoint: contextCheckpointSchema })
    .strict(),
  z
    .object({
      ...timelineBase,
      kind: z.literal("error"),
      code: z.string(),
      message: z.string(),
      recoverable: z.boolean(),
    })
    .strict(),
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

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
    permissions: permissionSpecSchema.optional(),
    executionPolicy: executionPolicySchema.optional(),
    validationCommands: z.array(commandSpecSchema).optional(),
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

export const maestroQuestionSchema = z.object({
  id: entityIdSchema,
  question: z.string().min(1),
  reason: z.string().min(1),
  options: z.array(z.string().min(1)).max(5).default([]),
});
export type MaestroQuestion = z.infer<typeof maestroQuestionSchema>;

export const maestroDiscoverySchema = z.object({
  understanding: z.string().min(1),
  desiredOutcome: z.string().min(1),
  deliverable: z.string().min(1),
  audience: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  researchTopics: z.array(z.string().min(1)).default([]),
  questions: z.array(maestroQuestionSchema).default([]),
});
export type MaestroDiscovery = z.infer<typeof maestroDiscoverySchema>;

export const maestroResearchFindingSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  source: z.string().min(1),
});
export type MaestroResearchFinding = z.infer<typeof maestroResearchFindingSchema>;

export const maestroBriefSchema = z.object({
  summary: z.string().min(1),
  deliverable: z.string().min(1),
  userDecisions: z.array(z.string().min(1)).default([]),
  findings: z.array(maestroResearchFindingSchema).default([]),
  scope: z.array(z.string().min(1)).min(1),
  outOfScope: z.array(z.string().min(1)).default([]),
  successCriteria: z.array(z.string().min(1)).min(1),
  remainingRisks: z.array(z.string().min(1)).default([]),
  researchLimits: z.array(z.string().min(1)).default([]),
});
export type MaestroBrief = z.infer<typeof maestroBriefSchema>;

export const runSpecSchema = z.object({
  id: entityIdSchema,
  mode: runModeSchema,
  projectId: entityIdSchema,
  conversationId: entityIdSchema,
  workspaceRootIds: z.array(entityIdSchema).min(1),
  prompt: z.string().min(1),
  contextAssetIds: z.array(entityIdSchema).default([]),
  /** Compact continuity brief generated locally when a conversation changes models. */
  contextHandoff: z.string().min(1).nullable().optional(),
  requestedModel: modelSelectionSchema.nullable(),
  roleModels: z.record(z.string(), modelSelectionSchema).default({}),
  permissions: permissionSpecSchema,
  budget: budgetSpecSchema,
  concurrency: z.number().int().positive().max(16).default(4),
  createdAt: isoDateSchema,
  branchId: entityIdSchema.nullable().optional(),
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
  branchId: entityIdSchema.nullable().optional(),
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

const appSettingsFields = {
  locale: z.enum(["pt-BR", "en"]),
  theme: z.enum(["dark", "light", "system"]),
  globalConcurrency: z.number().int().min(1).max(16),
  subscriptionRouting: z.enum(["least-active", "priority", "round-robin"]),
  autoUpdateEnabled: z.boolean(),
  updateChannel: z.enum(["stable", "beta"]),
  telemetryEnabled: z.boolean(),
  tokenOptimizationMode: tokenOptimizationModeSchema,
  defaultMode: runModeSchema,
  defaultRoutingProfile: routingProfileSchema,
  modelPins: z.record(z.string(), modelSelectionSchema),
  noFallback: z.boolean(),
  personalMemoryEnabled: z.boolean(),
  semanticMemoryEnabled: z.boolean(),
  defaultModels: z.record(z.string(), modelSelectionSchema),
};

export const appSettingsSchema = z.object({
  locale: appSettingsFields.locale.default("pt-BR"),
  theme: appSettingsFields.theme.default("dark"),
  globalConcurrency: appSettingsFields.globalConcurrency.default(4),
  subscriptionRouting: appSettingsFields.subscriptionRouting.default("priority"),
  autoUpdateEnabled: appSettingsFields.autoUpdateEnabled.default(true),
  updateChannel: appSettingsFields.updateChannel.default("stable"),
  telemetryEnabled: appSettingsFields.telemetryEnabled.default(false),
  tokenOptimizationMode: appSettingsFields.tokenOptimizationMode.default("balanced"),
  defaultMode: appSettingsFields.defaultMode.default("maestro"),
  defaultRoutingProfile: appSettingsFields.defaultRoutingProfile.default("economical"),
  modelPins: appSettingsFields.modelPins.default({}),
  noFallback: appSettingsFields.noFallback.default(false),
  personalMemoryEnabled: appSettingsFields.personalMemoryEnabled.default(false),
  semanticMemoryEnabled: appSettingsFields.semanticMemoryEnabled.default(false),
  defaultModels: appSettingsFields.defaultModels.default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsUpdateSchema = z.object(appSettingsFields).partial().strict();

export const DEFAULT_APP_SETTINGS: AppSettings = {
  locale: "pt-BR",
  theme: "dark",
  globalConcurrency: 4,
  subscriptionRouting: "priority",
  autoUpdateEnabled: true,
  updateChannel: "stable",
  telemetryEnabled: false,
  tokenOptimizationMode: "balanced",
  defaultMode: "maestro",
  defaultRoutingProfile: "economical",
  modelPins: {},
  noFallback: false,
  personalMemoryEnabled: false,
  semanticMemoryEnabled: false,
  defaultModels: {
    maestro: { providerId: "anthropic", modelId: "claude-fable-5", effort: "high" },
    analyst: { providerId: "anthropic", modelId: "claude-fable-5", effort: "medium" },
    planner: { providerId: "anthropic", modelId: "claude-fable-5", effort: "high" },
    implementer: { providerId: "codex", modelId: "default", effort: "high" },
    reviewer: { providerId: "claude-code", modelId: "sonnet", effort: "high" },
  },
};
