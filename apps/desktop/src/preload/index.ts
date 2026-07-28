import { contextBridge, ipcRenderer } from "electron";
import type { MaestroDesktopApi, RunEvent, TerminalEvent, UpdateState } from "@maestro/contracts";
import { IPC_CHANNELS } from "@maestro/contracts/ipc-channels";

const api: MaestroDesktopApi = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  selectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectDirectory),
  selectAttachments: () => ipcRenderer.invoke(IPC_CHANNELS.selectAttachments),
  createProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectCreate, input),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.projectList),
  selectProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.projectSelect, projectId),
  updateProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectUpdate, input),
  deleteProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.projectDelete, projectId),
  addProjectRoot: (projectId, directory) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectAddRoot, projectId, directory),
  removeProjectRoot: (projectId, workspaceRootId) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectRemoveRoot, projectId, workspaceRootId),
  createConversation: (input) => ipcRenderer.invoke(IPC_CHANNELS.conversationCreate, input),
  listConversations: (projectId, limit) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationList, projectId, limit),
  getConversation: (conversationId) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationGet, conversationId),
  updateConversation: (input) => ipcRenderer.invoke(IPC_CHANNELS.conversationUpdate, input),
  deleteConversation: (conversationId) =>
    ipcRenderer.invoke(IPC_CHANNELS.conversationDelete, conversationId),
  sendMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.messageSend, input),
  getRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.runGet, runId),
  getRunEvents: (runId, afterSequence, limit) =>
    ipcRenderer.invoke(IPC_CHANNELS.runEvents, runId, afterSequence, limit),
  approveRun: (runId, planVersion) =>
    ipcRenderer.invoke(IPC_CHANNELS.runApprove, runId, planVersion),
  reviseRun: (runId, planVersion, comment) =>
    ipcRenderer.invoke(IPC_CHANNELS.runRevise, runId, planVersion, comment),
  cancelRun: (runId) => ipcRenderer.invoke(IPC_CHANNELS.runCancel, runId),
  refreshProviders: () => ipcRenderer.invoke(IPC_CHANNELS.providerRefresh),
  configureProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerConfigure, input),
  createProviderConnection: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerConnectionCreate, input),
  updateProviderConnection: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerConnectionUpdate, input),
  deleteProviderConnection: (connectionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerConnectionDelete, connectionId),
  loginProviderConnection: (connectionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerConnectionLogin, connectionId),
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, settings),
  unlockVault: (password) => ipcRenderer.invoke(IPC_CHANNELS.vaultUnlock, password),
  lockVault: () => ipcRenderer.invoke(IPC_CHANNELS.vaultLock),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
  createTerminal: (projectId, workspaceRootId) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, projectId, workspaceRootId),
  writeTerminal: (sessionId, data) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, sessionId, data),
  resizeTerminal: (sessionId, cols, rows) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalResize, sessionId, cols, rows),
  killTerminal: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.terminalKill, sessionId),
  onRunEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: RunEvent) => listener(value);
    ipcRenderer.on(IPC_CHANNELS.eventRun, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventRun, handler);
  },
  onTerminalEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: TerminalEvent) => listener(value);
    ipcRenderer.on(IPC_CHANNELS.eventTerminal, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventTerminal, handler);
  },
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: UpdateState) => listener(value);
    ipcRenderer.on(IPC_CHANNELS.eventUpdate, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventUpdate, handler);
  },
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  maximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMaximize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
};

contextBridge.exposeInMainWorld("maestro", Object.freeze(api));
