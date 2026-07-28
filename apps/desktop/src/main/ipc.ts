import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { z } from "zod";
import {
  appSettingsSchema,
  effortSchema,
  entityIdSchema,
  IPC_CHANNELS,
  runModeSchema,
  sessionKindSchema,
  type ConfigureProviderInput,
  type CreateProviderConnectionInput,
  type CreateConversationInput,
  type CreateProjectInput,
  type SendMessageInput,
  type UpdateProviderConnectionInput,
} from "@maestro/contracts";
import { MaestroError } from "@maestro/core";
import type { ApplicationService } from "./services/application.js";

const createProjectSchema = z
  .object({ name: z.string().max(120), directory: z.string().min(1).max(8_192) })
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
const sendMessageSchema = z
  .object({
    conversationId: entityIdSchema,
    content: z.string().min(1).max(2_000_000),
    mode: runModeSchema,
    sessionKind: sessionKindSchema,
    providerId: z.string().min(1).max(120),
    providerConnectionId: entityIdSchema.optional(),
    modelId: z.string().min(1).max(200),
    effort: effortSchema,
    workspaceRootId: entityIdSchema,
    attachmentPaths: z.array(z.string().min(1).max(8_192)).max(20),
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
  handle(IPC_CHANNELS.selectAttachments, () => application.selectAttachments());
  handle(IPC_CHANNELS.projectCreate, (_event, input: CreateProjectInput) =>
    application.createProject(createProjectSchema.parse(input)),
  );
  handle(IPC_CHANNELS.projectList, () => application.listProjects());
  handle(IPC_CHANNELS.projectSelect, (_event, projectId: string) =>
    application.selectProject(entityIdSchema.parse(projectId)),
  );
  handle(IPC_CHANNELS.projectAddRoot, (_event, projectId: string, directory: string) =>
    application.addProjectRoot(
      entityIdSchema.parse(projectId),
      z.string().min(1).max(8_192).parse(directory),
    ),
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
      attachmentPaths: parsed.attachmentPaths,
      ...(parsed.providerConnectionId ? { providerConnectionId: parsed.providerConnectionId } : {}),
    });
  });
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
  handle(IPC_CHANNELS.providerConnectionDelete, (_event, connectionId: string) =>
    application.deleteProviderConnection(entityIdSchema.parse(connectionId)),
  );
  handle(IPC_CHANNELS.providerConnectionLogin, (_event, connectionId: string) =>
    application.loginProviderConnection(entityIdSchema.parse(connectionId)),
  );
  handle(IPC_CHANNELS.settingsUpdate, (_event, settings: unknown) =>
    application.updateSettings(appSettingsSchema.partial().parse(settings)),
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
