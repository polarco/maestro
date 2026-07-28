import path from "node:path";
import type { CommandSpec, PermissionSpec } from "@maestro/contracts";
import { MaestroError } from "./errors.js";
import { assertPathWithinRoots } from "./path-policy.js";

const SHELL_EXECUTABLES = new Set([
  "bash",
  "sh",
  "zsh",
  "fish",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const EXTERNAL_MUTATIONS: readonly [string, RegExp][] = [
  ["git", /^(push|send-email)$/i],
  ["npm", /^(publish|unpublish|deprecate)$/i],
  ["pnpm", /^(publish|deploy)$/i],
  ["yarn", /^npm\s+publish$/i],
  ["docker", /^(push|login)$/i],
  ["kubectl", /^(apply|create|delete|replace|rollout)$/i],
  ["terraform", /^(apply|destroy)$/i],
  ["gh", /^(pr\s+create|release\s+create|repo\s+delete)$/i],
];

export async function assertCommandAllowed(
  command: CommandSpec,
  permissions: PermissionSpec,
  canonicalRoots: readonly string[],
  defaultCwd: string,
): Promise<{ executable: string; args: string[]; cwd: string; timeoutMs: number }> {
  if (!permissions.runCommands) {
    throw new MaestroError("COMMANDS_NOT_ALLOWED", "O plano não autorizou execução de comandos.");
  }

  const executableName = path.basename(command.executable).toLowerCase();
  if (SHELL_EXECUTABLES.has(executableName)) {
    throw new MaestroError(
      "SHELL_INTERPOLATION_BLOCKED",
      `Shell genérico bloqueado; use executável e argumentos explícitos: ${executableName}`,
    );
  }

  const denied = new Set(permissions.deniedCommands.map((item) => item.toLowerCase()));
  if (denied.has(executableName)) {
    throw new MaestroError("COMMAND_DENIED", `Comando bloqueado pela política: ${executableName}`);
  }
  if (
    permissions.allowedCommands.length > 0 &&
    !permissions.allowedCommands.map((item) => item.toLowerCase()).includes(executableName)
  ) {
    throw new MaestroError(
      "COMMAND_NOT_ALLOWLISTED",
      `Comando fora da allowlist: ${executableName}`,
    );
  }

  const joinedArgs = command.args.join(" ").trim();
  const externalMutation = EXTERNAL_MUTATIONS.find(
    ([binary, pattern]) => executableName === binary && pattern.test(joinedArgs),
  );
  if (externalMutation) {
    throw new MaestroError(
      "EXTERNAL_MUTATION_BLOCKED",
      `Mutação externa permanece bloqueada após a aprovação do plano: ${executableName} ${joinedArgs}`,
    );
  }

  const cwd = await assertPathWithinRoots(command.cwd ?? defaultCwd, canonicalRoots);
  return {
    executable: command.executable,
    args: [...command.args],
    cwd,
    timeoutMs: command.timeoutMs,
  };
}
