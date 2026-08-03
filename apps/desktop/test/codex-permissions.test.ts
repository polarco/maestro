import { describe, expect, it } from "vitest";
import type { PermissionSpec, ProviderSessionSpec } from "@maestro/contracts";
import { codexThreadConfig } from "../src/main/providers/codex.js";

function sessionSpec(permissionOverrides: Partial<PermissionSpec> = {}): ProviderSessionSpec {
  const permissions: PermissionSpec = {
    readWorkspace: true,
    writeWorkspace: false,
    runCommands: false,
    network: false,
    allowedCommands: [],
    deniedCommands: [],
    ...permissionOverrides,
  };
  return {
    runId: "run-codex-permissions",
    mode: "maestro",
    cwd: "/workspace/project",
    workspaceRoots: ["/workspace/project", "/workspace/shared"],
    model: "default",
    effort: "medium",
    permissions,
    budget: {
      maxTokens: null,
      maxCostUsd: null,
      maxDurationMinutes: 60,
      maxTurns: 24,
    },
    tools: permissions.runCommands ? ["workspace.read", "command.run"] : ["workspace.read"],
  };
}

describe("Codex permission profile", () => {
  it("restricts read-only sessions to the selected workspace roots", () => {
    const config = codexThreadConfig(sessionSpec());

    expect(config).toMatchObject({
      default_permissions: "maestro-session",
      permissions: {
        "maestro-session": {
          workspace_roots: {
            "/workspace/project": true,
            "/workspace/shared": true,
          },
          filesystem: {
            ":minimal": "read",
            ":workspace_roots": { ".": "read" },
          },
          network: { enabled: false },
        },
      },
      features: {
        shell_tool: false,
        unified_exec: false,
      },
    });
    expect(JSON.stringify(config)).not.toMatch(/readOnlyAccess|readableRoots|"access"/);
  });

  it("grants workspace and temporary writes only for approved write sessions", () => {
    const config = codexThreadConfig(
      sessionSpec({ writeWorkspace: true, runCommands: true, network: true }),
    );

    expect(config).toMatchObject({
      permissions: {
        "maestro-session": {
          filesystem: {
            ":minimal": "read",
            ":workspace_roots": { ".": "write" },
            ":tmpdir": "write",
            ":slash_tmp": "write",
          },
          network: { enabled: true },
        },
      },
      features: {
        shell_tool: true,
        unified_exec: true,
      },
    });
  });

  it("does not expose workspace roots when workspace reads are disabled", () => {
    const config = codexThreadConfig(sessionSpec({ readWorkspace: false }));
    const profile = (config.permissions as Record<string, Record<string, unknown>>)[
      "maestro-session"
    ];

    expect(profile?.filesystem).toEqual({ ":minimal": "read" });
  });
});
