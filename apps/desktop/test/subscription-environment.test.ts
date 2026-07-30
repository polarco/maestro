import type { ProviderConnection } from "@maestro/contracts";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasForbiddenBillingEnvironment,
  subscriptionEnvironment,
} from "../src/main/providers/subscription-environment.js";

function connection(
  providerId: "codex" | "claude-code",
  stateDirectory: string,
): ProviderConnection {
  return {
    id: `${providerId}-account`,
    providerId,
    name: "Conta",
    billingMode: "subscription",
    enabled: true,
    isDefault: false,
    stateDirectory,
    priority: 10,
    concurrencyLimit: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

describe("subscription-only process environment", () => {
  it("prioritizes user-installed CLIs over binaries from the desktop session PATH", () => {
    const env = subscriptionEnvironment(connection("codex", "/accounts/codex-2"), {
      HOME: "/home/maestro",
      PATH: ["/usr/bin", "/home/maestro/.npm-global/bin", "/bin"].join(path.delimiter),
      PNPM_HOME: "/home/maestro/custom-pnpm",
    });

    expect(env.PATH?.split(path.delimiter)).toEqual([
      "/home/maestro/custom-pnpm",
      "/home/maestro/.local/bin",
      "/home/maestro/.npm-global/bin",
      "/home/maestro/.local/share/pnpm",
      "/home/maestro/.bun/bin",
      "/home/maestro/.volta/bin",
      "/home/maestro/.cargo/bin",
      "/home/maestro/Library/pnpm",
      "/usr/bin",
      "/bin",
    ]);
  });

  it("isolates Claude accounts and removes every paid API/gateway credential", () => {
    const env = subscriptionEnvironment(connection("claude-code", "/accounts/claude-2"), {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "paid",
      ANTHROPIC_BASE_URL: "https://gateway.invalid",
      AWS_ACCESS_KEY_ID: "cloud",
      CODEX_HOME: "/wrong",
    });
    expect(env.CLAUDE_CONFIG_DIR).toBe("/accounts/claude-2");
    expect(env.CODEX_HOME).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(hasForbiddenBillingEnvironment(env)).toBe(false);
  });

  it("isolates Codex accounts and refuses API key inheritance", () => {
    const env = subscriptionEnvironment(connection("codex", "/accounts/codex-2"), {
      OPENAI_API_KEY: "paid",
      OPENAI_BASE_URL: "https://proxy.invalid",
      CODEX_ACCESS_TOKEN: "token",
      CLAUDE_CONFIG_DIR: "/wrong",
    });
    expect(env.CODEX_HOME).toBe("/accounts/codex-2");
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(hasForbiddenBillingEnvironment(env)).toBe(false);
  });
});
