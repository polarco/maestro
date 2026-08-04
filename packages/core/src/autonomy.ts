import type { AutonomyLevel, AutonomyProfile, ToolMutability } from "@maestro/contracts";

export interface AutonomyRequest {
  mutability: ToolMutability;
  destructive?: boolean;
  publishes?: boolean;
  deploys?: boolean;
  pushes?: boolean;
  externalMutation?: boolean;
  path?: string;
  tool?: string;
  command?: string;
  network?: "denied" | "web" | "full";
}

export interface AutonomyDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
}

function withinAllowedPath(path: string, roots: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return roots.some((root) => {
    const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === base || normalized.startsWith(`${base}/`);
  });
}

/** Destructive and externally visible actions never inherit project autonomy. */
export function decideAutonomy(
  profile: Pick<
    AutonomyProfile,
    "level" | "allowedPaths" | "allowedTools" | "allowedCommands" | "network"
  >,
  request: AutonomyRequest,
): AutonomyDecision {
  if (
    request.destructive ||
    request.publishes ||
    request.deploys ||
    request.pushes ||
    request.externalMutation ||
    request.mutability === "external"
  )
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "Ações destrutivas ou externas sempre exigem confirmação explícita.",
    };
  if (request.mutability === "read")
    return { allowed: true, requiresConfirmation: false, reason: "Leitura local autorizada." };
  if (profile.level === "observe")
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "O perfil observe permite somente leitura.",
    };
  if (profile.level === "review")
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "O perfil review exige aprovação antes de mutações.",
    };
  if (request.path && !withinAllowedPath(request.path, profile.allowedPaths))
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "Path fora do escopo pré-aprovado.",
    };
  if (request.tool && !profile.allowedTools.includes(request.tool))
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "Ferramenta fora do escopo pré-aprovado.",
    };
  if (request.command && !profile.allowedCommands.includes(request.command))
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: "Comando fora do escopo pré-aprovado.",
    };
  if (request.network && request.network !== "denied") {
    const ranks = { denied: 0, web: 1, full: 2 } as const;
    if (ranks[request.network] > ranks[profile.network])
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: "Rede solicitada além do escopo pré-aprovado.",
      };
  }
  return {
    allowed: true,
    requiresConfirmation: false,
    reason: "Ação dentro do escopo autopilot pré-aprovado.",
  };
}

export function defaultAutonomyLevel(): AutonomyLevel {
  return "review";
}
