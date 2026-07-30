import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import type {
  Effort,
  ProviderAdapter,
  ProviderConfigSchema,
  ProviderDescriptor,
  ProviderEventSink,
  ProviderHealth,
  ProviderConnection,
  ProviderModel,
  ProviderInput,
  ProviderSession,
  ProviderSessionSpec,
} from "@maestro/contracts";
import { MaestroError, errorMessage, normalizeClaudeEvent } from "@maestro/core";
import type { ManagedProcess } from "../services/process-supervisor.js";
import { configString, type ProviderDependencies } from "./types.js";
import { subscriptionEnvironment } from "./subscription-environment.js";

type JsonRecord = Record<string, unknown>;

export async function claudeContentBlocks(input: ProviderInput): Promise<JsonRecord[]> {
  const parts = typeof input === "string" ? [{ type: "text" as const, text: input }] : input;
  return Promise.all(
    parts.map(async (part): Promise<JsonRecord> => {
      if (part.type === "text") return { type: "text", text: part.text };
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.mimeType ?? "image/jpeg",
          data: (await readFile(part.path)).toString("base64"),
        },
      };
    }),
  );
}

interface ClaudeSessionRecord {
  session: ProviderSession;
  spec: ProviderSessionSpec;
  sink: ProviderEventSink;
  process: ManagedProcess | null;
  completion: { resolve: () => void; reject: (error: Error) => void } | null;
  stderr: string;
}

const CLAUDE_EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function model(id: string, name: string, isDefault = false): ProviderModel {
  return {
    id,
    name,
    isDefault,
    capabilities: {
      chat: true,
      coding: true,
      tools: true,
      vision: true,
      reasoningEffort: CLAUDE_EFFORTS,
      structuredOutput: true,
      contextWindow: null,
    },
  };
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly descriptor: ProviderDescriptor = {
    id: "claude-code",
    name: "Claude Code",
    kind: "cli",
    description: "Processo stream-json por sessão, com resume, effort, ferramentas e orçamento.",
    supportsStructuredSessions: true,
    supportsPty: true,
    homepage: "https://docs.anthropic.com/en/docs/claude-code/",
  };

  readonly configSchema: ProviderConfigSchema = {
    providerId: "claude-code",
    fields: [
      {
        key: "executable",
        label: "Executável",
        type: "text",
        required: true,
        defaultValue: "claude",
      },
    ],
  };

  readonly #dependencies: ProviderDependencies;
  readonly connection: ProviderConnection;
  readonly #sessions = new Map<string, ClaudeSessionRecord>();

  constructor(dependencies: ProviderDependencies, connection: ProviderConnection) {
    this.#dependencies = dependencies;
    this.connection = connection;
  }

  #environment(): NodeJS.ProcessEnv {
    return subscriptionEnvironment(this.connection);
  }

  async #executable(): Promise<string> {
    const config = await this.#dependencies.repository.getProviderConfig(this.descriptor.id);
    return configString(config, "executable", "claude");
  }

  async detect(signal?: AbortSignal): Promise<ProviderHealth> {
    const executable = await this.#executable();
    const versionResult = await this.#dependencies.supervisor
      .capture(
        { executable, args: ["--version"], env: this.#environment(), label: "Claude Code version" },
        { timeoutMs: 8_000, ...(signal ? { signal } : {}), maxOutputBytes: 64_000 },
      )
      .catch(() => null);
    if (!versionResult || versionResult.exitCode !== 0) {
      return {
        providerId: this.descriptor.id,
        connectionId: this.connection.id,
        status: "unavailable",
        installed: false,
        authenticated: null,
        version: null,
        message: "Claude Code não foi encontrado no PATH.",
        checkedAt: new Date().toISOString(),
      };
    }
    const authResult = await this.#dependencies.supervisor
      .capture(
        {
          executable,
          args: ["auth", "status", "--json"],
          env: this.#environment(),
          label: "Claude Code auth status",
        },
        { timeoutMs: 10_000, ...(signal ? { signal } : {}), maxOutputBytes: 64_000 },
      )
      .catch(() => null);
    let authenticated = false;
    if (authResult?.exitCode === 0) {
      try {
        const auth = JSON.parse(authResult.stdout) as JsonRecord;
        const authMethod = typeof auth.authMethod === "string" ? auth.authMethod : "";
        const apiProvider = typeof auth.apiProvider === "string" ? auth.apiProvider : "";
        authenticated =
          auth.loggedIn === true &&
          !/api.?key|console/i.test(authMethod) &&
          (!apiProvider || apiProvider === "firstParty");
      } catch {
        authenticated = /logged.?in/i.test(authResult.stdout);
      }
    }
    return {
      providerId: this.descriptor.id,
      connectionId: this.connection.id,
      status: authenticated ? "ready" : "unauthenticated",
      installed: true,
      authenticated,
      version: versionResult.stdout.trim() || versionResult.stderr.trim(),
      message: authenticated
        ? "Assinatura Claude conectada; credenciais permanecem no CLI."
        : "Conecte uma assinatura Claude.ai (logins Console/API não são aceitos).",
      checkedAt: new Date().toISOString(),
    };
  }

  listModels(): Promise<ProviderModel[]> {
    return Promise.resolve([
      model("fable", "Fable", true),
      model("sonnet", "Sonnet"),
      model("opus", "Opus"),
    ]);
  }

  createSession(spec: ProviderSessionSpec, onEvent: ProviderEventSink): Promise<ProviderSession> {
    const session: ProviderSession = {
      id: randomUUID(),
      providerId: this.descriptor.id,
      connectionId: this.connection.id,
      nativeSessionId: spec.resumeSessionId ?? null,
      state: "idle",
    };
    this.#sessions.set(session.id, {
      session,
      spec,
      sink: onEvent,
      process: null,
      completion: null,
      stderr: "",
    });
    return Promise.resolve({ ...session });
  }

  resumeSession(spec: ProviderSessionSpec, onEvent: ProviderEventSink): Promise<ProviderSession> {
    return this.createSession(spec, onEvent);
  }

  async send(sessionId: string, input: ProviderInput): Promise<ProviderSession> {
    const record = this.#requireSession(sessionId);
    if (record.completion)
      throw new MaestroError("SESSION_BUSY", "A sessão Claude Code já possui um turno ativo.", {
        recoverable: true,
      });
    await this.#ensureProcess(record);
    if (!record.process?.child.stdin.writable)
      throw new MaestroError("CLAUDE_STDIN_CLOSED", "A sessão Claude Code não aceita entrada.", {
        recoverable: true,
      });
    record.session.state = "active";
    const completion = new Promise<void>((resolve, reject) => {
      record.completion = { resolve, reject };
    });
    record.process.child.stdin.write(
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: await claudeContentBlocks(input) },
      })}\n`,
    );
    await completion;
    record.session.state = "idle";
    return { ...record.session };
  }

  async steer(sessionId: string, input: ProviderInput): Promise<void> {
    const record = this.#requireSession(sessionId);
    if (!record.completion || !record.process?.child.stdin.writable) {
      throw new MaestroError(
        "STEERING_UNAVAILABLE",
        "Não há uma sessão Claude Code ativa para receber steering.",
        { recoverable: true },
      );
    }
    record.process.child.stdin.write(
      `${JSON.stringify({
        type: "user",
        message: { role: "user", content: await claudeContentBlocks(input) },
      })}\n`,
    );
  }

  async cancel(sessionId: string): Promise<void> {
    const record = this.#sessions.get(sessionId);
    if (!record) return;
    if (record.process) await this.#dependencies.supervisor.kill(record.process.id);
    record.process = null;
    record.completion?.reject(
      new MaestroError("RUN_CANCELED", "Sessão Claude Code cancelada.", { recoverable: true }),
    );
    record.completion = null;
    record.session.state = "canceled";
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.#sessions.keys()].map((id) => this.cancel(id)));
    this.#sessions.clear();
  }

  async #ensureProcess(record: ClaudeSessionRecord): Promise<void> {
    if (record.process?.child.exitCode === null) return;
    const executable = await this.#executable();
    const permissionMode = record.spec.permissions.writeWorkspace ? "acceptEdits" : "plan";
    const tools = record.spec.permissions.readWorkspace ? ["Read", "Glob", "Grep"] : [];
    if (record.spec.permissions.writeWorkspace) tools.push("Edit", "Write");
    if (record.spec.permissions.runCommands) tools.push("Bash");
    const extraRoots = record.spec.workspaceRoots.filter((root) => root !== record.spec.cwd);
    const args = [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--safe-mode",
      "--strict-mcp-config",
      "--model",
      record.spec.model,
      "--effort",
      record.spec.effort === "none" ? "medium" : record.spec.effort,
      "--permission-mode",
      permissionMode,
      "--max-turns",
      String(record.spec.budget.maxTurns),
      "--tools",
      tools.join(","),
      ...(extraRoots.length > 0 ? ["--add-dir", ...extraRoots] : []),
      ...(record.session.nativeSessionId ? ["--resume", record.session.nativeSessionId] : []),
      ...(record.spec.systemPrompt ? ["--append-system-prompt", record.spec.systemPrompt] : []),
      ...(record.spec.outputSchema
        ? ["--json-schema", JSON.stringify(record.spec.outputSchema)]
        : []),
    ];
    const managed = this.#dependencies.supervisor.spawn({
      executable,
      args,
      ...(record.spec.cwd ? { cwd: record.spec.cwd } : {}),
      env: this.#environment(),
      label: "Claude Code",
    });
    record.process = managed;
    record.stderr = "";
    managed.child.stderr.on("data", (chunk: Buffer) => {
      record.stderr = `${record.stderr}${chunk.toString("utf8")}`.slice(-16_000);
    });
    const lines = createInterface({ input: managed.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let native: JsonRecord;
      try {
        native = JSON.parse(line) as JsonRecord;
      } catch {
        return;
      }
      if (typeof native.session_id === "string") {
        record.session.nativeSessionId = native.session_id;
      }
      const events = normalizeClaudeEvent(native, {
        runId: record.spec.runId,
        ...(record.spec.taskId ? { taskId: record.spec.taskId } : {}),
        agentId: record.session.id,
        providerId: this.descriptor.id,
        modelId: record.spec.model,
        cwd: record.spec.cwd ?? "",
      });
      for (const event of events) void record.sink(event);
      if (native.type === "result") {
        const failed = native.is_error === true || native.subtype !== "success";
        if (failed) {
          record.completion?.reject(
            new MaestroError(
              "CLAUDE_CODE_ERROR",
              typeof native.result === "string" ? native.result : "Claude Code falhou.",
              { recoverable: true },
            ),
          );
        } else {
          record.completion?.resolve();
        }
        record.completion = null;
      }
    });
    managed.child.once("error", (error) => {
      record.process = null;
      record.completion?.reject(
        new MaestroError("CLAUDE_CODE_FAILED", errorMessage(error), { recoverable: true }),
      );
      record.completion = null;
    });
    managed.child.once("exit", (code, signal) => {
      record.process = null;
      if (record.completion) {
        record.completion.reject(
          new MaestroError(
            "CLAUDE_CODE_EXITED",
            record.stderr.trim() || `Claude Code encerrou (${code ?? signal ?? "unknown"}).`,
            { recoverable: true },
          ),
        );
        record.completion = null;
      }
    });
  }

  #requireSession(sessionId: string): ClaudeSessionRecord {
    const record = this.#sessions.get(sessionId);
    if (!record) throw new MaestroError("SESSION_NOT_FOUND", "Sessão Claude Code não encontrada.");
    return record;
  }
}
