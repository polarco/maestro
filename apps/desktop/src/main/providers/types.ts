import type { MaestroRepository } from "@maestro/database";
import type { VaultService } from "../services/vault.js";
import type { ProcessSupervisor } from "../services/process-supervisor.js";

export interface ProviderDependencies {
  repository: MaestroRepository;
  vault: VaultService;
  supervisor: ProcessSupervisor;
  userDataDirectory: string;
}

export type ProviderConfig = Record<string, string | number | boolean | null>;

export function configString(config: ProviderConfig, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function configNumber(config: ProviderConfig, key: string): number | null {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
