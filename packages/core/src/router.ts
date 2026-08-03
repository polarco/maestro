import { randomUUID } from "node:crypto";
import type {
  ModelCapability,
  ModelSelection,
  ModelTelemetry,
  ProviderConnectionSummary,
  ProviderModel,
  ProviderSummary,
  RoutingCandidate,
  RoutingDecision as PersistedRoutingDecision,
  RoutingProfile,
} from "@maestro/contracts";
import { MaestroError } from "./errors.js";
import { telemetryHeadroom } from "./recovery.js";

export interface CapabilityRequirements {
  chat?: boolean;
  coding?: boolean;
  tools?: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
  minimumContextWindow?: number;
}

export interface RouteRequest {
  role: string;
  providers: readonly ProviderSummary[];
  connections?: readonly ProviderConnectionSummary[];
  requirements: CapabilityRequirements;
  suggested?: ModelSelection | null;
  /** Strict legacy pin: incompatibility is an error and never falls back. */
  fixed?: ModelSelection | null;
  /** Preferred first candidate. Falls back unless noFallback is true. */
  pin?: ModelSelection | null;
  noFallback?: boolean;
  profile?: RoutingProfile;
  minimumQuality?: number;
  preferredProviderIds?: string[];
  telemetry?: readonly ModelTelemetry[];
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  activeSelection?: ModelSelection | null;
  cachedSelections?: readonly ModelSelection[];
  excludedSelections?: readonly ModelSelection[];
  now?: Date;
}

export interface RouteDecision {
  selection: ModelSelection;
  capability: ModelCapability;
  source: "fixed" | "pinned" | "suggested" | "automatic" | "deterministic";
  rationale: string;
  profile: RoutingProfile;
  fallbackAllowed: boolean;
  candidates: RoutingCandidate[];
}

function meetsRequirements(
  capability: ModelCapability,
  required: CapabilityRequirements,
): string[] {
  const reasons: string[] = [];
  if (required.chat === true && !capability.chat) reasons.push("chat");
  if (required.coding === true && !capability.coding) reasons.push("coding");
  if (required.tools === true && !capability.tools) reasons.push("tools");
  if (required.vision === true && !capability.vision) reasons.push("vision");
  if (required.structuredOutput === true && !capability.structuredOutput)
    reasons.push("structured-output");
  if (
    required.minimumContextWindow !== undefined &&
    (capability.contextWindow === null || capability.contextWindow < required.minimumContextWindow)
  )
    reasons.push("context-window");
  return reasons;
}

function selectionKey(selection: ModelSelection): string {
  return `${selection.providerId}:${selection.connectionId ?? "default"}:${selection.modelId}`;
}

function matches(left: ModelSelection, right: ModelSelection): boolean {
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    (right.connectionId === undefined || left.connectionId === right.connectionId)
  );
}

function qualityFor(role: string, model: ProviderModel): number {
  const normalizedRole = /implement|test/i.test(role)
    ? "coding"
    : /review/i.test(role)
      ? "review"
      : /plan|analy/i.test(role)
        ? "planning"
        : /research|discover/i.test(role)
          ? "research"
          : "answer";
  const declared = model.quality?.[normalizedRole];
  if (typeof declared === "number") return Math.max(0, Math.min(1, declared));
  if (normalizedRole === "coding") return model.capabilities.coding ? 0.72 : 0.2;
  if (normalizedRole === "review") return model.capabilities.coding ? 0.68 : 0.45;
  if (normalizedRole === "planning") return model.capabilities.structuredOutput ? 0.7 : 0.5;
  if (normalizedRole === "research") return model.capabilities.tools ? 0.7 : 0.58;
  return model.capabilities.chat ? 0.62 : 0.2;
}

function floorFor(profile: RoutingProfile): number {
  if (profile === "deep") return 0.68;
  if (profile === "fast") return 0.42;
  return 0.5;
}

function marginalCost(
  provider: ProviderSummary,
  model: ProviderModel,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (provider.descriptor.kind === "cli" || provider.descriptor.kind === "local") return 0;
  if (
    !model.pricing ||
    model.pricing.inputUsdPerMillion === null ||
    model.pricing.outputUsdPerMillion === null
  )
    return null;
  return (
    (inputTokens / 1_000_000) * model.pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * model.pricing.outputUsdPerMillion
  );
}

function telemetryFor(
  telemetry: readonly ModelTelemetry[],
  selection: ModelSelection,
): ModelTelemetry | undefined {
  return telemetry.find(
    (item) =>
      item.providerId === selection.providerId &&
      item.modelId === selection.modelId &&
      (selection.connectionId === undefined || item.connectionId === selection.connectionId),
  );
}

function buildCandidates(request: RouteRequest): RoutingCandidate[] {
  const profile = request.profile ?? "economical";
  const floor = request.minimumQuality ?? floorFor(profile);
  const telemetry = request.telemetry ?? [];
  const excluded = request.excludedSelections ?? [];
  const cached = new Set((request.cachedSelections ?? []).map(selectionKey));
  const now = (request.now ?? new Date()).getTime();
  return request.providers.flatMap((provider) => {
    const connectionSources =
      provider.descriptor.kind === "cli"
        ? (request.connections ?? [])
            .filter((item) => item.connection.providerId === provider.descriptor.id)
            .flatMap((connection) =>
              (connection.models.length > 0 ? connection.models : provider.models).map((model) => ({
                model,
                connection,
                selection: {
                  providerId: provider.descriptor.id,
                  connectionId: connection.connection.id,
                  modelId: model.id,
                } satisfies ModelSelection,
              })),
            )
        : [];
    const sources =
      connectionSources.length > 0
        ? connectionSources
        : provider.models.map((model) => ({
            model,
            connection: null,
            selection: {
              providerId: provider.descriptor.id,
              modelId: model.id,
            } satisfies ModelSelection,
          }));
    return sources.map(({ model, connection, selection }): RoutingCandidate => {
      const metric = telemetryFor(telemetry, selection);
      const excludedReasons = meetsRequirements(model.capabilities, request.requirements);
      const quality = qualityFor(request.role, model);
      const health = connection?.health ?? provider.health;
      if (health.status !== "ready" || (connection && !connection.connection.enabled))
        excludedReasons.push("provider-unavailable");
      if (connection && connection.activeSessions >= connection.connection.concurrencyLimit)
        excludedReasons.push("concurrency-limit");
      if (quality < floor) excludedReasons.push("quality-floor");
      if (excluded.some((item) => matches(selection, item))) excludedReasons.push("excluded");
      const cooldown = metric?.cooldownUntil ? Date.parse(metric.cooldownUntil) : 0;
      const circuitState =
        metric?.circuitState === "open" && cooldown > 0 && cooldown <= now
          ? "half_open"
          : (metric?.circuitState ?? (cooldown > now ? "open" : "closed"));
      if (circuitState === "open" || cooldown > now) excludedReasons.push("circuit-open");
      const active = request.activeSelection && matches(selection, request.activeSelection) ? 1 : 0;
      const connectionHeadroom = connection
        ? Math.max(
            0,
            1 - connection.activeSessions / Math.max(1, connection.connection.concurrencyLimit),
          )
        : 0.5;
      return {
        selection,
        capability: model.capabilities,
        eligible: excludedReasons.length === 0,
        excludedReasons,
        quality,
        marginalCostUsd: marginalCost(
          provider,
          model,
          Math.max(0, request.estimatedInputTokens ?? 0),
          Math.max(0, request.estimatedOutputTokens ?? 0),
        ),
        sessionAffinity: active,
        reliability: metric?.successRate ?? 0.9,
        headroom: metric
          ? (telemetryHeadroom(metric) + connectionHeadroom) / 2
          : connectionHeadroom,
        latencyMs: metric?.latencyEwmaMs ?? null,
        cacheAffinity: cached.has(selectionKey(selection)) || active > 0 ? 1 : 0,
        circuitState,
      };
    });
  });
}

function candidateFor(
  candidates: readonly RoutingCandidate[],
  selection: ModelSelection,
): RoutingCandidate | null {
  const candidate = candidates.find((item) => matches(item.selection, selection));
  if (!candidate?.eligible) return null;
  const efforts = candidate.capability.reasoningEffort;
  if (
    selection.effort &&
    selection.effort !== "none" &&
    efforts.length > 0 &&
    !efforts.includes(selection.effort)
  )
    return null;
  return {
    ...candidate,
    selection: {
      ...candidate.selection,
      ...(selection.effort ? { effort: selection.effort } : {}),
    },
  };
}

function compareCandidates(
  request: RouteRequest,
  left: RoutingCandidate,
  right: RoutingCandidate,
): number {
  const leftCost = left.marginalCostUsd ?? Number.POSITIVE_INFINITY;
  const rightCost = right.marginalCostUsd ?? Number.POSITIVE_INFINITY;
  if ((request.profile ?? "economical") === "fast") {
    const leftLatency = left.latencyMs ?? Number.POSITIVE_INFINITY;
    const rightLatency = right.latencyMs ?? Number.POSITIVE_INFINITY;
    if (leftLatency !== rightLatency) return leftLatency - rightLatency;
  }
  if (leftCost !== rightCost) return leftCost - rightCost;
  if (left.sessionAffinity !== right.sessionAffinity)
    return right.sessionAffinity - left.sessionAffinity;
  if (left.cacheAffinity !== right.cacheAffinity) return right.cacheAffinity - left.cacheAffinity;
  if (left.reliability !== right.reliability) return right.reliability - left.reliability;
  if (left.headroom !== right.headroom) return right.headroom - left.headroom;
  if ((request.profile ?? "economical") !== "fast") {
    const leftLatency = left.latencyMs ?? Number.POSITIVE_INFINITY;
    const rightLatency = right.latencyMs ?? Number.POSITIVE_INFINITY;
    if (leftLatency !== rightLatency) return leftLatency - rightLatency;
  }
  const order = new Map((request.preferredProviderIds ?? []).map((id, index) => [id, index]));
  const providerRank =
    (order.get(left.selection.providerId) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.selection.providerId) ?? Number.MAX_SAFE_INTEGER);
  if (providerRank !== 0) return providerRank;
  if (left.quality !== right.quality) return right.quality - left.quality;
  return selectionKey(left.selection).localeCompare(selectionKey(right.selection));
}

function result(
  candidate: RoutingCandidate,
  source: RouteDecision["source"],
  rationale: string,
  profile: RoutingProfile,
  fallbackAllowed: boolean,
  candidates: RoutingCandidate[],
): RouteDecision {
  return {
    selection: candidate.selection,
    capability: candidate.capability,
    source,
    rationale,
    profile,
    fallbackAllowed,
    candidates,
  };
}

export function routeModel(request: RouteRequest): RouteDecision {
  const profile = request.profile ?? "economical";
  const candidates = buildCandidates(request);
  if (request.fixed) {
    const fixed = candidateFor(candidates, request.fixed);
    if (!fixed)
      throw new MaestroError(
        "FIXED_MODEL_UNAVAILABLE",
        `O modelo fixado ${request.fixed.providerId}/${request.fixed.modelId} não está disponível ou não é compatível com ${request.role}.`,
        { recoverable: true },
      );
    return result(
      fixed,
      "fixed",
      "Modelo fixado pelo usuário e validado contra disponibilidade, qualidade e capacidades.",
      profile,
      false,
      candidates,
    );
  }

  if (request.pin) {
    const pinned = candidateFor(candidates, request.pin);
    if (pinned)
      return result(
        pinned,
        "pinned",
        "Preferência manual usada como primeira opção após os filtros obrigatórios.",
        profile,
        !request.noFallback,
        candidates,
      );
    if (request.noFallback)
      throw new MaestroError(
        "PINNED_MODEL_UNAVAILABLE",
        `O modelo escolhido ${request.pin.providerId}/${request.pin.modelId} está indisponível e o fallback foi desativado.`,
        { recoverable: true },
      );
  }

  if (request.suggested) {
    const suggested = candidateFor(candidates, request.suggested);
    if (suggested)
      return result(
        suggested,
        "suggested",
        "Recomendação aceita após os filtros obrigatórios de capacidade e qualidade.",
        profile,
        !request.noFallback,
        candidates,
      );
  }

  const eligible = candidates
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => compareCandidates(request, left, right));
  const first = eligible[0];
  if (!first)
    throw new MaestroError(
      "NO_COMPATIBLE_MODEL",
      `Nenhum modelo disponível atende às capacidades e à qualidade mínima exigidas para ${request.role}.`,
      { recoverable: true, detail: { requirements: request.requirements, candidates } },
    );
  return result(
    first,
    request.profile ? "automatic" : "deterministic",
    "Seleção lexicográfica: filtros obrigatórios, menor custo marginal esperado e desempate por afinidade, confiabilidade, folga e latência.",
    profile,
    !request.noFallback,
    candidates,
  );
}

export function persistedRoutingDecision(
  decision: RouteDecision,
  input: { turnId?: string | null; role: string; createdAt?: string },
): PersistedRoutingDecision {
  const selected = decision.candidates.find((candidate) =>
    matches(candidate.selection, decision.selection),
  );
  if (!selected)
    throw new MaestroError("ROUTING_DECISION_INVALID", "Candidato selecionado ausente.");
  return {
    id: randomUUID(),
    turnId: input.turnId ?? null,
    role: input.role,
    profile: decision.profile,
    selected: { ...selected, selection: decision.selection },
    candidates: decision.candidates,
    pinned: decision.source === "fixed" || decision.source === "pinned",
    fallbackAllowed: decision.fallbackAllowed,
    rationale: decision.rationale,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
