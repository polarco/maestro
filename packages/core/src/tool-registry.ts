import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CommandSpec,
  ExecutionPolicy,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "@maestro/contracts";
import { MaestroError, errorMessage } from "./errors.js";
import { assertPathWithinRoots } from "./path-policy.js";

export interface ToolHandlerResult {
  output: unknown;
  artifactRef?: string | null;
  truncated?: boolean;
  contentHash?: string | null;
}

export interface ToolExecutionContext {
  turnId: string;
  runId?: string | null;
  checkpointId?: string | null;
  policy: ExecutionPolicy;
  signal?: AbortSignal;
  onStarted?: (call: ToolCall) => Promise<void>;
}

export interface ToolPersistence {
  findToolCallByIdempotencyKey?(key: string): Promise<{
    call: ToolCall;
    result: ToolResult | null;
  } | null>;
  createToolCall?(call: ToolCall): Promise<void>;
  updateToolCall?(call: ToolCall): Promise<void>;
  saveToolResult?(result: ToolResult): Promise<void>;
}

export interface ToolArtifactStore {
  put(content: string, metadata: { toolCallId: string; toolName: string }): Promise<string>;
}

export interface BuiltinToolServices {
  command?: (
    command: CommandSpec,
    context: ToolExecutionContext,
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number }>;
  lsp?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  question?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  agent?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  skill?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  mcpRead?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  mcp?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  githubRead?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  githubMutate?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
  web?: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
}

export type ToolHandler = (input: unknown, context: ToolExecutionContext) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new MaestroError("INVALID_TOOL_INPUT", "A entrada da ferramenta precisa ser um objeto.");
  return input as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || !value.trim())
    throw new MaestroError("INVALID_TOOL_INPUT", `Campo obrigatório inválido: ${name}.`);
  return value;
}

function numberField(
  input: Record<string, unknown>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = input[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new MaestroError("INVALID_TOOL_INPUT", `Campo numérico inválido: ${name}.`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function globRegex(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else expression += "[^/]*";
    } else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${expression}$`);
}

async function walkFiles(root: string, maximum = 20_000): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < maximum) {
    const directory = queue.shift()!;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules")
        continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.isFile()) files.push(candidate);
      if (files.length >= maximum) break;
    }
  }
  return files;
}

function isHandlerResult(value: unknown): value is ToolHandlerResult {
  return typeof value === "object" && value !== null && "output" in value;
}

function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): this {
    if (this.#tools.has(definition.name))
      throw new MaestroError(
        "TOOL_ALREADY_REGISTERED",
        `Ferramenta duplicada: ${definition.name}.`,
      );
    this.#tools.set(definition.name, { definition, handler });
    return this;
  }

  get(name: string): RegisteredTool {
    const tool = this.#tools.get(name);
    if (!tool) throw new MaestroError("TOOL_NOT_FOUND", `Ferramenta desconhecida: ${name}.`);
    return tool;
  }

  definitions(policy?: ExecutionPolicy): ToolDefinition[] {
    return [...this.#tools.values()]
      .map((tool) => tool.definition)
      .filter((definition) => !policy || toolPermitted(definition, policy));
  }
}

export function toolPermitted(definition: ToolDefinition, policy: ExecutionPolicy): boolean {
  // An empty allow-list intentionally means "no tools".  This is important for
  // direct-answer turns: merely having no readable roots is not a sufficient
  // boundary for delegated/LSP tools.
  if (!policy.allowedTools.includes(definition.name)) return false;
  if (definition.mutability === "workspace")
    return policy.writeApproved && policy.writableRoots.length > 0;
  if (definition.mutability === "external")
    return policy.externalMutations && policy.network !== "denied";
  if (definition.category === "web") return policy.network !== "denied";
  return true;
}

export class PolicyToolExecutor {
  readonly #registry: ToolRegistry;
  readonly #persistence: ToolPersistence;
  readonly #artifacts: ToolArtifactStore | undefined;
  readonly #maxInlineBytes: number;

  constructor(input: {
    registry: ToolRegistry;
    persistence?: ToolPersistence;
    artifacts?: ToolArtifactStore;
    maxInlineBytes?: number;
  }) {
    this.#registry = input.registry;
    this.#persistence = input.persistence ?? {};
    this.#artifacts = input.artifacts;
    this.#maxInlineBytes = Math.max(1_024, input.maxInlineBytes ?? 64 * 1_024);
  }

  definitions(policy: ExecutionPolicy): ToolDefinition[] {
    return this.#registry.definitions(policy);
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
    suppliedIdempotencyKey?: string,
  ): Promise<{ call: ToolCall; result: ToolResult }> {
    const tool = this.#registry.get(name);
    if (!toolPermitted(tool.definition, context.policy))
      throw new MaestroError(
        "TOOL_POLICY_DENIED",
        `A política aprovada não permite a ferramenta ${name}.`,
        { recoverable: true },
      );
    if (tool.definition.requiresApproval && !context.policy.approvalId)
      throw new MaestroError("TOOL_APPROVAL_REQUIRED", `${name} exige aprovação explícita.`, {
        recoverable: true,
      });

    const idempotencyKey =
      suppliedIdempotencyKey ?? sha256(JSON.stringify([context.turnId, name, input]));
    const previous = await this.#persistence.findToolCallByIdempotencyKey?.(idempotencyKey);
    if (previous?.result && previous.call.status === "completed")
      return { call: previous.call, result: previous.result };
    if (previous?.call.status === "running" || previous?.call.status === "unknown_effect")
      throw new MaestroError(
        "TOOL_EFFECT_UNKNOWN",
        `O efeito anterior de ${name} ainda não é conhecido; a ação não será repetida.`,
        { recoverable: true },
      );

    const timestamp = new Date().toISOString();
    const call: ToolCall = {
      id: randomUUID(),
      turnId: context.turnId,
      runId: context.runId ?? null,
      toolName: name,
      input,
      status: "running",
      mutability: tool.definition.mutability,
      idempotencyKey,
      checkpointId: context.checkpointId ?? null,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
    };
    await this.#persistence.createToolCall?.(call);
    await context.onStarted?.(call);

    try {
      if (context.signal?.aborted)
        throw new MaestroError("TOOL_CANCELED", `A ferramenta ${name} foi cancelada.`, {
          recoverable: true,
        });
      const raw = await tool.handler(input, context);
      const normalized = isHandlerResult(raw) ? raw : { output: raw };
      let output = normalized.output;
      let artifactRef = normalized.artifactRef ?? null;
      let truncated = normalized.truncated ?? false;
      const serialized =
        typeof output === "string" ? output : (JSON.stringify(output) ?? String(output));
      if (serialized.length > this.#maxInlineBytes) {
        if (this.#artifacts)
          artifactRef = await this.#artifacts.put(serialized, {
            toolCallId: call.id,
            toolName: name,
          });
        const head = serialized.slice(0, Math.floor(this.#maxInlineBytes * 0.65));
        const tail = serialized.slice(-Math.floor(this.#maxInlineBytes * 0.25));
        output = `${head}\n… [resultado armazenado por referência: ${artifactRef ?? "indisponível"}] …\n${tail}`;
        truncated = true;
      }
      call.status = "completed";
      call.finishedAt = new Date().toISOString();
      await this.#persistence.updateToolCall?.(call);
      const result: ToolResult = {
        id: randomUUID(),
        toolCallId: call.id,
        output,
        isError: false,
        error: null,
        artifactRef,
        truncated,
        contentHash: normalized.contentHash ?? sha256(serialized),
        createdAt: call.finishedAt,
      };
      await this.#persistence.saveToolResult?.(result);
      return { call, result };
    } catch (error) {
      call.status =
        error instanceof MaestroError && error.code === "CONNECTOR_GRANT_DENIED"
          ? "denied"
          : tool.definition.mutability === "read"
            ? "failed"
            : "unknown_effect";
      call.finishedAt = new Date().toISOString();
      await this.#persistence.updateToolCall?.(call);
      const result: ToolResult = {
        id: randomUUID(),
        toolCallId: call.id,
        output: null,
        isError: true,
        error: errorMessage(error),
        artifactRef: null,
        truncated: false,
        contentHash: null,
        createdAt: call.finishedAt,
      };
      await this.#persistence.saveToolResult?.(result);
      throw error;
    }
  }
}

export function createBuiltinToolRegistry(services: BuiltinToolServices = {}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    {
      name: "fs.read",
      title: "Ler arquivo",
      description: "Lê um arquivo regular dentro das raízes autorizadas.",
      category: "filesystem",
      mutability: "read",
      inputSchema: schema(
        {
          path: { type: "string" },
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 2_000_000 },
        },
        ["path"],
      ),
      outputSchema: null,
      requiresApproval: false,
      idempotent: true,
    },
    async (raw, context) => {
      const input = objectInput(raw);
      const candidate = await assertPathWithinRoots(
        stringField(input, "path"),
        context.policy.readableRoots,
      );
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new MaestroError("UNSAFE_FILE_TYPE", `Leitura recusada para ${candidate}.`);
      const content = await readFile(candidate, "utf8");
      const offset = numberField(input, "offset", 0, 0, content.length);
      const limit = numberField(input, "limit", 256_000, 1, 2_000_000);
      const slice = content.slice(offset, offset + limit);
      return {
        output: {
          path: candidate,
          content: slice,
          offset,
          complete: offset + slice.length >= content.length,
        },
        contentHash: sha256(content),
      };
    },
  );
  registry.register(
    {
      name: "fs.glob",
      title: "Listar arquivos",
      description: "Lista caminhos por padrão glob sem seguir links simbólicos.",
      category: "search",
      mutability: "read",
      inputSchema: schema(
        { root: { type: "string" }, pattern: { type: "string" }, limit: { type: "integer" } },
        ["root", "pattern"],
      ),
      outputSchema: null,
      requiresApproval: false,
      idempotent: true,
    },
    async (raw, context) => {
      const input = objectInput(raw);
      const root = await assertPathWithinRoots(
        stringField(input, "root"),
        context.policy.readableRoots,
      );
      const pattern = globRegex(stringField(input, "pattern").replaceAll("\\", "/"));
      const limit = numberField(input, "limit", 500, 1, 5_000);
      const files = await walkFiles(root);
      return files
        .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
        .filter((file) => pattern.test(file))
        .slice(0, limit);
    },
  );
  registry.register(
    {
      name: "search.grep",
      title: "Pesquisar texto",
      description: "Pesquisa texto em arquivos regulares dentro do workspace.",
      category: "search",
      mutability: "read",
      inputSchema: schema(
        { root: { type: "string" }, query: { type: "string" }, limit: { type: "integer" } },
        ["root", "query"],
      ),
      outputSchema: null,
      requiresApproval: false,
      idempotent: true,
    },
    async (raw, context) => {
      const input = objectInput(raw);
      const root = await assertPathWithinRoots(
        stringField(input, "root"),
        context.policy.readableRoots,
      );
      const query = stringField(input, "query");
      const limit = numberField(input, "limit", 200, 1, 2_000);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of await walkFiles(root)) {
        if (matches.length >= limit) break;
        const metadata = await lstat(file).catch(() => null);
        if (!metadata?.isFile() || metadata.size > 2 * 1024 * 1024) continue;
        const content = await readFile(file, "utf8").catch(() => null);
        if (content === null || content.includes("\0")) continue;
        for (const [index, line] of content.split("\n").entries()) {
          if (!line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
          matches.push({
            path: path.relative(root, file),
            line: index + 1,
            text: line.slice(0, 2_000),
          });
          if (matches.length >= limit) break;
        }
      }
      return matches;
    },
  );

  const delegated = (
    name: string,
    title: string,
    category: ToolDefinition["category"],
    mutability: ToolDefinition["mutability"],
    handler: ((input: unknown, context: ToolExecutionContext) => Promise<unknown>) | undefined,
    requiresApproval = false,
    inputSchema: Record<string, unknown> = schema({}),
  ) => {
    registry.register(
      {
        name,
        title,
        description: `${title} por um executor estruturado do Maestro.`,
        category,
        mutability,
        inputSchema,
        outputSchema: null,
        requiresApproval,
        idempotent: mutability === "read",
      },
      async (input, context) => {
        if (!handler)
          throw new MaestroError("TOOL_BACKEND_UNAVAILABLE", `${title} não está configurado.`);
        return handler(input, context);
      },
    );
  };

  registry.register(
    {
      name: "fs.write",
      title: "Escrever arquivo",
      description: "Escreve um arquivo atomicamente dentro do escopo aprovado.",
      category: "filesystem",
      mutability: "workspace",
      inputSchema: schema(
        { path: { type: "string" }, content: { type: "string" }, expectedHash: { type: "string" } },
        ["path", "content"],
      ),
      outputSchema: null,
      requiresApproval: true,
      idempotent: true,
    },
    async (raw, context) => {
      const input = objectInput(raw);
      const requested = stringField(input, "path");
      const candidate = await assertPathWithinRoots(requested, context.policy.writableRoots, {
        allowMissing: true,
      });
      const existingMetadata = await lstat(candidate).catch(() => null);
      if (existingMetadata?.isSymbolicLink() || (existingMetadata && !existingMetadata.isFile()))
        throw new MaestroError("UNSAFE_FILE_TYPE", `Escrita recusada para ${candidate}.`);
      const existing = existingMetadata ? await readFile(candidate, "utf8") : null;
      const expectedHash = input.expectedHash;
      if (typeof expectedHash === "string" && sha256(existing ?? "") !== expectedHash)
        throw new MaestroError(
          "STALE_FILE_WRITE",
          `O arquivo mudou desde a última leitura: ${candidate}.`,
          { recoverable: true },
        );
      if (typeof input.content !== "string")
        throw new MaestroError("INVALID_TOOL_INPUT", "Campo obrigatório inválido: content.");
      const content = input.content;
      const temporary = `${candidate}.maestro-${randomUUID()}.tmp`;
      await writeFile(temporary, content, {
        encoding: "utf8",
        mode: existingMetadata?.mode ?? 0o600,
        flag: "wx",
      });
      try {
        await rename(temporary, candidate);
      } catch (error) {
        await unlink(temporary).catch(() => null);
        throw error;
      }
      return {
        output: { path: candidate, bytes: Buffer.byteLength(content) },
        contentHash: sha256(content),
      };
    },
  );
  registry.register(
    {
      name: "fs.edit",
      title: "Editar arquivo",
      description: "Substitui uma ocorrência exata em arquivo dentro do escopo aprovado.",
      category: "filesystem",
      mutability: "workspace",
      inputSchema: schema(
        {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          expectedHash: { type: "string" },
        },
        ["path", "oldText", "newText"],
      ),
      outputSchema: null,
      requiresApproval: true,
      idempotent: true,
    },
    async (raw, context) => {
      const input = objectInput(raw);
      const candidate = await assertPathWithinRoots(
        stringField(input, "path"),
        context.policy.writableRoots,
      );
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new MaestroError("UNSAFE_FILE_TYPE", `Edição recusada para ${candidate}.`);
      const content = await readFile(candidate, "utf8");
      if (typeof input.expectedHash === "string" && sha256(content) !== input.expectedHash)
        throw new MaestroError(
          "STALE_FILE_WRITE",
          `O arquivo mudou desde a última leitura: ${candidate}.`,
          { recoverable: true },
        );
      const oldText = stringField(input, "oldText");
      const first = content.indexOf(oldText);
      if (first < 0 || content.indexOf(oldText, first + oldText.length) >= 0)
        throw new MaestroError(
          "EDIT_MATCH_NOT_UNIQUE",
          "A edição exige exatamente uma ocorrência do texto antigo.",
          { recoverable: true },
        );
      const next = `${content.slice(0, first)}${typeof input.newText === "string" ? input.newText : ""}${content.slice(first + oldText.length)}`;
      const temporary = `${candidate}.maestro-${randomUUID()}.tmp`;
      await writeFile(temporary, next, { encoding: "utf8", mode: metadata.mode, flag: "wx" });
      try {
        await rename(temporary, candidate);
      } catch (error) {
        await unlink(temporary).catch(() => null);
        throw error;
      }
      return { output: { path: candidate, replacements: 1 }, contentHash: sha256(next) };
    },
  );
  registry.register(
    {
      name: "command.run",
      title: "Executar comando",
      description: "Executa um binário e argumentos estruturados, sem interpolação de shell.",
      category: "command",
      mutability: "workspace",
      inputSchema: schema(
        {
          executable: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutMs: { type: "integer" },
        },
        ["executable"],
      ),
      outputSchema: null,
      requiresApproval: true,
      idempotent: false,
    },
    async (raw, context) => {
      if (!services.command)
        throw new MaestroError("TOOL_BACKEND_UNAVAILABLE", "Executor de comandos não configurado.");
      const input = objectInput(raw);
      const command: CommandSpec = {
        executable: stringField(input, "executable"),
        args:
          Array.isArray(input.args) && input.args.every((arg) => typeof arg === "string")
            ? input.args
            : [],
        ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
        timeoutMs: numberField(input, "timeoutMs", 600_000, 1, 3_600_000),
      };
      return services.command(command, context);
    },
  );
  delegated("lsp.query", "Consultar LSP", "language", "read", services.lsp);
  delegated("question.ask", "Perguntar ao usuário", "question", "read", services.question);
  delegated("agent.task", "Delegar tarefa", "agent", "read", services.agent);
  delegated("skill.invoke", "Invocar skill", "skill", "read", services.skill);
  delegated(
    "mcp.read",
    "Ler recurso MCP",
    "mcp",
    "read",
    services.mcpRead,
    false,
    schema(
      {
        connectorId: { type: "string" },
        operation: { type: "string", enum: ["list_tools", "list_resources", "read_resource"] },
        uri: { type: "string" },
      },
      ["connectorId", "operation"],
    ),
  );
  delegated(
    "mcp.call",
    "Chamar ferramenta MCP",
    "mcp",
    "external",
    services.mcp,
    true,
    schema(
      {
        connectorId: { type: "string" },
        name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      ["connectorId", "name"],
    ),
  );
  delegated(
    "github.read",
    "Consultar GitHub",
    "web",
    "read",
    services.githubRead,
    false,
    schema(
      {
        connectorId: { type: "string" },
        path: { type: "string" },
        query: { type: "object", additionalProperties: true },
      },
      ["connectorId", "path"],
    ),
  );
  delegated(
    "github.mutate",
    "Alterar dados no GitHub",
    "web",
    "external",
    services.githubMutate,
    true,
    schema(
      {
        connectorId: { type: "string" },
        method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string" },
        body: { type: "object", additionalProperties: true },
      },
      ["connectorId", "method", "path"],
    ),
  );
  delegated("web.access", "Acessar web", "web", "external", services.web, true);
  return registry;
}
