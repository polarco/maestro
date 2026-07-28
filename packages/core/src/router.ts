import type { ModelCapability, ModelSelection, ProviderSummary } from "@maestro/contracts";
import { MaestroError } from "./errors.js";

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
  requirements: CapabilityRequirements;
  suggested?: ModelSelection | null;
  fixed?: ModelSelection | null;
  preferredProviderIds?: string[];
}

export interface RouteDecision {
  selection: ModelSelection;
  capability: ModelCapability;
  source: "fixed" | "suggested" | "deterministic";
  rationale: string;
}

function meetsRequirements(capability: ModelCapability, required: CapabilityRequirements): boolean {
  if (required.chat === true && !capability.chat) return false;
  if (required.coding === true && !capability.coding) return false;
  if (required.tools === true && !capability.tools) return false;
  if (required.vision === true && !capability.vision) return false;
  if (required.structuredOutput === true && !capability.structuredOutput) return false;
  if (
    required.minimumContextWindow !== undefined &&
    (capability.contextWindow === null || capability.contextWindow < required.minimumContextWindow)
  ) {
    return false;
  }
  return true;
}

function findCandidate(
  providers: readonly ProviderSummary[],
  selection: ModelSelection,
  required: CapabilityRequirements,
) {
  const provider = providers.find((item) => item.descriptor.id === selection.providerId);
  if (!provider || provider.health.status !== "ready") return null;
  const model = provider.models.find((item) => item.id === selection.modelId);
  if (!model || !meetsRequirements(model.capabilities, required)) return null;
  const supportedEfforts = model.capabilities.reasoningEffort;
  const effort = selection.effort;
  if (
    effort &&
    effort !== "none" &&
    supportedEfforts.length > 0 &&
    !supportedEfforts.includes(effort)
  ) {
    return null;
  }
  return { provider, model };
}

export function routeModel(request: RouteRequest): RouteDecision {
  if (request.fixed) {
    const fixed = findCandidate(request.providers, request.fixed, request.requirements);
    if (!fixed) {
      throw new MaestroError(
        "FIXED_MODEL_UNAVAILABLE",
        `O modelo fixado ${request.fixed.providerId}/${request.fixed.modelId} não está disponível ou não é compatível com ${request.role}.`,
        { recoverable: true },
      );
    }
    return {
      selection: request.fixed,
      capability: fixed.model.capabilities,
      source: "fixed",
      rationale: "Modelo fixado pelo usuário e validado contra disponibilidade e capacidades.",
    };
  }

  if (request.suggested) {
    const suggested = findCandidate(request.providers, request.suggested, request.requirements);
    if (suggested) {
      return {
        selection: request.suggested,
        capability: suggested.model.capabilities,
        source: "suggested",
        rationale: "Recomendação do analista aceita após validação determinística.",
      };
    }
  }

  const providerOrder = new Map(
    (request.preferredProviderIds ?? []).map((providerId, index) => [providerId, index]),
  );
  const candidates = request.providers
    .filter((provider) => provider.health.status === "ready")
    .flatMap((provider) =>
      provider.models
        .filter((model) => meetsRequirements(model.capabilities, request.requirements))
        .map((model) => ({ provider, model })),
    )
    .sort((left, right) => {
      const leftRank = providerOrder.get(left.provider.descriptor.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = providerOrder.get(right.provider.descriptor.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (left.model.isDefault !== right.model.isDefault) return left.model.isDefault ? -1 : 1;
      return left.model.name.localeCompare(right.model.name);
    });

  const first = candidates[0];
  if (!first) {
    throw new MaestroError(
      "NO_COMPATIBLE_MODEL",
      `Nenhum modelo disponível atende às capacidades exigidas para ${request.role}.`,
      { recoverable: true, detail: request.requirements },
    );
  }

  return {
    selection: {
      providerId: first.provider.descriptor.id,
      modelId: first.model.id,
      effort: first.model.capabilities.reasoningEffort.includes("medium") ? "medium" : "none",
    },
    capability: first.model.capabilities,
    source: "deterministic",
    rationale:
      "Fallback determinístico pela disponibilidade, compatibilidade e preferência configurada.",
  };
}
