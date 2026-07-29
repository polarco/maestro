import { app, shell } from "electron";
import electronUpdater from "electron-updater";
import type { AppSettings, UpdateState } from "@maestro/contracts";
import { MaestroError, errorMessage } from "@maestro/core";
import {
  configureUpdaterPolicy,
  isUpdateVersionAllowed,
  resolveUpdateInstallStrategy,
} from "./update-policy.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const { autoUpdater } = electronUpdater;

export class UpdateService {
  readonly #emit: (state: UpdateState) => void;
  #timer: NodeJS.Timeout | null = null;
  #initialTimer: NodeJS.Timeout | null = null;
  #downloadedUpdateFile: string | null = null;
  #enabled = true;
  #channel: AppSettings["updateChannel"] = "stable";
  #state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    progress: null,
    message: "Canal Estável selecionado.",
    checkedAt: null,
    installStrategy: "automatic",
  };

  constructor(emit: (state: UpdateState) => void) {
    this.#emit = emit;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("checking-for-update", () =>
      this.#set({ status: "checking", progress: null, message: "Verificando atualizações…" }),
    );
    autoUpdater.on("update-available", (info) => {
      if (!this.#allows(info.version)) {
        this.#notAvailable();
        return;
      }
      this.#downloadedUpdateFile = null;
      this.#set({
        status: "available",
        availableVersion: info.version,
        progress: null,
        message: `Maestro ${info.version} está disponível.`,
        checkedAt: new Date().toISOString(),
        installStrategy: "automatic",
      });
    });
    autoUpdater.on("update-not-available", () => this.#notAvailable());
    autoUpdater.on("download-progress", (progress) =>
      this.#set({
        status: "downloading",
        progress: Math.max(0, Math.min(100, progress.percent)),
        message: `Baixando atualização… ${Math.round(progress.percent)}%`,
      }),
    );
    autoUpdater.on("update-downloaded", (info) => {
      if (!this.#allows(info.version)) {
        this.#notAvailable();
        return;
      }
      this.#downloadedUpdateFile = info.downloadedFile;
      this.#set({
        status: "downloaded",
        availableVersion: info.version,
        progress: 100,
        message:
          resolveUpdateInstallStrategy(process.platform, info.downloadedFile) === "system-installer"
            ? "Atualização pronta para abrir no instalador do sistema."
            : "Atualização pronta para instalar e reiniciar.",
        installStrategy: resolveUpdateInstallStrategy(process.platform, info.downloadedFile),
      });
    });
    autoUpdater.on("error", (error) =>
      this.#set({
        status: "error",
        progress: null,
        message: `Falha ao atualizar: ${errorMessage(error)}`,
        checkedAt: new Date().toISOString(),
      }),
    );
  }

  get state(): UpdateState {
    return { ...this.#state };
  }

  configure(settings: AppSettings): void {
    this.#enabled = settings.autoUpdateEnabled;
    this.#channel = settings.updateChannel;
    const channel = configureUpdaterPolicy(autoUpdater, this.#state.currentVersion, this.#channel);
    this.#clearTimers();
    if (!app.isPackaged) {
      this.#set({
        status: "idle",
        availableVersion: null,
        progress: null,
        message: `Canal ${channel.label}. Atualizações funcionam no aplicativo empacotado.`,
      });
      return;
    }
    if (!this.#enabled) {
      this.#set({
        status: "idle",
        availableVersion: null,
        progress: null,
        message: `Canal ${channel.label}. Verificação automática desativada.`,
      });
      return;
    }
    this.#set({
      status: "idle",
      availableVersion: null,
      progress: null,
      message: `Canal ${channel.label}. Verificação automática ativa.`,
    });
    this.#initialTimer = setTimeout(() => void this.check().catch(() => null), 15_000);
    this.#timer = setInterval(() => void this.check().catch(() => null), CHECK_INTERVAL_MS);
  }

  async check(): Promise<UpdateState> {
    this.#requireConfigured();
    this.#set({ status: "checking", progress: null, message: "Verificando atualizações…" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.#set({
        status: "error",
        message: `Falha ao verificar: ${errorMessage(error)}`,
        checkedAt: new Date().toISOString(),
      });
    }
    return this.state;
  }

  async download(): Promise<UpdateState> {
    if (this.#state.status !== "available") {
      throw new MaestroError(
        "UPDATE_NOT_AVAILABLE",
        "Nenhuma atualização está pronta para baixar.",
        {
          recoverable: true,
        },
      );
    }
    this.#set({ status: "downloading", progress: 0, message: "Iniciando download…" });
    const downloadedFiles = await autoUpdater.downloadUpdate();
    this.#downloadedUpdateFile =
      downloadedFiles.find((file) => file.toLowerCase().endsWith(".deb")) ??
      downloadedFiles[0] ??
      this.#downloadedUpdateFile;
    return this.state;
  }

  async install(): Promise<void> {
    const retryingSystemInstaller =
      this.#state.status === "installing" && this.#state.installStrategy === "system-installer";
    if (this.#state.status !== "downloaded" && !retryingSystemInstaller) {
      throw new MaestroError("UPDATE_NOT_DOWNLOADED", "Baixe a atualização antes de instalar.", {
        recoverable: true,
      });
    }

    if (this.#state.installStrategy === "system-installer" && this.#downloadedUpdateFile !== null) {
      const openError = await shell.openPath(this.#downloadedUpdateFile);
      if (openError) {
        shell.showItemInFolder(this.#downloadedUpdateFile);
        this.#set({
          status: "installing",
          message: "O pacote .deb foi exibido na pasta. Abra-o para concluir a atualização.",
        });
        return;
      }
      this.#set({
        status: "installing",
        message: "Instalador do sistema aberto. Conclua a instalação e reinicie o Maestro.",
      });
      return;
    }

    autoUpdater.quitAndInstall(false, true);
  }

  dispose(): void {
    this.#clearTimers();
  }

  #requireConfigured(): void {
    if (!app.isPackaged)
      throw new MaestroError(
        "UPDATE_DEVELOPMENT_BUILD",
        "A verificação funciona no aplicativo empacotado.",
        { recoverable: true },
      );
  }

  #set(values: Partial<UpdateState>): void {
    this.#state = { ...this.#state, ...values };
    this.#emit(this.state);
  }

  #allows(candidateVersion: string): boolean {
    return isUpdateVersionAllowed(this.#state.currentVersion, candidateVersion, this.#channel);
  }

  #notAvailable(): void {
    this.#downloadedUpdateFile = null;
    this.#set({
      status: "not-available",
      availableVersion: null,
      progress: null,
      message: "Você já está usando a versão mais recente deste canal.",
      checkedAt: new Date().toISOString(),
      installStrategy: "automatic",
    });
  }

  #clearTimers(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#initialTimer) clearTimeout(this.#initialTimer);
    this.#timer = null;
    this.#initialTimer = null;
  }
}
