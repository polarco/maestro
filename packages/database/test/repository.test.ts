import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { ExecutionPolicy, PlanSpec, RunSpec, ToolCall, ToolResult } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { createContextCheckpoint, executionPolicyHash, TurnCoordinator } from "@maestro/core";
import { MaestroRepository } from "../src/repository.js";
import {
  AGENT_RUNTIME_MIGRATION,
  INITIAL_MIGRATION,
  MAESTRO_NEXT_MIGRATION,
  MULTI_ACCOUNT_MIGRATION,
  MULTIMODAL_CONTEXT_MIGRATION,
} from "../src/migration.js";

async function repository(): Promise<MaestroRepository> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-db-"));
  return new MaestroRepository(path.join(directory, "maestro.db"));
}

describe("MaestroRepository", () => {
  it("migrates an existing v1 database to isolated subscription accounts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-db-v1-"));
    const filename = path.join(directory, "maestro.db");
    const legacy = new BetterSqlite3(filename);
    legacy.exec(INITIAL_MIGRATION);
    legacy
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)")
      .run(new Date().toISOString());
    legacy.close();

    const db = new MaestroRepository(filename);
    const columns = db.sqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{
      name: string;
    }>;
    expect(columns.some((column) => column.name === "provider_connection_id")).toBe(true);
    expect(
      db.sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect(db.migrationBackupPath).not.toBeNull();
    await expect(access(db.migrationBackupPath!)).resolves.toBeUndefined();
    db.close();
  }, 30_000);

  it("migrates a v2 database to multimodal context tables and FTS", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-db-v2-"));
    const filename = path.join(directory, "maestro.db");
    const legacy = new BetterSqlite3(filename);
    legacy.exec(INITIAL_MIGRATION);
    legacy.exec(MULTI_ACCOUNT_MIGRATION);
    const appliedAt = new Date().toISOString();
    legacy
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(1, appliedAt);
    legacy
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(2, appliedAt);
    legacy.close();

    const db = new MaestroRepository(filename);
    expect(
      db.sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('context_assets', 'context_chunks_fts') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "context_assets" }, { name: "context_chunks_fts" }]);
    db.close();
  }, 30_000);

  it("migrates a populated v3 database and preserves its conversation graph", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-db-v3-"));
    const filename = path.join(directory, "maestro.db");
    const legacy = new BetterSqlite3(filename);
    legacy.exec(INITIAL_MIGRATION);
    legacy.exec(MULTI_ACCOUNT_MIGRATION);
    legacy.exec(MULTIMODAL_CONTEXT_MIGRATION);
    const timestamp = new Date().toISOString();
    for (const version of [1, 2, 3])
      legacy
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, timestamp);
    legacy
      .prepare(
        "INSERT INTO projects(id, name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("project-v3", "V3", timestamp, timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO workspace_roots(
           id, project_id, path, canonical_path, display_name, writable, created_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run("root-v3", "project-v3", directory, directory, "v3", timestamp);
    legacy
      .prepare(
        `INSERT INTO conversations(
           id, project_id, title, mode, session_kind, workspace_root_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'chat', 'structured', ?, ?, ?)`,
      )
      .run("conversation-v3", "project-v3", "Histórico v3", "root-v3", timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO messages(
           id, conversation_id, role, content, status, attachments, created_at, updated_at
         ) VALUES (?, ?, 'user', ?, 'completed', '[]', ?, ?)`,
      )
      .run("message-v3", "conversation-v3", "mensagem v3", timestamp, timestamp);
    legacy.close();

    const db = new MaestroRepository(filename);
    expect(
      db.sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect((await db.listMessages("conversation-v3"))[0]).toMatchObject({
      content: "mensagem v3",
      branchId: "root-conversation-v3",
    });
    expect((await db.listSessionBranches("conversation-v3"))[0]).toMatchObject({
      id: "root-conversation-v3",
      isRoot: true,
    });
    expect(db.sqlite.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    db.close();
  }, 30_000);

  it("rolls back an interrupted v5 migration and replays it without losing v4 data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-db-v4-"));
    const filename = path.join(directory, "maestro.db");
    const legacy = new BetterSqlite3(filename);
    legacy.exec(INITIAL_MIGRATION);
    legacy.exec(MULTI_ACCOUNT_MIGRATION);
    legacy.exec(MULTIMODAL_CONTEXT_MIGRATION);
    legacy.exec(AGENT_RUNTIME_MIGRATION);
    const timestamp = new Date().toISOString();
    for (const version of [1, 2, 3, 4])
      legacy
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, timestamp);
    legacy
      .prepare(
        "INSERT INTO projects(id, name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("project-v4", "Legado", timestamp, timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO workspace_roots(
           id, project_id, path, canonical_path, display_name, writable, created_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run("root-v4", "project-v4", directory, directory, "legado", timestamp);
    legacy
      .prepare(
        `INSERT INTO conversations(
           id, project_id, title, mode, session_kind, workspace_root_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'maestro', 'structured', ?, ?, ?)`,
      )
      .run("conversation-v4", "project-v4", "Sessão preservada", "root-v4", timestamp, timestamp);
    legacy
      .prepare(
        `INSERT INTO messages(
           id, conversation_id, role, content, status, attachments, created_at, updated_at
         ) VALUES (?, ?, 'user', ?, 'completed', '[]', ?, ?)`,
      )
      .run("message-v4", "conversation-v4", "conteúdo íntegro", timestamp, timestamp);

    expect(() =>
      legacy.transaction(() => {
        legacy.exec(MAESTRO_NEXT_MIGRATION);
        throw new Error("interrupção simulada");
      })(),
    ).toThrow("interrupção simulada");
    expect(
      (legacy.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>).some(
        (column) => column.name === "active_branch_id",
      ),
    ).toBe(false);
    legacy.close();

    let db = new MaestroRepository(filename);
    expect((await db.listMessages("conversation-v4"))[0]?.content).toBe("conteúdo íntegro");
    expect((await db.listSessionBranches("conversation-v4"))[0]).toMatchObject({
      name: "Principal",
      isRoot: true,
    });
    expect(db.sqlite.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    db.close();

    db = new MaestroRepository(filename);
    expect(db.migrationBackupPath).toBeNull();
    expect(
      db.sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
    ).toHaveLength(5);
    db.close();
  }, 30_000);

  it("persists branch isolation, Studio versions, memory, grants, jobs and global search", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Next",
      path: "/workspace/next",
      canonicalPath: "/workspace/next",
      displayName: "next",
    });
    const root = project.roots[0]!;
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Maestro Next",
      mode: "maestro",
      sessionKind: "structured",
      workspaceRootId: root.id,
    });
    const user = await db.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Neste projeto, prefiro sempre usar testes de integração.",
    });
    const assistant = await db.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Entendido.",
    });
    const runSpec: RunSpec = {
      id: "run-next",
      mode: "maestro",
      projectId: project.id,
      conversationId: conversation.id,
      workspaceRootIds: [root.id],
      prompt: user.content,
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
    const run = await db.createRun(runSpec, "researching");
    const turn = await new TurnCoordinator(db).start({
      conversationId: conversation.id,
      runId: run.id,
      sequence: 1,
      prompt: user.content,
      readableRoots: [root.canonicalPath],
      hasWorkspace: true,
      inputMessageId: user.id,
    });
    await db.updateTurn(turn.id, { outputMessageId: assistant.id });
    await db.appendEvent({
      runId: run.id,
      type: "research.started",
      data: { topics: ["integração"], scope: "workspace-and-context" },
    });

    const branch = await db.forkAtTurn({ sessionId: conversation.id, turnId: turn.id });
    await db.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Alternativa B",
    });
    expect((await db.listMessages(conversation.id)).map((message) => message.content)).toContain(
      "Alternativa B",
    );
    const rootBranch = (await db.listSessionBranches(conversation.id)).find((item) => item.isRoot)!;
    await db.switchSessionBranch(conversation.id, rootBranch.id);
    expect(
      (await db.listMessages(conversation.id)).map((message) => message.content),
    ).not.toContain("Alternativa B");
    await db.switchSessionBranch(conversation.id, branch.id);

    const created = await db.createArtifact({
      projectId: project.id,
      sessionId: conversation.id,
      branchId: branch.id,
      turnId: turn.id,
      title: "Contrato da API",
      kind: "markdown",
      language: "markdown",
      content: "# Contrato\n\nresultado vivo",
      pinned: true,
      createdBy: "assistant",
    });
    expect(created.artifact.pinned).toBe(true);
    const updated = await db.updateArtifact({
      artifactId: created.artifact.id,
      content: "# Contrato v2\n\nresultado vivo e revisado",
      pinned: true,
      language: null,
    });
    expect(updated.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(updated.artifact.pinned).toBe(true);
    expect(updated.artifact.language).toBeNull();

    const suggested = await db.suggestMemoriesFromMessage(user);
    expect(suggested[0]).toMatchObject({ state: "suggested", scope: "project" });
    expect((await db.updateMemory({ memoryId: suggested[0]!.id, state: "accepted" })).state).toBe(
      "accepted",
    );
    const personal = await db.suggestMemoriesFromMessage(user, turn.id, "personal");
    expect(personal[0]).toMatchObject({ scope: "personal", projectId: null });
    expect((await db.listMemories({ scope: "personal" })).map((memory) => memory.id)).toContain(
      personal[0]!.id,
    );
    expect((await db.setProjectAutonomy(project.id, "observe")).level).toBe("observe");

    const connector = await db.configureConnector({
      projectId: project.id,
      name: "GitHub",
      kind: "github",
      enabled: true,
      config: { repository: "owner/repo", credentialRef: "vault:github" },
    });
    expect(
      (await db.grantConnector({ connectorId: connector.id, capability: "read" })).granted,
    ).toBe(true);
    await expect(
      db.configureConnector({
        projectId: project.id,
        name: "Inseguro",
        kind: "github",
        enabled: true,
        config: { token: "não pode persistir" },
      }),
    ).rejects.toThrow("vault");
    await expect(
      db.configureConnector({
        projectId: project.id,
        name: "MCP inseguro",
        kind: "mcp_stdio",
        enabled: true,
        config: { command: "node", env: { GITHUB_TOKEN: "também não pode persistir" } },
      }),
    ).rejects.toThrow("vault");

    expect((await db.listJobs(project.id))[0]).toMatchObject({ runId: run.id });
    expect(
      (await db.globalSearch(project.id, "resultado vivo")).some(
        (item) => item.type === "artifact",
      ),
    ).toBe(true);
    const timeline = await db.getSessionTimeline(conversation.id, 0, 1_000, branch.id);
    expect(timeline.items.some((item) => item.kind === "artifact")).toBe(true);
    expect(timeline.items.some((item) => item.kind === "research")).toBe(true);
    expect(db.sqlite.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    await db.deleteConversation(conversation.id);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE session_id IS NOT NULL")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get("audit_events_no_update"),
    ).toEqual({ name: "audit_events_no_update" });
    expect(db.sqlite.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    db.close();
  });

  it("pages a 10k-item timeline from the newest window without mounting the full history", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Escala",
      path: "/workspace/scale",
      canonicalPath: "/workspace/scale",
      displayName: "scale",
    });
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Timeline longa",
      mode: "maestro",
      sessionKind: "structured",
      workspaceRootId: project.roots[0]!.id,
    });
    const insert = db.sqlite.prepare(
      `INSERT INTO messages(
         id, conversation_id, role, content, status, attachments, branch_id, created_at, updated_at
       ) VALUES (?, ?, 'user', ?, 'completed', '[]', ?, ?, ?)`,
    );
    const startedAt = Date.UTC(2026, 0, 1);
    db.sqlite.transaction(() => {
      for (let index = 0; index < 10_005; index += 1) {
        const timestamp = new Date(startedAt + index).toISOString();
        insert.run(
          `message-scale-${index.toString().padStart(5, "0")}`,
          conversation.id,
          index === 10_004 ? "marcador final exclusivo" : `item ${index}`,
          conversation.activeBranchId,
          timestamp,
          timestamp,
        );
      }
    })();

    const latest = await db.getSessionTimeline(conversation.id, undefined, 500);
    expect(latest).toMatchObject({
      cursor: 10_000,
      total: 10_005,
      previousCursor: 9_500,
      nextCursor: null,
    });
    expect(latest.items).toHaveLength(5);
    expect(latest.items.at(-1)).toMatchObject({
      kind: "message",
      message: { content: "marcador final exclusivo" },
    });
    const previous = await db.getSessionTimeline(conversation.id, latest.previousCursor!, 500);
    expect(previous).toMatchObject({ cursor: 9_500, previousCursor: 9_000, nextCursor: 10_000 });
    expect(previous.items).toHaveLength(500);
    expect(await db.globalSearch(project.id, "marcador final")).toEqual([
      expect.objectContaining({ type: "message", sessionId: conversation.id }),
    ]);
    db.close();
  }, 30_000);

  it("persists any number of isolated subscription connections", async () => {
    const db = await repository();
    const first = await db.createProviderConnection({
      providerId: "claude-code",
      name: "Claude 1",
      stateDirectory: "/profiles/claude-1",
    });
    const second = await db.createProviderConnection({
      providerId: "claude-code",
      name: "Claude 2",
      stateDirectory: "/profiles/claude-2",
      concurrencyLimit: 3,
    });
    const third = await db.createProviderConnection({
      providerId: "codex",
      name: "Codex 1",
      stateDirectory: "/profiles/codex-1",
    });
    expect(await db.listProviderConnections()).toHaveLength(3);
    await db.updateProviderConnection(second.id, { enabled: false, priority: 7 });
    expect(await db.getProviderConnection(second.id)).toMatchObject({
      enabled: false,
      priority: 7,
      concurrencyLimit: 3,
    });
    await db.reorderProviderConnections([second.id, third.id, first.id]);
    expect(
      (await db.listProviderConnections()).map((item) => ({
        id: item.id,
        priority: item.priority,
      })),
    ).toEqual([
      { id: second.id, priority: 0 },
      { id: third.id, priority: 1 },
      { id: first.id, priority: 2 },
    ]);
    await db.deleteProviderConnection(first.id);
    expect((await db.listProviderConnections()).map((item) => item.id)).toEqual([
      second.id,
      third.id,
    ]);
    db.close();
  });

  it("persists projects, conversations and messages across reopen", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-db-"));
    const filename = path.join(directory, "maestro.db");
    let db = new MaestroRepository(filename);
    const project = await db.createProject({
      name: "Demo",
      path: directory,
      canonicalPath: directory,
      displayName: "Demo",
    });
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Nova conversa",
      mode: "chat",
      sessionKind: "structured",
      workspaceRootId: project.roots[0]!.id,
    });
    await db.addMessage({ conversationId: conversation.id, role: "user", content: "Olá" });
    db.close();

    db = new MaestroRepository(filename);
    expect(await db.getActiveProjectId()).toBe(project.id);
    expect((await db.listMessages(conversation.id))[0]?.content).toBe("Olá");
    db.close();
  });

  it("orders context assets, indexes chunks, preserves legacy attachments and cascades", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Contexto",
      path: "/workspace/context",
      canonicalPath: "/workspace/context",
      displayName: "context",
    });
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Multimodal",
      mode: "chat",
      sessionKind: "structured",
      workspaceRootId: project.roots[0]!.id,
    });
    const base = {
      projectId: project.id,
      conversationId: conversation.id,
      workspaceRootId: null,
      source: "upload" as const,
      kind: "text" as const,
      status: "ready" as const,
      changeState: "not_applicable" as const,
      mimeType: "text/plain",
      size: 12,
      relativePath: null,
      sourcePath: null,
      thumbnailPath: null,
      currentHash: "hash",
      sourceModifiedAt: null,
      durationMs: null,
      pageCount: null,
      transcription: null,
      framePaths: [],
      metadata: {},
      warning: null,
      error: null,
    };
    const first = await db.createContextAsset({
      ...base,
      name: "primeiro.txt",
      managedPath: "/private/first.txt",
      contentHash: "hash-1",
      extractedText: "termo raro em um relatório",
    });
    const second = await db.createContextAsset({
      ...base,
      name: "segundo.txt",
      managedPath: "/private/second.txt",
      contentHash: "hash-2",
      extractedText: "outro conteúdo",
    });
    await db.replaceContextChunks(first.id, [
      { content: "introdução genérica", tokenCount: 4 },
      { content: "termo raro em um relatório", tokenCount: 7 },
    ]);
    await db.replaceContextChunks(second.id, [{ content: "outro conteúdo", tokenCount: 3 }]);
    const message = await db.addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "analise",
      attachments: [
        {
          id: "legacy-1",
          name: "legado.txt",
          mimeType: "text/plain",
          size: 1,
          localPath: "/legacy/legado.txt",
        },
      ],
      contextAssetIds: [second.id, first.id],
    });

    expect(message.contextAssets.map((asset) => asset.id)).toEqual([second.id, first.id]);
    expect(message.contextAssets[0]).toMatchObject({
      previewUrl: `maestro-attachment://asset/${conversation.id}/${second.id}`,
      requiresVision: false,
    });
    expect((await db.listMessages(conversation.id))[0]?.attachments[0]?.name).toBe("legado.txt");
    expect((await db.searchContextChunks([first.id, second.id], "termo raro", 2))[0]).toMatchObject(
      {
        assetId: first.id,
        ordinal: 1,
      },
    );
    expect(await db.isContextAssetLinked(first.id)).toBe(true);

    await db.deleteConversation(conversation.id);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM context_assets").get()).toEqual({
      count: 0,
    });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM context_chunks_fts").get()).toEqual({
      count: 0,
    });
    db.close();
  });

  it("reuses one empty draft and only lists conversations after their first message", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Drafts",
      path: "/workspace/drafts",
      canonicalPath: "/workspace/drafts",
      displayName: "drafts",
    });
    const input = {
      projectId: project.id,
      title: "Nova conversa",
      mode: "chat" as const,
      sessionKind: "structured" as const,
      workspaceRootId: project.roots[0]!.id,
    };

    const firstDraft = await db.createConversationDraft(input);
    const reusedDraft = await db.createConversationDraft({
      ...input,
      mode: "agent",
      providerId: "codex",
      modelId: "fixture",
    });
    expect(reusedDraft).toMatchObject({
      id: firstDraft.id,
      mode: "agent",
      providerId: "codex",
      modelId: "fixture",
    });
    expect(await db.listConversations(project.id)).toEqual([]);

    await db.addMessage({
      conversationId: firstDraft.id,
      role: "user",
      content: "Agora deve aparecer",
    });
    expect((await db.listConversations(project.id)).map((conversation) => conversation.id)).toEqual(
      [firstDraft.id],
    );

    const secondDraft = await db.createConversationDraft(input);
    expect(secondDraft.id).not.toBe(firstDraft.id);
    expect((await db.createConversationDraft(input)).id).toBe(secondDraft.id);
    await db.deleteConversation(secondDraft.id);
    await expect(db.getConversation(secondDraft.id)).rejects.toThrow("não encontrada");

    const abandonedDraft = await db.createConversationDraft(input);
    expect(db.pruneConversationDrafts()).toBe(1);
    await expect(db.getConversation(abandonedDraft.id)).rejects.toThrow("não encontrada");
    expect((await db.listConversations(project.id)).map((conversation) => conversation.id)).toEqual(
      [firstDraft.id],
    );
    db.close();
  });

  it("updates and removes projects, roots and conversations as one data graph", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Antes",
      path: "/workspace/one",
      canonicalPath: "/workspace/one",
      displayName: "one",
    });
    const renamed = await db.updateProject(project.id, "Depois");
    expect(renamed.name).toBe("Depois");

    const withSecondRoot = await db.addWorkspaceRoot(project.id, {
      path: "/workspace/two",
      canonicalPath: "/workspace/two",
      displayName: "two",
    });
    expect(withSecondRoot.roots).toHaveLength(2);
    await db.removeWorkspaceRoot(project.id, withSecondRoot.roots[1]!.id);
    await expect(db.removeWorkspaceRoot(project.id, project.roots[0]!.id)).rejects.toThrow(
      "pelo menos uma pasta",
    );

    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Rascunho",
      mode: "chat",
      sessionKind: "structured",
      workspaceRootId: project.roots[0]!.id,
    });
    expect((await db.updateConversation(conversation.id, { title: "Final" })).title).toBe("Final");

    const spec: RunSpec = {
      id: "run-delete-graph",
      mode: "chat",
      projectId: project.id,
      conversationId: conversation.id,
      workspaceRootIds: [project.roots[0]!.id],
      prompt: "teste",
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
      budget: { maxTokens: null, maxCostUsd: null, maxDurationMinutes: 10, maxTurns: 2 },
      concurrency: 1,
      createdAt: new Date().toISOString(),
    };
    await db.createRun(spec, "completed");
    await db.appendEvent({
      runId: spec.id,
      type: "run.created",
      data: { mode: "chat", promptPreview: "teste" },
    });

    await db.deleteConversation(conversation.id);
    await expect(db.getConversation(conversation.id)).rejects.toThrow("não encontrada");
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM runs WHERE id = ?").get(spec.id),
    ).toEqual({
      count: 0,
    });
    expect(
      db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get("run_events_no_delete"),
    ).toEqual({ name: "run_events_no_delete" });

    await db.deleteProject(project.id);
    expect(await db.listProjects()).toEqual([]);
    expect(await db.getActiveProjectId()).toBeNull();
    db.close();
  });

  it("keeps run_events append-only with monotonic sequences", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Demo",
      path: "/tmp",
      canonicalPath: "/tmp",
      displayName: "tmp",
    });
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Run",
      mode: "maestro",
      sessionKind: "structured",
      workspaceRootId: project.roots[0]!.id,
    });
    const spec: RunSpec = {
      id: "run-1",
      mode: "maestro",
      projectId: project.id,
      conversationId: conversation.id,
      workspaceRootIds: [project.roots[0]!.id],
      prompt: "Faça algo",
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
      budget: { maxTokens: null, maxCostUsd: null, maxDurationMinutes: 60, maxTurns: 10 },
      concurrency: 2,
      createdAt: new Date().toISOString(),
    };
    await db.createRun(spec, "analyzing");
    const first = await db.appendEvent({
      runId: spec.id,
      type: "run.created",
      data: { mode: "maestro", promptPreview: "Faça algo" },
    });
    const second = await db.appendEvent({
      runId: spec.id,
      type: "log",
      data: { level: "info", message: "ok" },
    });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(() => db.sqlite.prepare("UPDATE run_events SET type='x'").run()).toThrow("append-only");
    db.close();
  });

  it("versions and approves plans before queueing", async () => {
    const db = await repository();
    const project = await db.createProject({
      name: "Demo",
      path: "/tmp",
      canonicalPath: "/tmp",
      displayName: "tmp",
    });
    const root = project.roots[0]!;
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Run",
      mode: "maestro",
      sessionKind: "structured",
      workspaceRootId: root.id,
    });
    const spec: RunSpec = {
      id: "run-plan",
      mode: "maestro",
      projectId: project.id,
      conversationId: conversation.id,
      workspaceRootIds: [root.id],
      prompt: "implemente",
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
      budget: { maxTokens: null, maxCostUsd: null, maxDurationMinutes: 60, maxTurns: 10 },
      concurrency: 2,
      createdAt: new Date().toISOString(),
    };
    await db.createRun(spec, "analyzing");
    await db.transitionRun(spec.id, "planning");
    const plan: PlanSpec = {
      id: "plan-1",
      runId: spec.id,
      version: 1,
      summary: "Plano",
      assumptions: [],
      risks: [],
      successCriteria: ["funciona"],
      tasks: [
        {
          id: "task-1",
          title: "Implementar",
          description: "Implementar",
          role: "implementer",
          dependencies: [],
          workspaceRootId: root.id,
          workspaceStrategy: "worktree",
          model: { providerId: "codex", modelId: "default", effort: "medium" },
          tools: [],
          validationCommands: [],
          successCriteria: ["feito"],
        },
      ],
      createdAt: new Date().toISOString(),
    };
    await db.addPlan(plan, "# Plano");
    await db.transitionRun(spec.id, "awaiting_approval");
    await db.approvePlan(spec.id, 1);
    await db.transitionRun(spec.id, "queued");
    expect((await db.getRun(spec.id)).state).toBe("queued");
    expect((await db.getPlan(spec.id, 1)).status).toBe("approved");
    db.close();
  });

  it("persists turns, tools, approvals, checkpoints, routes and pending switches across restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-runtime-db-"));
    const filename = path.join(directory, "maestro.db");
    let db = new MaestroRepository(filename);
    const project = await db.createProject({
      name: "Runtime",
      path: directory,
      canonicalPath: directory,
      displayName: "runtime",
    });
    const root = project.roots[0]!;
    const conversation = await db.createConversation({
      projectId: project.id,
      title: "Runtime",
      mode: "maestro",
      sessionKind: "structured",
      workspaceRootId: root.id,
    });
    const runSpec: RunSpec = {
      id: "run-runtime",
      mode: "maestro",
      projectId: project.id,
      conversationId: conversation.id,
      workspaceRootIds: [root.id],
      prompt: "Pesquise o workspace",
      contextAssetIds: [],
      requestedModel: { providerId: "fixture", modelId: "model" },
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
    await db.createRun(runSpec, "researching");
    const turn = await new TurnCoordinator(db).start({
      conversationId: conversation.id,
      runId: runSpec.id,
      sequence: 1,
      prompt: runSpec.prompt,
      readableRoots: [root.canonicalPath],
      hasWorkspace: true,
      intent: {
        path: "research",
        category: "workspace_question",
        confidence: 1,
        rationale: "fixture",
        requiresWorkspace: true,
        requiresApproval: false,
        materialDecisions: [],
        requestedCapabilities: ["workspace-read"],
      },
    });
    const checkpoint = createContextCheckpoint({
      conversationId: conversation.id,
      runId: runSpec.id,
      turnId: turn.id,
      update: { objective: runSpec.prompt, progress: ["leitura concluída"] },
    });
    await db.saveCheckpoint(checkpoint);
    const call: ToolCall = {
      id: "tool-call-runtime",
      turnId: turn.id,
      runId: runSpec.id,
      toolName: "fs.read",
      input: { path: "README.md" },
      status: "completed",
      mutability: "read",
      idempotencyKey: "stable-runtime-key",
      checkpointId: checkpoint.id,
      createdAt: checkpoint.createdAt,
      startedAt: checkpoint.createdAt,
      finishedAt: checkpoint.createdAt,
    };
    const result: ToolResult = {
      id: "tool-result-runtime",
      toolCallId: call.id,
      output: { content: "ok" },
      isError: false,
      error: null,
      artifactRef: null,
      truncated: false,
      contentHash: "hash",
      createdAt: checkpoint.createdAt,
    };
    await db.createToolCall(call);
    await db.saveToolResult(result);
    const approvalBase: Omit<ExecutionPolicy, "scopeHash"> = {
      readableRoots: [root.canonicalPath],
      writableRoots: [root.canonicalPath],
      allowedTools: ["fs.write"],
      allowedExecutables: [],
      network: "denied",
      externalMutations: false,
      writeApproved: true,
      approvalId: "approval-runtime",
      approvedPlanVersion: 1,
    };
    const approvalPolicy = {
      ...approvalBase,
      scopeHash: executionPolicyHash(approvalBase),
    };
    await db.createApproval({
      id: "approval-runtime",
      runId: runSpec.id,
      turnId: turn.id,
      planVersion: 1,
      scope: approvalPolicy,
    });
    await db.resolveApproval("approval-runtime", "approved");
    const capability = {
      chat: true,
      coding: true,
      tools: true,
      vision: false,
      reasoningEffort: ["medium" as const],
      structuredOutput: true,
      contextWindow: 128_000,
    };
    await db.saveRoutingDecision(
      {
        id: "route-runtime",
        turnId: turn.id,
        role: "research",
        profile: "economical",
        selected: {
          selection: { providerId: "fixture", modelId: "model" },
          capability,
          eligible: true,
          excludedReasons: [],
          quality: 0.8,
          marginalCostUsd: 0,
          sessionAffinity: 0,
          reliability: 1,
          headroom: 1,
          latencyMs: 10,
          cacheAffinity: 0,
          circuitState: "closed",
        },
        candidates: [],
        pinned: false,
        fallbackAllowed: true,
        rationale: "fixture",
        createdAt: checkpoint.createdAt,
      },
      runSpec.id,
    );
    await db.setPendingModelSwitch({
      runId: runSpec.id,
      selection: { providerId: "fixture-2", modelId: "model-2" },
      timing: "next_checkpoint",
      noFallback: false,
      requestedAt: checkpoint.createdAt,
    });
    db.close();

    db = new MaestroRepository(filename);
    expect((await db.getLatestTurn({ runId: runSpec.id }))?.id).toBe(turn.id);
    expect((await db.getLatestCheckpoint({ runId: runSpec.id }))?.id).toBe(checkpoint.id);
    expect((await db.findToolCallByIdempotencyKey("stable-runtime-key"))?.result?.id).toBe(
      result.id,
    );
    expect((await db.getApprovedExecutionPolicy(runSpec.id, 1))?.scope.scopeHash).toBe(
      approvalPolicy.scopeHash,
    );
    expect((await db.getLatestRoutingDecision(runSpec.id))?.id).toBe("route-runtime");
    expect((await db.getPendingModelSwitch(runSpec.id))?.selection.providerId).toBe("fixture-2");
    db.close();
  });
});
