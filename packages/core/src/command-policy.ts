import path from "node:path";
import type { CommandSpec, ExecutionPolicy, PermissionSpec } from "@maestro/contracts";
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

const NETWORK_EXECUTABLES = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "ftp",
  "sftp",
  "nc",
  "ncat",
]);

function assertStructuredArguments(command: CommandSpec): void {
  if (command.args.some((argument) => argument.includes("\0")))
    throw new MaestroError("INVALID_COMMAND_ARGUMENT", "Argumento de comando contém byte nulo.");
  if (command.executable.includes("\0") || /[\r\n]/.test(command.executable))
    throw new MaestroError("INVALID_COMMAND_EXECUTABLE", "Executável de comando inválido.");
}

export async function assertCommandAllowed(
  command: CommandSpec,
  permissions: PermissionSpec,
  canonicalRoots: readonly string[],
  defaultCwd: string,
): Promise<{ executable: string; args: string[]; cwd: string; timeoutMs: number }> {
  assertStructuredArguments(command);
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

export async function assertStructuredCommandAllowed(
  command: CommandSpec,
  policy: ExecutionPolicy,
  defaultCwd: string,
): Promise<{ executable: string; args: string[]; cwd: string; timeoutMs: number }> {
  assertStructuredArguments(command);
  if (!policy.writeApproved || !policy.approvalId)
    throw new MaestroError(
      "COMMAND_APPROVAL_REQUIRED",
      "Comandos mutáveis exigem uma aprovação persistida e vinculada ao escopo.",
      { recoverable: true },
    );
  const executableName = path.basename(command.executable).toLowerCase();
  if (SHELL_EXECUTABLES.has(executableName))
    throw new MaestroError(
      "SHELL_INTERPOLATION_BLOCKED",
      `Shell genérico bloqueado; use executável e argumentos explícitos: ${executableName}`,
    );
  const rule = policy.allowedExecutables.find(
    (candidate) => path.basename(candidate.executable).toLowerCase() === executableName,
  );
  if (!rule)
    throw new MaestroError(
      "COMMAND_NOT_APPROVED",
      `O executável ${executableName} não faz parte do escopo aprovado.`,
      { recoverable: true },
    );
  if (rule.argsPrefix.some((argument, index) => command.args[index] !== argument))
    throw new MaestroError(
      "COMMAND_ARGUMENTS_NOT_APPROVED",
      `Os argumentos de ${executableName} ampliam o escopo aprovado.`,
      { recoverable: true },
    );
  if (policy.network === "denied" && NETWORK_EXECUTABLES.has(executableName))
    throw new MaestroError("NETWORK_NOT_ALLOWED", `Rede bloqueada para ${executableName}.`);
  const joinedArgs = command.args.join(" ").trim();
  const externalMutation = EXTERNAL_MUTATIONS.find(
    ([binary, pattern]) => executableName === binary && pattern.test(joinedArgs),
  );
  if (externalMutation && !policy.externalMutations)
    throw new MaestroError(
      "EXTERNAL_MUTATION_BLOCKED",
      `Mutação externa bloqueada: ${executableName} ${joinedArgs}`,
    );
  const roots = rule.cwdRoots.length > 0 ? rule.cwdRoots : policy.writableRoots;
  const cwd = await assertPathWithinRoots(command.cwd ?? defaultCwd, roots);
  return {
    executable: command.executable,
    args: [...command.args],
    cwd,
    timeoutMs: command.timeoutMs,
  };
}
