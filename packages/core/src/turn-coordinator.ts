import { createHash, randomUUID } from "node:crypto";
import type { ExecutionPolicy, ModelPreference, Turn, TurnIntent } from "@maestro/contracts";

export interface TurnClassificationContext {
  hasWorkspace: boolean;
  awaitingApproval?: boolean;
  approvedPlanVersion?: number | null;
  priorPath?: TurnIntent["path"];
}

export interface StartTurnInput extends TurnClassificationContext {
  id?: string;
  conversationId: string;
  runId?: string | null;
  sequence: number;
  prompt: string;
  readableRoots: string[];
  modelPreference?: Partial<ModelPreference>;
  inputMessageId?: string | null;
  intent?: TurnIntent;
}

export interface TurnPersistence {
  createTurn(turn: Turn): Promise<Turn>;
}

const CHANGE_VERBS =
  /\b(?:implemente|implementa|execute|executar|adicione|adicione|crie|criar|construa|altere|mude|corrija|conserte|remova|delete|refatore|migre|atualize|faça|faca|build|implement|execute|run|add|create|change|fix|remove|delete|refactor|migrate|update|write)\b/i;
const RESEARCH_VERBS =
  /\b(?:analise|investigue|pesquise|procure|localize|encontre|revise|explique.{0,30}(?:repo|projeto|código|codigo)|inspect|investigate|research|search|find|review|explain.{0,30}(?:repo|project|codebase))\b/i;
const WORKSPACE_REFERENCES =
  /(?:\b(?:workspace|repo(?:sitório|sitory)?|projeto|codebase|código[- ]fonte|source code)\b|(?:^|\s)(?:src|apps|packages|test|tests)\/|\.[a-z0-9]{1,8}\b)/i;
const APPROVAL =
  /\b(?:aprovo|aprovado|pode executar|execute o plano|prosseguir com o plano|approved|go ahead|execute the plan|proceed)\b/i;
const HOW_TO =
  /^(?:como|por que|porque|qual|quais|o que|onde|quando|how|why|what|which|where|when)\b/i;

function normalizedPrompt(prompt: string): string {
  return prompt.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function materialDecisions(prompt: string): string[] {
  const decisions: string[] = [];
  if (/\b(?:ou|versus|vs\.?|either)\b/i.test(prompt))
    decisions.push("Há alternativas explícitas no pedido que podem mudar a solução.");
  if (/\b(?:não sei|decida por mim|qualquer um|unsure|you decide)\b/i.test(prompt))
    decisions.push("O usuário delegou ou deixou aberta uma decisão de implementação.");
  return decisions;
}

/**
 * Conservative local classifier. A provider may refine its rationale, but it
 * cannot downgrade a mutating request to a read-only path.
 */
export function classifyTurnIntent(prompt: string, context: TurnClassificationContext): TurnIntent {
  const value = normalizedPrompt(prompt);
  const command = value.match(/^\/(plan|review|status|compact|model|fork)\b/i)?.[1]?.toLowerCase();
  const decisions = materialDecisions(value);

  if ((context.awaitingApproval || context.approvedPlanVersion) && APPROVAL.test(value)) {
    return {
      path: "execute",
      category: "approved_execution",
      confidence: 0.99,
      rationale: "O pedido libera explicitamente um plano já apresentado.",
      requiresWorkspace: true,
      requiresApproval: false,
      materialDecisions: [],
      requestedCapabilities: ["workspace-write", "commands"],
    };
  }

  if (command === "plan") {
    return {
      path: "plan",
      category: "change_request",
      confidence: 1,
      rationale: "O comando /plan solicita planejamento explícito sem execução.",
      requiresWorkspace: context.hasWorkspace,
      requiresApproval: true,
      materialDecisions: decisions,
      requestedCapabilities: ["workspace-read", "planning"],
    };
  }

  if (command === "review" || (RESEARCH_VERBS.test(value) && context.hasWorkspace)) {
    return {
      path: "research",
      category: "workspace_question",
      confidence: command ? 1 : 0.9,
      rationale: "O pedido requer inspecionar o workspace, mas não autoriza alterações.",
      requiresWorkspace: true,
      requiresApproval: false,
      materialDecisions: [],
      requestedCapabilities: ["workspace-read", "search"],
    };
  }

  const asksHowTo = HOW_TO.test(value);
  if (CHANGE_VERBS.test(value) && !asksHowTo) {
    return {
      path: "plan",
      category: "change_request",
      confidence: 0.94,
      rationale: "O pedido contém uma solicitação de mudança; a escrita depende de plano aprovado.",
      requiresWorkspace: context.hasWorkspace,
      requiresApproval: true,
      materialDecisions: decisions,
      requestedCapabilities: ["workspace-read", "planning", "workspace-write"],
    };
  }

  if (context.hasWorkspace && WORKSPACE_REFERENCES.test(value)) {
    return {
      path: "research",
      category: "workspace_question",
      confidence: 0.82,
      rationale:
        "A resposta depende de fatos do workspace e pode ser produzida em modo somente leitura.",
      requiresWorkspace: true,
      requiresApproval: false,
      materialDecisions: [],
      requestedCapabilities: ["workspace-read", "search"],
    };
  }

  return {
    path: "answer",
    category: context.priorPath ? "continuation" : "simple_question",
    confidence: 0.78,
    rationale: "O pedido pode ser respondido diretamente, sem pesquisa ou mutação do workspace.",
    requiresWorkspace: false,
    requiresApproval: false,
    materialDecisions: [],
    requestedCapabilities: ["chat"],
  };
}

export function executionPolicyHash(
  value: Omit<ExecutionPolicy, "scopeHash"> | ExecutionPolicy,
): string {
  const scope = {
    readableRoots: value.readableRoots,
    writableRoots: value.writableRoots,
    allowedTools: value.allowedTools,
    allowedExecutables: value.allowedExecutables,
    network: value.network,
    externalMutations: value.externalMutations,
    approvedPlanVersion: value.approvedPlanVersion,
  };
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

export function policyForIntent(
  intent: TurnIntent,
  readableRoots: string[],
  approvedPlanVersion: number | null = null,
): ExecutionPolicy {
  const canWrite = intent.path === "execute" && approvedPlanVersion !== null;
  const base: Omit<ExecutionPolicy, "scopeHash"> = {
    readableRoots: intent.requiresWorkspace ? [...readableRoots] : [],
    writableRoots: canWrite ? [...readableRoots] : [],
    allowedTools:
      intent.path === "answer"
        ? []
        : intent.path === "research"
          ? ["fs.read", "fs.glob", "search.grep", "lsp.query"]
          : canWrite
            ? [
                "fs.read",
                "fs.glob",
                "search.grep",
                "lsp.query",
                "fs.edit",
                "fs.write",
                "command.run",
              ]
            : ["fs.read", "fs.glob", "search.grep", "lsp.query"],
    allowedExecutables: [],
    network: "denied",
    externalMutations: false,
    writeApproved: canWrite,
    approvalId: null,
    approvedPlanVersion,
  };
  return { ...base, scopeHash: executionPolicyHash(base) };
}

export class TurnCoordinator {
  readonly #persistence: TurnPersistence;

  constructor(persistence: TurnPersistence) {
    this.#persistence = persistence;
  }

  async start(input: StartTurnInput): Promise<Turn> {
    const intent = input.intent ?? classifyTurnIntent(input.prompt, input);
    const policy = policyForIntent(intent, input.readableRoots, input.approvedPlanVersion ?? null);
    const timestamp = new Date().toISOString();
    const preference: ModelPreference = {
      mode: input.modelPreference?.mode ?? "auto",
      profile: input.modelPreference?.profile ?? "economical",
      pin: input.modelPreference?.pin ?? null,
      noFallback: input.modelPreference?.noFallback ?? false,
    };
    return this.#persistence.createTurn({
      id: input.id ?? randomUUID(),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      sequence: input.sequence,
      state: "classified",
      intent,
      policy,
      modelPreference: preference,
      selectedModel: null,
      inputMessageId: input.inputMessageId ?? null,
      outputMessageId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      error: null,
    });
  }
}
