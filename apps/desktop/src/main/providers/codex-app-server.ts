import { createInterface } from "node:readline";
import { MaestroError, errorMessage } from "@maestro/core";
import type { ManagedProcess, ProcessSupervisor } from "../services/process-supervisor.js";

type JsonRecord = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export type CodexServerRequestHandler = (message: JsonRecord) => Promise<unknown>;
export type CodexNotificationHandler = (message: JsonRecord) => void | Promise<void>;

export class CodexAppServerClient {
  readonly #supervisor: ProcessSupervisor;
  readonly #executable: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #argsPrefix: string[];
  readonly #onServerRequest: CodexServerRequestHandler;
  #process: ManagedProcess | null = null;
  #nextId = 1;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #notificationHandlers = new Set<CodexNotificationHandler>();

  constructor(
    supervisor: ProcessSupervisor,
    executable: string,
    env: NodeJS.ProcessEnv,
    argsPrefix: string[],
    onServerRequest: CodexServerRequestHandler,
  ) {
    this.#supervisor = supervisor;
    this.#executable = executable;
    this.#env = env;
    this.#argsPrefix = argsPrefix;
    this.#onServerRequest = onServerRequest;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.child.exitCode === null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const managed = this.#supervisor.spawn({
      executable: this.#executable,
      args: [...this.#argsPrefix, "app-server", "--listen", "stdio://"],
      env: this.#env,
      label: "Codex app-server",
    });
    this.#process = managed;
    managed.child.stderr.on("data", () => {
      // Stderr contains diagnostic logs; provider failures are surfaced through exit/error.
    });
    const lines = createInterface({ input: managed.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let message: JsonRecord;
      try {
        message = JSON.parse(line) as JsonRecord;
      } catch {
        return;
      }
      void this.#handleMessage(message);
    });
    managed.child.once("exit", (code, signal) => {
      this.#process = null;
      for (const request of this.#pending.values()) {
        clearTimeout(request.timeout);
        request.reject(
          new MaestroError(
            "CODEX_APP_SERVER_EXITED",
            `Codex app-server encerrou (${code ?? signal ?? "unknown"}).`,
            { recoverable: true },
          ),
        );
      }
      this.#pending.clear();
    });
    managed.child.once("error", (error) => {
      this.#process = null;
      for (const request of this.#pending.values()) {
        clearTimeout(request.timeout);
        request.reject(
          new MaestroError("CODEX_APP_SERVER_FAILED", errorMessage(error), { recoverable: true }),
        );
      }
      this.#pending.clear();
    });

    await this.request("initialize", {
      clientInfo: { name: "maestro_desktop", title: "Maestro Desktop", version: "0.2.0" },
      capabilities: { experimentalApi: false },
    });
    this.notify("initialized", {});
  }

  onNotification(handler: CodexNotificationHandler): () => void {
    this.#notificationHandlers.add(handler);
    return () => this.#notificationHandlers.delete(handler);
  }

  request<T = unknown>(method: string, params: JsonRecord, timeoutMs = 30_000): Promise<T> {
    if (!this.#process || this.#process.child.exitCode !== null) {
      return Promise.reject(
        new MaestroError("CODEX_APP_SERVER_NOT_RUNNING", "Codex app-server não está ativo.", {
          recoverable: true,
        }),
      );
    }
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new MaestroError("CODEX_RPC_TIMEOUT", `${method} excedeu ${timeoutMs} ms.`, {
            recoverable: true,
          }),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.#write({ method, id, params });
    });
  }

  notify(method: string, params: JsonRecord): void {
    this.#write({ method, params });
  }

  async close(): Promise<void> {
    const processId = this.#process?.id;
    this.#process = null;
    if (processId) await this.#supervisor.kill(processId);
  }

  #write(message: JsonRecord): void {
    if (!this.#process?.child.stdin.writable) {
      throw new MaestroError(
        "CODEX_APP_SERVER_NOT_RUNNING",
        "Codex app-server não está disponível.",
        { recoverable: true },
      );
    }
    this.#process.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async #handleMessage(message: JsonRecord): Promise<void> {
    if (
      typeof message.id === "number" &&
      ("result" in message || "error" in message) &&
      !message.method
    ) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        const error = message.error as JsonRecord;
        const errorMessage =
          typeof error.message === "string" ? error.message : "Erro RPC do Codex";
        pending.reject(
          new MaestroError("CODEX_RPC_ERROR", errorMessage, { recoverable: true, detail: error }),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.id === "number" && typeof message.method === "string") {
      try {
        const result = await this.#onServerRequest(message);
        this.#write({ id: message.id, result });
      } catch (error) {
        this.#write({
          id: message.id,
          error: { code: -32_000, message: errorMessage(error) },
        });
      }
      return;
    }

    if (typeof message.method === "string") {
      for (const handler of this.#notificationHandlers) await handler(message);
    }
  }
}
