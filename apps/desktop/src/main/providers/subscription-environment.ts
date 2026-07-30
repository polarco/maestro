import process from "node:process";
import path from "node:path";
import type { ProviderConnection } from "@maestro/contracts";

// Variables that could silently redirect a CLI session to metered API billing,
// a gateway, or a cloud provider. Subscription workers never inherit them.
const PAID_OR_ALTERNATE_AUTH_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUD_ML_REGION",
  "AZURE_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "CODEX_ACCESS_TOKEN",
];

function userExecutableDirectories(source: NodeJS.ProcessEnv): string[] {
  const home = source.HOME?.trim() || source.USERPROFILE?.trim();
  return [
    source.NVM_BIN,
    source.PNPM_HOME,
    source.NPM_CONFIG_PREFIX
      ? process.platform === "win32"
        ? source.NPM_CONFIG_PREFIX
        : path.join(source.NPM_CONFIG_PREFIX, "bin")
      : undefined,
    source.BUN_INSTALL ? path.join(source.BUN_INSTALL, "bin") : undefined,
    source.VOLTA_HOME ? path.join(source.VOLTA_HOME, "bin") : undefined,
    source.CARGO_HOME ? path.join(source.CARGO_HOME, "bin") : undefined,
    source.APPDATA ? path.join(source.APPDATA, "npm") : undefined,
    source.LOCALAPPDATA ? path.join(source.LOCALAPPDATA, "pnpm") : undefined,
    ...(home
      ? [
          path.join(home, ".local", "bin"),
          path.join(home, ".npm-global", "bin"),
          path.join(home, ".local", "share", "pnpm"),
          path.join(home, ".bun", "bin"),
          path.join(home, ".volta", "bin"),
          path.join(home, ".cargo", "bin"),
          path.join(home, "Library", "pnpm"),
        ]
      : []),
  ].flatMap((entry) => (entry?.trim() ? [entry.trim()] : []));
}

function executableSearchPath(source: NodeJS.ProcessEnv): string | undefined {
  const existingKey = Object.keys(source).find((key) => key.toLowerCase() === "path");
  const existing = existingKey ? source[existingKey] : undefined;
  const entries = [
    ...userExecutableDirectories(source),
    ...(existing ?? "").split(path.delimiter),
  ].filter(Boolean);
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const key = process.platform === "win32" ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? unique.join(path.delimiter) : undefined;
}

export function subscriptionEnvironment(
  connection: ProviderConnection,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  const searchPath = executableSearchPath(source);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  if (searchPath) env[pathKey] = searchPath;
  for (const key of PAID_OR_ALTERNATE_AUTH_VARIABLES) delete env[key];

  if (connection.providerId === "claude-code") {
    delete env.CODEX_HOME;
    if (connection.stateDirectory) env.CLAUDE_CONFIG_DIR = connection.stateDirectory;
    else delete env.CLAUDE_CONFIG_DIR;
  } else {
    delete env.CLAUDE_CONFIG_DIR;
    if (connection.stateDirectory) env.CODEX_HOME = connection.stateDirectory;
    else delete env.CODEX_HOME;
  }
  env.MAESTRO_BILLING_MODE = "subscription-only";
  return env;
}

export function hasForbiddenBillingEnvironment(env: NodeJS.ProcessEnv): boolean {
  return PAID_OR_ALTERNATE_AUTH_VARIABLES.some((key) => Boolean(env[key]));
}
