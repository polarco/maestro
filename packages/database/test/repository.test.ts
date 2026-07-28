import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { PlanSpec, RunSpec } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { MaestroRepository } from "../src/repository.js";
import { INITIAL_MIGRATION } from "../src/migration.js";

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
    ).toEqual([{ version: 1 }, { version: 2 }]);
    db.close();
  });

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
});
