import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import type { TerminalEvent, TerminalSessionDto } from "@maestro/contracts";
import type { MaestroRepository } from "@maestro/database";
import { MaestroError } from "@maestro/core";

interface TerminalRecord {
  dto: TerminalSessionDto;
  process: pty.IPty;
}

export class TerminalService {
  readonly #repository: MaestroRepository;
  readonly #emit: (event: TerminalEvent) => void;
  readonly #sessions = new Map<string, TerminalRecord>();

  constructor(repository: MaestroRepository, emit: (event: TerminalEvent) => void) {
    this.#repository = repository;
    this.#emit = emit;
  }

  async create(projectId: string, workspaceRootId: string): Promise<TerminalSessionDto> {
    const root = await this.#repository.getWorkspaceRoot(workspaceRootId);
    if (root.projectId !== projectId)
      throw new MaestroError("WORKSPACE_PROJECT_MISMATCH", "A raiz não pertence ao projeto.");
    const shell = this.#defaultShell();
    const id = randomUUID();
    const terminal = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: root.canonicalPath,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    const dto: TerminalSessionDto = {
      id,
      kind: "workspace",
      projectId,
      workspaceRootId,
      providerConnectionId: null,
      cwd: root.canonicalPath,
      shell: path.basename(shell),
      label: root.displayName,
      createdAt: new Date().toISOString(),
    };
    this.#sessions.set(id, { dto, process: terminal });
    terminal.onData((data) => this.#emit({ sessionId: id, type: "data", data }));
    terminal.onExit(({ exitCode, signal }) => {
      this.#sessions.delete(id);
      this.#emit({
        sessionId: id,
        type: "exit",
        exitCode,
        ...(signal !== undefined ? { signal } : {}),
      });
    });
    return dto;
  }

  createProviderLogin(input: {
    connectionId: string;
    label: string;
    executable: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  }): TerminalSessionDto {
    const id = randomUUID();
    const terminal = pty.spawn(input.executable, input.args, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: input.cwd,
      env: { ...input.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    const dto: TerminalSessionDto = {
      id,
      kind: "provider-login",
      projectId: null,
      workspaceRootId: null,
      providerConnectionId: input.connectionId,
      cwd: input.cwd,
      shell: path.basename(input.executable),
      label: input.label,
      createdAt: new Date().toISOString(),
    };
    this.#sessions.set(id, { dto, process: terminal });
    terminal.onData((data) => this.#emit({ sessionId: id, type: "data", data }));
    terminal.onExit(({ exitCode, signal }) => {
      this.#sessions.delete(id);
      this.#emit({
        sessionId: id,
        type: "exit",
        exitCode,
        ...(signal !== undefined ? { signal } : {}),
      });
    });
    return dto;
  }

  write(sessionId: string, data: string): void {
    const session = this.#require(sessionId);
    if (Buffer.byteLength(data, "utf8") > 64 * 1024) {
      throw new MaestroError("TERMINAL_INPUT_TOO_LARGE", "Entrada de terminal muito grande.");
    }
    session.process.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.#require(sessionId);
    const safeCols = Math.max(2, Math.min(Math.floor(cols), 500));
    const safeRows = Math.max(1, Math.min(Math.floor(rows), 300));
    session.process.resize(safeCols, safeRows);
  }

  kill(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.process.kill();
    this.#sessions.delete(sessionId);
  }

  hasProjectSession(projectId: string): boolean {
    return [...this.#sessions.values()].some((session) => session.dto.projectId === projectId);
  }

  hasWorkspaceRootSession(workspaceRootId: string): boolean {
    return [...this.#sessions.values()].some(
      (session) => session.dto.workspaceRootId === workspaceRootId,
    );
  }

  dispose(): void {
    for (const session of this.#sessions.values()) session.process.kill();
    this.#sessions.clear();
  }

  #require(sessionId: string): TerminalRecord {
    const session = this.#sessions.get(sessionId);
    if (!session)
      throw new MaestroError("TERMINAL_NOT_FOUND", "Sessão de terminal não encontrada.");
    return session;
  }

  #defaultShell(): string {
    if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
    const configured = process.env.SHELL;
    return configured && path.isAbsolute(configured) ? configured : "/bin/bash";
  }
}
