import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunSpec } from "@maestro/contracts";
import { TurnCoordinator } from "@maestro/core";
import { MaestroRepository } from "@maestro/database";
import { WebResearchService } from "../src/main/services/web-research.js";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-web-research-"));
  const repository = new MaestroRepository(path.join(directory, "maestro.db"));
  const project = await repository.createProject({
    name: "Pesquisa",
    path: directory,
    canonicalPath: directory,
    displayName: "Pesquisa",
  });
  const conversation = await repository.createConversation({
    projectId: project.id,
    title: "Web",
    mode: "maestro",
    sessionKind: "structured",
    workspaceRootId: project.roots[0]!.id,
  });
  const message = await repository.addMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Pesquise a documentação atual",
  });
  const spec: RunSpec = {
    id: "run-web",
    mode: "maestro",
    projectId: project.id,
    conversationId: conversation.id,
    workspaceRootIds: [project.roots[0]!.id],
    prompt: message.content,
    contextAssetIds: [],
    requestedModel: null,
    roleModels: {},
    permissions: {
      readWorkspace: true,
      writeWorkspace: false,
      runCommands: false,
      network: false,
      allowedCommands: [],
      deniedCommands: [],
    },
    budget: { maxTokens: null, maxCostUsd: null, maxDurationMinutes: 10, maxTurns: 4 },
    concurrency: 1,
    createdAt: new Date().toISOString(),
  };
  const run = await repository.createRun(spec, "researching");
  const turn = await new TurnCoordinator(repository).start({
    conversationId: conversation.id,
    runId: run.id,
    sequence: 1,
    prompt: message.content,
    readableRoots: [directory],
    hasWorkspace: true,
    inputMessageId: message.id,
  });
  const connector = await repository.configureConnector({
    projectId: project.id,
    name: "Brave",
    kind: "brave_search",
    enabled: true,
    config: { count: 3, country: "BR" },
  });
  await repository.grantConnector({ connectorId: connector.id, capability: "read" });
  const networkGrant = await repository.grantConnector({
    connectorId: connector.id,
    capability: "network",
  });
  return { repository, project, run, turn, connector, networkGrant };
}

describe("WebResearchService", () => {
  it("requires grants, keeps the token out of SQLite and normalizes Brave sources", async () => {
    const value = await fixture();
    const request = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe("vault-token");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "<strong>Documentação</strong> oficial",
                  url: "https://example.com/docs",
                  description: "Uma fonte &amp; seu trecho.",
                  language: "pt",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    const service = new WebResearchService({
      repository: value.repository,
      credentials: { get: () => Promise.resolve("vault-token") },
      fetch: request,
    });

    const result = await service.search({
      projectId: value.project.id,
      runId: value.run.id,
      turnId: value.turn.id,
      query: "documentação atual",
    });
    expect(result).toMatchObject({ status: "completed", warning: null });
    expect(result?.sources[0]).toMatchObject({
      title: "Documentação oficial",
      excerpt: "Uma fonte & seu trecho.",
      provider: "brave_search",
    });
    expect(await value.repository.listConnectorInvocations(value.connector.id)).toEqual([
      expect.objectContaining({ status: "completed", operation: "search.web" }),
    ]);
    expect(
      JSON.stringify((await value.repository.listConnectors(value.project.id))[0]?.config),
    ).not.toContain("vault-token");

    await value.repository.revokeConnector(value.connector.id, value.networkGrant.id);
    request.mockClear();
    const denied = await service.search({
      projectId: value.project.id,
      runId: value.run.id,
      turnId: value.turn.id,
      query: "não deve sair para a rede",
    });
    expect(denied).toMatchObject({ status: "denied", sources: [] });
    expect(request).not.toHaveBeenCalled();
    value.repository.close();
  });
});
