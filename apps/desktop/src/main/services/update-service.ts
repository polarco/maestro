import { app } from "electron";
import electronUpdater from "electron-updater";
import type { AppSettings, UpdateState } from "@maestro/contracts";
import { MaestroError, errorMessage } from "@maestro/core";
import { resolveUpdateChannel } from "./update-policy.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const { autoUpdater } = electronUpdater;

export class UpdateService {
  readonly #emit: (state: UpdateState) => void;
  #timer: NodeJS.Timeout | null = null;
  #initialTimer: NodeJS.Timeout | null = null;
  #enabled = true;
  #state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    progress: null,
    message: "Canal Estável selecionado.",
    checkedAt: null,
  };

  constructor(emit: (state: UpdateState) => void) {
    this.#emit = emit;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () =>
      this.#set({ status: "checking", progress: null, message: "Verificando atualizações…" }),
    );
    autoUpdater.on("update-available", (info) =>
      this.#set({
        status: "available",
        availableVersion: info.version,
        progress: null,
        message: `Maestro ${info.version} está disponível.`,
        checkedAt: new Date().toISOString(),
      }),
    );
    autoUpdater.on("update-not-available", () =>
      this.#set({
        status: "not-available",
        availableVersion: null,
        progress: null,
        message: "Você já está usando a versão mais recente.",
        checkedAt: new Date().toISOString(),
      }),
    );
    autoUpdater.on("download-progress", (progress) =>
      this.#set({
        status: "downloading",
        progress: Math.max(0, Math.min(100, progress.percent)),
        message: `Baixando atualização… ${Math.round(progress.percent)}%`,
      }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      this.#set({
        status: "downloaded",
        availableVersion: info.version,
        progress: 100,
        message: "Atualização pronta para instalar e reiniciar.",
      }),
    );
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
    const channel = resolveUpdateChannel(settings.updateChannel);
    autoUpdater.allowPrerelease = channel.allowPrerelease;
    autoUpdater.channel = channel.updaterChannel;
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
    await autoUpdater.downloadUpdate();
    return this.state;
  }

  install(): void {
    if (this.#state.status !== "downloaded") {
      throw new MaestroError("UPDATE_NOT_DOWNLOADED", "Baixe a atualização antes de instalar.", {
        recoverable: true,
      });
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

  #clearTimers(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#initialTimer) clearTimeout(this.#initialTimer);
    this.#timer = null;
    this.#initialTimer = null;
  }
}
