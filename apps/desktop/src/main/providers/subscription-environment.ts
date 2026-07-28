import process from "node:process";
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

export function subscriptionEnvironment(
  connection: ProviderConnection,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
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
