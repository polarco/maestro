import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { MaestroError, errorMessage } from "@maestro/core";

export interface ManagedProcessSpec {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  label?: string;
}

export interface ManagedProcess {
  id: string;
  label: string;
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
}

export interface CapturedProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

export class ProcessSupervisor {
  readonly #processes = new Map<string, ManagedProcess>();

  spawn(spec: ManagedProcessSpec): ManagedProcess {
    if (!spec.executable.trim()) throw new MaestroError("INVALID_EXECUTABLE", "Executável vazio.");
    const id = randomUUID();
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const managed: ManagedProcess = {
      id,
      label: spec.label ?? spec.executable,
      child,
      startedAt: Date.now(),
    };
    this.#processes.set(id, managed);
    child.once("exit", () => this.#processes.delete(id));
    child.once("error", () => this.#processes.delete(id));
    return managed;
  }

  async capture(
    spec: ManagedProcessSpec,
    options: { timeoutMs?: number; signal?: AbortSignal; maxOutputBytes?: number } = {},
  ): Promise<CapturedProcessResult> {
    const managed = this.spawn(spec);
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 5 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= maxOutputBytes) return current;
      const remaining = maxOutputBytes - Buffer.byteLength(current);
      return current + chunk.subarray(0, remaining).toString("utf8");
    };
    managed.child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    managed.child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    return new Promise<CapturedProcessResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener("abort", abort);
        const error = new MaestroError(
          "PROCESS_TIMEOUT",
          `${managed.label} excedeu ${timeoutMs} ms.`,
          { recoverable: true },
        );
        void this.kill(managed.id).finally(() => reject(error));
      }, timeoutMs);

      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        const error = new MaestroError("PROCESS_CANCELED", `${managed.label} foi cancelado.`, {
          recoverable: true,
        });
        void this.kill(managed.id).finally(() => reject(error));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();

      managed.child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        reject(
          new MaestroError(
            "PROCESS_START_FAILED",
            `Não foi possível iniciar ${managed.label}: ${errorMessage(error)}`,
            { recoverable: true },
          ),
        );
      });
      managed.child.once("exit", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        resolve({
          stdout,
          stderr,
          exitCode,
          signal,
          durationMs: Date.now() - managed.startedAt,
        });
      });
    });
  }

  async kill(id: string): Promise<void> {
    const managed = this.#processes.get(id);
    if (!managed || managed.child.exitCode !== null) return;
    const pid = managed.child.pid;
    if (pid === undefined) return;

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("error", () => resolve());
        killer.once("exit", () => resolve());
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          managed.child.kill("SIGTERM");
        } catch {
          return;
        }
      }
      await new Promise<void>((resolve) => {
        const forceTimer = setTimeout(() => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            try {
              managed.child.kill("SIGKILL");
            } catch {
              // The process already exited.
            }
          }
          resolve();
        }, 2_000);
        managed.child.once("exit", () => {
          clearTimeout(forceTimer);
          resolve();
        });
      });
    }
    this.#processes.delete(id);
  }

  async killAll(): Promise<void> {
    await Promise.allSettled([...this.#processes.keys()].map((id) => this.kill(id)));
  }

  list(): Array<{ id: string; label: string; pid: number | undefined; startedAt: number }> {
    return [...this.#processes.values()].map((item) => ({
      id: item.id,
      label: item.label,
      pid: item.child.pid,
      startedAt: item.startedAt,
    }));
  }
}
