import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { z } from "zod";
import {
  appSettingsUpdateSchema,
  artifactKindSchema,
  autonomyLevelSchema,
  contextItemInputSchema,
  effortSchema,
  entityIdSchema,
  IPC_CHANNELS,
  modelPreferenceSchema,
  modelSelectionSchema,
  runModeSchema,
  sessionKindSchema,
  turnPathSchema,
  type ConfigureConnectorInput,
  type ConfigureProviderInput,
  type ConnectorGrantInput,
  type AnswerQuestionsInput,
  type CompactTurnInput,
  type CreateProviderConnectionInput,
  type CreateConversationInput,
  type CreateProjectInput,
  type CreateArtifactInput,
  type EditTurnInput,
  type ForkAtTurnInput,
  type ForkConversationInput,
  type GranularApprovalInput,
  type MemoryFilter,
  type SaveMemoryInput,
  type PrepareWorkspaceContextInput,
  type SearchWorkspaceContextInput,
  type SendMessageInput,
  type SendTurnInput,
  type RetryTurnInput,
  type StageRecordedAudioInput,
  type SteerTurnInput,
  type SwitchModelInput,
  type SteerJobInput,
  type UpdateArtifactInput,
  type UpdateMemoryInput,
  type UpdateConversationInput,
  type UpdateProjectInput,
  type UpdateProviderConnectionInput,
} from "@maestro/contracts";
import { MaestroError } from "@maestro/core";
import type { ApplicationService } from "./services/application.js";

const createProjectSchema = z
  .object({ name: z.string().max(120), directory: z.string().min(1).max(8_192) })
  .strict();
const updateProjectSchema = z
  .object({ projectId: entityIdSchema, name: z.string().trim().min(1).max(120) })
  .strict();
const createConversationSchema = z
  .object({
    projectId: entityIdSchema,
    title: z.string().max(200).optional(),
    mode: runModeSchema,
    sessionKind: sessionKindSchema,
    providerId: z.string().min(1).max(120).optional(),
    providerConnectionId: entityIdSchema.optional(),
    modelId: z.string().min(1).max(200).optional(),
    workspaceRootId: entityIdSchema,
  })
  .strict();
const updateConversationSchema = z
  .object({ conversationId: entityIdSchema, title: z.string().trim().min(1).max(200) })
  .strict();
const sendMessageFields = {
  conversationId: entityIdSchema,
  content: z.string().max(2_000_000),
  mode: runModeSchema,
  sessionKind: sessionKindSchema,
  providerId: z.string().min(1).max(120),
  providerConnectionId: entityIdSchema.optional(),
  modelId: z.string().min(1).max(200),
  effort: effortSchema,
  workspaceRootId: entityIdSchema,
  contextItems: z.array(contextItemInputSchema).max(20),
  modelPreference: modelPreferenceSchema.optional(),
  strategyOverride: turnPathSchema.optional(),
  branchId: entityIdSchema.optional(),
};
const sendMessageSchema = z
  .object(sendMessageFields)
  .strict()
  .refine((value) => value.content.trim().length > 0 || value.contextItems.length > 0, {
    message: "Escreva uma mensagem ou adicione ao menos um item de contexto.",
  });
const editTurnSchema = z
  .object({ ...sendMessageFields, turnId: entityIdSchema })
  .strict()
  .refine((value) => value.content.trim().length > 0 || value.contextItems.length > 0, {
    message: "Escreva uma mensagem ou adicione ao menos um item de contexto.",
  });
const retryTurnSchema = z
  .object({ turnId: entityIdSchema, strategyOverride: turnPathSchema.optional() })
  .strict();
const forkAtTurnSchema = z
  .object({
    sessionId: entityIdSchema,
    turnId: entityIdSchema,
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const createArtifactSchema = z
  .object({
    projectId: entityIdSchema,
    sessionId: entityIdSchema.optional(),
    branchId: entityIdSchema.optional(),
    turnId: entityIdSchema.optional(),
    title: z.string().trim().min(1).max(240),
    kind: artifactKindSchema,
    language: z.string().max(80).optional(),
    mimeType: z.string().min(1).max(200).optional(),
    content: z.string().max(20_000_000),
    pinned: z.boolean().optional(),
    createdBy: z.enum(["user", "assistant", "tool"]).optional(),
  })
  .strict();
const updateArtifactSchema = z
  .object({
    artifactId: entityIdSchema,
    content: z.string().max(20_000_000),
    title: z.string().trim().min(1).max(240).optional(),
    language: z.string().max(80).nullable().optional(),
    pinned: z.boolean().optional(),
    createdBy: z.enum(["user", "assistant", "tool"]).optional(),
    sourceEventId: entityIdSchema.optional(),
  })
  .strict();
const memoryFilterSchema = z
  .object({
    projectId: entityIdSchema.optional(),
    scope: z.enum(["project", "personal"]).optional(),
    state: z.enum(["suggested", "accepted", "rejected", "forgotten"]).optional(),
    query: z.string().max(500).optional(),
  })
  .strict();
const updateMemorySchema = z
  .object({
    memoryId: entityIdSchema,
    content: z.string().trim().min(1).max(20_000).optional(),
    confidence: z.number().min(0).max(1).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const saveMemorySchema = z
  .object({
    projectId: entityIdSchema,
    sessionId: entityIdSchema,
    turnId: entityIdSchema.nullable().optional(),
    messageId: entityIdSchema.nullable().optional(),
    kind: z.enum(["preference", "decision", "fact", "constraint", "instruction"]).optional(),
    content: z.string().trim().min(1).max(20_000),
  })
  .strict();
const configureConnectorSchema = z
  .object({
    projectId: entityIdSchema,
    connectorId: entityIdSchema.optional(),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["mcp_stdio", "mcp_http", "github", "brave_search"]),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()),
    credential: z.string().max(20_000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !Object.keys(value.config).some((key) => /token|secret|password|api.?key/i.test(key)),
    { message: "Segredos de conectores devem ser armazenados no vault." },
  );
const connectorGrantInputSchema = z
  .object({
    connectorId: entityIdSchema,
    capability: z.enum(["read", "write", "network", "external_mutation"]),
    scope: z.record(z.string(), z.unknown()).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const steerJobSchema = z
  .object({
    jobId: entityIdSchema,
    action: z.enum(["pause", "resume", "cancel", "prioritize"]),
    message: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();
const searchWorkspaceContextSchema = z
  .object({
    projectId: entityIdSchema,
    query: z.string().max(500),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const prepareWorkspaceContextSchema = z
  .object({
    conversationId: entityIdSchema,
    candidates: z
      .array(
        z
          .object({
            workspaceRootId: entityIdSchema,
            relativePath: z.string().min(1).max(8_192),
            kind: z.enum(["file", "directory"]),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const stageRecordingSchema = z
  .object({
    conversationId: entityIdSchema,
    data: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 2 * 1024 * 1024 * 1024),
    mimeType: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => /^audio\/(webm|ogg|mp4)(?:;|$)/i.test(value), {
        message: "A gravação precisa usar um formato de áudio compatível.",
      }),
    durationMs: z
      .number()
      .int()
      .nonnegative()
      .max(24 * 60 * 60_000)
      .optional(),
  })
  .strict();
const configureProviderSchema = z
  .object({
    providerId: z.string().min(1).max(120),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict();
const createProviderConnectionSchema = z
  .object({
    providerId: z.enum(["codex", "claude-code"]),
    name: z.string().trim().min(1).max(120),
    priority: z.number().int().min(0).max(10_000).optional(),
    concurrencyLimit: z.number().int().min(1).max(16).optional(),
  })
  .strict();
const updateProviderConnectionSchema = z
  .object({
    connectionId: entityIdSchema,
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    concurrencyLimit: z.number().int().min(1).max(16).optional(),
  })
  .strict();
const reorderProviderConnectionsSchema = z
  .array(entityIdSchema)
  .min(1)
  .max(500)
  .refine((connectionIds) => new Set(connectionIds).size === connectionIds.length, {
    message: "A ordem das contas não pode conter itens duplicados.",
  });

const granularApprovalSchema = z
  .object({
    runId: entityIdSchema,
    planVersion: z.number().int().positive(),
    allowedTools: z.array(z.string().min(1).max(128)).max(128).optional(),
    allowedCommands: z.array(z.string().min(1).max(8_192)).max(128).optional(),
    writablePaths: z.array(z.string().min(1).max(8_192)).max(128).optional(),
    network: z.enum(["denied", "web", "full"]).optional(),
  })
  .strict();
const steerTurnSchema = z
  .object({ runId: entityIdSchema, content: z.string().trim().min(1).max(100_000) })
  .strict();
const answerQuestionsSchema = z
  .object({
    runId: entityIdSchema,
    answers: z
      .array(
        z
          .object({
            questionId: z.string().min(1).max(200),
            selectedOption: z.string().max(2_000).optional(),
            freeText: z.string().max(20_000).optional(),
          })
          .strict()
          .refine((answer) => Boolean(answer.selectedOption || answer.freeText), {
            message: "Cada pergunta precisa de uma opção ou resposta livre.",
          }),
      )
      .min(1)
      .max(32),
  })
  .strict();
const switchModelSchema = z
  .object({
    runId: entityIdSchema,
    selection: modelSelectionSchema,
    timing: z.enum(["next_checkpoint", "immediate"]),
    noFallback: z.boolean().optional(),
  })
  .strict();
const compactContextSchema = z
  .object({
    conversationId: entityIdSchema,
    runId: entityIdSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict();
const forkConversationSchema = z
  .object({
    conversationId: entityIdSchema,
    checkpointId: entityIdSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export function registerIpc(application: ApplicationService, window: BrowserWindow): () => void {
  const channels: string[] = [];
  const handle = <T extends unknown[], R>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: T) => R | Promise<R>,
  ) => {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args: T) => {
      if (
        event.sender.id !== window.webContents.id ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        throw new MaestroError("UNTRUSTED_IPC_SENDER", "Origem IPC não autorizada.");
      }
      return handler(event, ...args);
    });
  };

  handle(IPC_CHANNELS.bootstrap, () => application.bootstrap());
  handle(IPC_CHANNELS.selectDirectory, () => application.selectDirectory());
  handle(IPC_CHANNELS.contextSelectFiles, (_event, conversationId: string) =>
    application.selectContextFiles(entityIdSchema.parse(conversationId)),
  );
  handle(IPC_CHANNELS.contextSelectFolder, (_event, conversationId: string) =>
    application.selectContextFolder(entityIdSchema.parse(conversationId)),
  );
  handle(IPC_CHANNELS.contextStageDrop, (_event, conversationId: string, paths: string[]) =>
    application.stageDroppedFiles(
      entityIdSchema.parse(conversationId),
      z.array(z.string().min(1).max(8_192)).max(20).parse(paths),
    ),
  );
  handle(IPC_CHANNELS.contextStageClipboard, (_event, conversationId: string) =>
    application.stageClipboard(entityIdSchema.parse(conversationId)),
  );
  handle(IPC_CHANNELS.contextStageRecording, (_event, input: StageRecordedAudioInput) => {
    const parsed = stageRecordingSchema.parse(input);
    return application.stageRecordedAudio({
      conversationId: parsed.conversationId,
      data: parsed.data,
      mimeType: parsed.mimeType,
      ...(parsed.durationMs === undefined ? {} : { durationMs: parsed.durationMs }),
    });
  });
  handle(IPC_CHANNELS.contextSearchWorkspace, (_event, input: SearchWorkspaceContextInput) => {
    const parsed = searchWorkspaceContextSchema.parse(input);
    return application.searchWorkspaceContext({
      projectId: parsed.projectId,
      query: parsed.query,
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
    });
  });
  handle(IPC_CHANNELS.contextPrepareWorkspace, (_event, input: PrepareWorkspaceContextInput) =>
    application.prepareWorkspaceContext(prepareWorkspaceContextSchema.parse(input)),
  );
  handle(IPC_CHANNELS.contextList, (_event, conversationId: string) =>
    application.listContextAssets(entityIdSchema.parse(conversationId)),
  );
  handle(IPC_CHANNELS.contextRemove, (_event, conversationId: string, assetId: string) =>
    application.removeContextAsset(
      entityIdSchema.parse(conversationId),
      entityIdSchema.parse(assetId),
    ),
  );
  handle(IPC_CHANNELS.localModelState, () => application.getLocalModelState());
  handle(IPC_CHANNELS.localModelDownload, () => application.downloadLocalModel());
  handle(IPC_CHANNELS.localModelCancel, () => application.cancelLocalModelDownload());
  handle(IPC_CHANNELS.localModelRemove, () => application.removeLocalModel());
  handle(IPC_CHANNELS.projectCreate, (_event, input: CreateProjectInput) =>
    application.createProject(createProjectSchema.parse(input)),
  );
  handle(IPC_CHANNELS.projectList, () => application.listProjects());
  handle(IPC_CHANNELS.projectSelect, (_event, projectId: string) =>
    application.selectProject(entityIdSchema.parse(projectId)),
  );
  handle(IPC_CHANNELS.projectUpdate, (_event, input: UpdateProjectInput) =>
    application.updateProject(updateProjectSchema.parse(input)),
  );
  handle(IPC_CHANNELS.projectDelete, (_event, projectId: string) =>
    application.deleteProject(entityIdSchema.parse(projectId)),
  );
  handle(IPC_CHANNELS.projectAddRoot, (_event, projectId: string, directory: string) =>
    application.addProjectRoot(
      entityIdSchema.parse(projectId),
      z.string().min(1).max(8_192).parse(directory),
    ),
  );
  handle(IPC_CHANNELS.projectRemoveRoot, (_event, projectId: string, rootId: string) =>
    application.removeProjectRoot(entityIdSchema.parse(projectId), entityIdSchema.parse(rootId)),
  );
  handle(IPC_CHANNELS.conversationCreate, (_event, input: CreateConversationInput) => {
    const parsed = createConversationSchema.parse(input);
    return application.createConversation({
      projectId: parsed.projectId,
      mode: parsed.mode,
      sessionKind: parsed.sessionKind,
      workspaceRootId: parsed.workspaceRootId,
      ...(parsed.title !== undefined ? { title: parsed.title } : {}),
      ...(parsed.providerId !== undefined ? { providerId: parsed.providerId } : {}),
      ...(parsed.providerConnectionId !== undefined
        ? { providerConnectionId: parsed.providerConnectionId }
        : {}),
      ...(parsed.modelId !== undefined ? { modelId: parsed.modelId } : {}),
    });
  });
  handle(IPC_CHANNELS.conversationList, (_event, projectId: string, limit?: number) =>
    application.listConversations(
      entityIdSchema.parse(projectId),
      z.number().int().min(1).max(500).optional().parse(limit),
    ),
  );
  handle(IPC_CHANNELS.conversationGet, (_event, conversationId: string) =>
    application.getConversation(entityIdSchema.parse(conversationId)),
  );
  handle(IPC_CHANNELS.conversationUpdate, (_event, input: UpdateConversationInput) =>
    application.updateConversation(updateConversationSchema.parse(input)),
  );
  handle(IPC_CHANNELS.conversationDelete, (_event, conversationId: string) =>
    application.deleteConversation(entityIdSchema.parse(conversationId)),
  );
  handle(IPC_CHANNELS.messageSend, (_event, input: SendMessageInput) => {
    const parsed = sendMessageSchema.parse(input);
    return application.sendMessage({
      conversationId: parsed.conversationId,
      content: parsed.content,
      mode: parsed.mode,
      sessionKind: parsed.sessionKind,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      effort: parsed.effort,
      workspaceRootId: parsed.workspaceRootId,
      contextItems: parsed.contextItems,
      ...(parsed.providerConnectionId ? { providerConnectionId: parsed.providerConnectionId } : {}),
      ...(parsed.modelPreference ? { modelPreference: parsed.modelPreference } : {}),
      ...(parsed.strategyOverride ? { strategyOverride: parsed.strategyOverride } : {}),
      ...(parsed.branchId ? { branchId: parsed.branchId } : {}),
    });
  });
  handle(
    IPC_CHANNELS.sessionTimeline,
    (_event, sessionId: string, cursor?: number, limit?: number, branchId?: string) =>
      application.getSessionTimeline(
        entityIdSchema.parse(sessionId),
        z.number().int().nonnegative().optional().parse(cursor),
        z.number().int().min(1).max(1_000).optional().parse(limit),
        entityIdSchema.optional().parse(branchId),
      ),
  );
  handle(IPC_CHANNELS.turnSend, (_event, input: SendTurnInput) =>
    application.sendTurn(sendMessageSchema.parse(input) as SendTurnInput),
  );
  handle(IPC_CHANNELS.turnEdit, (_event, input: EditTurnInput) =>
    application.editTurn(editTurnSchema.parse(input) as EditTurnInput),
  );
  handle(IPC_CHANNELS.turnRetry, (_event, input: RetryTurnInput) =>
    application.retryTurn(retryTurnSchema.parse(input) as RetryTurnInput),
  );
  handle(IPC_CHANNELS.turnFork, (_event, input: ForkAtTurnInput) =>
    application.forkAtTurn(forkAtTurnSchema.parse(input) as ForkAtTurnInput),
  );
  handle(IPC_CHANNELS.branchSwitch, (_event, sessionId: string, branchId: string) =>
    application.switchBranch(entityIdSchema.parse(sessionId), entityIdSchema.parse(branchId)),
  );
  handle(IPC_CHANNELS.artifactList, (_event, projectId: string, sessionId?: string) =>
    application.listArtifacts(
      entityIdSchema.parse(projectId),
      entityIdSchema.optional().parse(sessionId),
    ),
  );
  handle(IPC_CHANNELS.artifactOpen, (_event, artifactId: string) =>
    application.openArtifact(entityIdSchema.parse(artifactId)),
  );
  handle(IPC_CHANNELS.artifactCreate, (_event, input: CreateArtifactInput) =>
    application.createArtifact(createArtifactSchema.parse(input) as CreateArtifactInput),
  );
  handle(IPC_CHANNELS.artifactUpdate, (_event, input: UpdateArtifactInput) =>
    application.updateArtifact(updateArtifactSchema.parse(input) as UpdateArtifactInput),
  );
  handle(IPC_CHANNELS.artifactExport, (_event, artifactId: string, version?: number) =>
    application.exportArtifact(
      entityIdSchema.parse(artifactId),
      z.number().int().positive().optional().parse(version),
    ),
  );
  handle(IPC_CHANNELS.memoryList, (_event, filter: MemoryFilter) =>
    application.listMemories(memoryFilterSchema.parse(filter) as MemoryFilter),
  );
  handle(IPC_CHANNELS.memorySave, (_event, input: SaveMemoryInput) =>
    application.saveMemory(saveMemorySchema.parse(input) as SaveMemoryInput),
  );
  handle(IPC_CHANNELS.memoryAccept, (_event, memoryId: string) =>
    application.acceptMemory(entityIdSchema.parse(memoryId)),
  );
  handle(IPC_CHANNELS.memoryUpdate, (_event, input: UpdateMemoryInput) =>
    application.updateMemory(updateMemorySchema.parse(input) as UpdateMemoryInput),
  );
  handle(IPC_CHANNELS.memoryForget, (_event, memoryId: string) =>
    application.forgetMemory(entityIdSchema.parse(memoryId)),
  );
  handle(IPC_CHANNELS.connectorList, (_event, projectId: string) =>
    application.listConnectors(entityIdSchema.parse(projectId)),
  );
  handle(IPC_CHANNELS.connectorConfigure, (_event, input: ConfigureConnectorInput) =>
    application.configureConnector(
      configureConnectorSchema.parse(input) as ConfigureConnectorInput,
    ),
  );
  handle(IPC_CHANNELS.connectorGrants, (_event, connectorId: string) =>
    application.listConnectorGrants(entityIdSchema.parse(connectorId)),
  );
  handle(IPC_CHANNELS.connectorGrant, (_event, input: ConnectorGrantInput) =>
    application.grantConnector(connectorGrantInputSchema.parse(input) as ConnectorGrantInput),
  );
  handle(IPC_CHANNELS.connectorRevoke, (_event, connectorId: string, grantId: string) =>
    application.revokeConnector(entityIdSchema.parse(connectorId), entityIdSchema.parse(grantId)),
  );
  handle(IPC_CHANNELS.connectorInvocations, (_event, connectorId: string) =>
    application.listConnectorInvocations(entityIdSchema.parse(connectorId)),
  );
  handle(IPC_CHANNELS.autonomyGet, (_event, projectId: string) =>
    application.getProjectAutonomy(entityIdSchema.parse(projectId)),
  );
  handle(IPC_CHANNELS.autonomySet, (_event, projectId: string, level: string) =>
    application.setProjectAutonomy(
      entityIdSchema.parse(projectId),
      autonomyLevelSchema.parse(level),
    ),
  );
  handle(IPC_CHANNELS.jobList, (_event, projectId: string, activeOnly?: boolean) =>
    application.listJobs(entityIdSchema.parse(projectId), z.boolean().optional().parse(activeOnly)),
  );
  handle(IPC_CHANNELS.jobGet, (_event, jobId: string) =>
    application.getJob(entityIdSchema.parse(jobId)),
  );
  handle(IPC_CHANNELS.jobSteer, (_event, input: SteerJobInput) =>
    application.steerJob(steerJobSchema.parse(input) as SteerJobInput),
  );
  handle(IPC_CHANNELS.globalSearch, (_event, projectId: string, query: string, limit?: number) =>
    application.globalSearch(
      entityIdSchema.parse(projectId),
      z.string().trim().min(1).max(500).parse(query),
      z.number().int().min(1).max(100).optional().parse(limit),
    ),
  );
  handle(IPC_CHANNELS.externalOpen, (_event, url: string) =>
    application.openExternalUrl(
      z
        .string()
        .url()
        .max(8_192)
        .refine((value) => ["https:", "http:"].includes(new URL(value).protocol))
        .parse(url),
    ),
  );
  handle(IPC_CHANNELS.runGet, (_event, runId: string) =>
    application.getRun(entityIdSchema.parse(runId)),
  );
  handle(IPC_CHANNELS.runEvents, (_event, runId: string, after?: number, limit?: number) =>
    application.getRunEvents(
      entityIdSchema.parse(runId),
      z.number().int().nonnegative().optional().parse(after),
      z.number().int().positive().max(2_000).optional().parse(limit),
    ),
  );
  handle(IPC_CHANNELS.runApprove, (_event, runId: string, version: number) =>
    application.approveRun(entityIdSchema.parse(runId), z.number().int().positive().parse(version)),
  );
  handle(IPC_CHANNELS.runApproveGranular, (_event, input: GranularApprovalInput) => {
    const parsed = granularApprovalSchema.parse(input);
    return application.approveRunGranular({
      runId: parsed.runId,
      planVersion: parsed.planVersion,
      ...(parsed.allowedTools ? { allowedTools: parsed.allowedTools } : {}),
      ...(parsed.allowedCommands ? { allowedCommands: parsed.allowedCommands } : {}),
      ...(parsed.writablePaths ? { writablePaths: parsed.writablePaths } : {}),
      ...(parsed.network ? { network: parsed.network } : {}),
    });
  });
  handle(IPC_CHANNELS.runRevise, (_event, runId: string, version: number, comment: string) =>
    application.reviseRun(
      entityIdSchema.parse(runId),
      z.number().int().positive().parse(version),
      z.string().min(1).max(20_000).parse(comment),
    ),
  );
  handle(IPC_CHANNELS.runCancel, (_event, runId: string) =>
    application.cancelRun(entityIdSchema.parse(runId)),
  );
  handle(IPC_CHANNELS.turnSteer, (_event, input: SteerTurnInput) =>
    application.steerTurn(steerTurnSchema.parse(input)),
  );
  handle(IPC_CHANNELS.questionsAnswer, (_event, input: AnswerQuestionsInput) => {
    const parsed = answerQuestionsSchema.parse(input);
    return application.answerQuestions({
      runId: parsed.runId,
      answers: parsed.answers.map((answer) => ({
        questionId: answer.questionId,
        ...(answer.selectedOption ? { selectedOption: answer.selectedOption } : {}),
        ...(answer.freeText ? { freeText: answer.freeText } : {}),
      })),
    });
  });
  handle(IPC_CHANNELS.modelSwitch, (_event, input: SwitchModelInput) => {
    const parsed = switchModelSchema.parse(input);
    return application.switchModel({
      runId: parsed.runId,
      selection: {
        providerId: parsed.selection.providerId,
        modelId: parsed.selection.modelId,
        ...(parsed.selection.connectionId ? { connectionId: parsed.selection.connectionId } : {}),
        ...(parsed.selection.effort ? { effort: parsed.selection.effort } : {}),
      },
      timing: parsed.timing,
      ...(parsed.noFallback === undefined ? {} : { noFallback: parsed.noFallback }),
    });
  });
  handle(IPC_CHANNELS.runRetry, (_event, runId: string) =>
    application.retryRun(entityIdSchema.parse(runId)),
  );
  handle(IPC_CHANNELS.runReplan, (_event, runId: string, reason: string) =>
    application.replanRun(
      entityIdSchema.parse(runId),
      z.string().trim().min(1).max(100_000).parse(reason),
    ),
  );
  handle(IPC_CHANNELS.contextCompact, (_event, input: CompactTurnInput) => {
    const parsed = compactContextSchema.parse(input);
    return application.compactContext({
      conversationId: parsed.conversationId,
      ...(parsed.runId ? { runId: parsed.runId } : {}),
      ...(parsed.force === undefined ? {} : { force: parsed.force }),
    });
  });
  handle(IPC_CHANNELS.routeInspect, (_event, runId: string) =>
    application.inspectRoute(entityIdSchema.parse(runId)),
  );
  handle(IPC_CHANNELS.conversationFork, (_event, input: ForkConversationInput) => {
    const parsed = forkConversationSchema.parse(input);
    return application.forkConversation({
      conversationId: parsed.conversationId,
      ...(parsed.checkpointId ? { checkpointId: parsed.checkpointId } : {}),
      ...(parsed.title ? { title: parsed.title } : {}),
    });
  });
  handle(IPC_CHANNELS.providerRefresh, () => application.refreshProviders());
  handle(IPC_CHANNELS.providerConfigure, (_event, input: ConfigureProviderInput) =>
    application.configureProvider(configureProviderSchema.parse(input)),
  );
  handle(IPC_CHANNELS.providerConnectionCreate, (_event, input: CreateProviderConnectionInput) => {
    const parsed = createProviderConnectionSchema.parse(input);
    return application.createProviderConnection({
      providerId: parsed.providerId,
      name: parsed.name,
      ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      ...(parsed.concurrencyLimit !== undefined
        ? { concurrencyLimit: parsed.concurrencyLimit }
        : {}),
    });
  });
  handle(IPC_CHANNELS.providerConnectionUpdate, (_event, input: UpdateProviderConnectionInput) => {
    const parsed = updateProviderConnectionSchema.parse(input);
    return application.updateProviderConnection({
      connectionId: parsed.connectionId,
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
      ...(parsed.concurrencyLimit !== undefined
        ? { concurrencyLimit: parsed.concurrencyLimit }
        : {}),
    });
  });
  handle(IPC_CHANNELS.providerConnectionReorder, (_event, connectionIds: string[]) =>
    application.reorderProviderConnections(reorderProviderConnectionsSchema.parse(connectionIds)),
  );
  handle(IPC_CHANNELS.providerConnectionDelete, (_event, connectionId: string) =>
    application.deleteProviderConnection(entityIdSchema.parse(connectionId)),
  );
  handle(IPC_CHANNELS.providerConnectionLogin, (_event, connectionId: string) =>
    application.loginProviderConnection(entityIdSchema.parse(connectionId)),
  );
  handle(IPC_CHANNELS.settingsUpdate, (_event, settings: unknown) =>
    application.updateSettings(appSettingsUpdateSchema.parse(settings)),
  );
  handle(IPC_CHANNELS.vaultUnlock, (_event, password: string) =>
    application.unlockVault(z.string().min(8).max(1_024).parse(password)),
  );
  handle(IPC_CHANNELS.vaultLock, () => application.lockVault());
  handle(IPC_CHANNELS.updateCheck, () => application.checkForUpdates());
  handle(IPC_CHANNELS.updateDownload, () => application.downloadUpdate());
  handle(IPC_CHANNELS.updateInstall, () => application.installUpdate());
  handle(IPC_CHANNELS.terminalCreate, (_event, projectId: string, rootId: string) =>
    application.createTerminal(entityIdSchema.parse(projectId), entityIdSchema.parse(rootId)),
  );
  handle(IPC_CHANNELS.terminalWrite, (_event, sessionId: string, data: string) =>
    application.writeTerminal(entityIdSchema.parse(sessionId), z.string().max(65_536).parse(data)),
  );
  handle(IPC_CHANNELS.terminalResize, (_event, sessionId: string, cols: number, rows: number) =>
    application.resizeTerminal(
      entityIdSchema.parse(sessionId),
      z.number().int().min(2).max(500).parse(cols),
      z.number().int().min(1).max(300).parse(rows),
    ),
  );
  handle(IPC_CHANNELS.terminalKill, (_event, sessionId: string) =>
    application.killTerminal(entityIdSchema.parse(sessionId)),
  );
  handle(IPC_CHANNELS.windowMinimize, () => window.minimize());
  handle(IPC_CHANNELS.windowMaximize, () =>
    window.isMaximized() ? window.unmaximize() : window.maximize(),
  );
  handle(IPC_CHANNELS.windowClose, () => window.close());

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
