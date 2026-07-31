import { app, shell } from "electron";
import electronUpdater from "electron-updater";
import type { AppSettings, UpdateState } from "@maestro/contracts";
import { MaestroError, errorMessage } from "@maestro/core";
import {
  configureUpdaterPolicy,
  isUpdateVersionAllowed,
  resolveUpdateInstallStrategy,
} from "./update-policy.js";
import { isTransientUpdateError, retryTransientUpdateOperation } from "./update-retry.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const { autoUpdater } = electronUpdater;

export class UpdateService {
  readonly #emit: (state: UpdateState) => void;
  #timer: NodeJS.Timeout | null = null;
  #initialTimer: NodeJS.Timeout | null = null;
  #downloadedUpdateFile: string | null = null;
  #downloadPromise: Promise<UpdateState> | null = null;
  #downloadActive = false;
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
    autoUpdater.on("error", (error) => {
      // downloadUpdate also rejects with this error. Keep the banner in its retry state and let
      // #performDownload decide whether to retry or expose a final, actionable failure.
      if (this.#downloadActive) return;
      this.#set({
        status: "error",
        progress: null,
        message: `Falha ao atualizar: ${errorMessage(error)}`,
        checkedAt: new Date().toISOString(),
      });
    });
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
    if (this.#downloadPromise) return this.#downloadPromise;
    const retryingFailedDownload =
      this.#state.status === "error" && this.#state.availableVersion !== null;
    if (this.#state.status !== "available" && !retryingFailedDownload) {
      throw new MaestroError(
        "UPDATE_NOT_AVAILABLE",
        "Nenhuma atualização está pronta para baixar.",
        {
          recoverable: true,
        },
      );
    }
    this.#downloadedUpdateFile = null;
    this.#set({ status: "downloading", progress: 0, message: "Iniciando download…" });
    this.#downloadActive = true;
    const operation = this.#performDownload().finally(() => {
      this.#downloadActive = false;
      this.#downloadPromise = null;
    });
    this.#downloadPromise = operation;
    return operation;
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

  async #performDownload(): Promise<UpdateState> {
    try {
      const downloadedFiles = await retryTransientUpdateOperation(
        () => autoUpdater.downloadUpdate(),
        {
          onRetry: ({ retryNumber, maxRetries, delayMs }) => {
            const seconds = Math.max(1, Math.ceil(delayMs / 1_000));
            this.#set({
              status: "downloading",
              message: `A conexão mudou. Retomando em ${seconds}s (${retryNumber}/${maxRetries})…`,
            });
          },
        },
      );
      this.#downloadedUpdateFile =
        downloadedFiles.find((file) => file.toLowerCase().endsWith(".deb")) ??
        downloadedFiles[0] ??
        this.#downloadedUpdateFile;
    } catch (error) {
      const transient = isTransientUpdateError(error);
      this.#set({
        status: "error",
        progress: null,
        message: transient
          ? "A rede continuou instável. Confira a conexão e tente novamente; o download será retomado."
          : `Falha ao atualizar: ${errorMessage(error)}`,
        checkedAt: new Date().toISOString(),
      });
    }
    return this.state;
  }

  #clearTimers(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#initialTimer) clearTimeout(this.#initialTimer);
    this.#timer = null;
    this.#initialTimer = null;
  }
}
