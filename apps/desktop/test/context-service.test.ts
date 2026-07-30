import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContextAssetSummary, ContextProcessingEvent } from "@maestro/contracts";
import { MaestroRepository } from "@maestro/database";
import sharp from "sharp";
import { ContextService } from "../src/main/services/context-service.js";

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("A condição assíncrona não foi atendida.");
}

describe("ContextService", () => {
  let directory: string;
  let workspace: string;
  let repository: MaestroRepository;
  let service: ContextService;
  let conversationId: string;
  let rootId: string;
  let events: ContextProcessingEvent[];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "maestro-context-service-"));
    workspace = path.join(directory, "workspace");
    await mkdir(workspace, { recursive: true });
    const workerScript = path.join(directory, "fixture-worker.mjs");
    await writeFile(
      workerScript,
      `import { readFile } from "node:fs/promises";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
if (workerData.type === "warm-model") parentPort.postMessage({ type: "model-ready" });
else {
  const text = workerData.assetKind === "folder"
    ? (await Promise.all((workerData.folderEntries ?? []).map(async (relative) =>
        \`--- \${relative} ---\\n\${await readFile(path.join(workerData.inputPath, relative), "utf8")}\`
      ))).join("\\n\\n")
    : await readFile(workerData.inputPath, "utf8");
  parentPort.postMessage({ type: "progress", stage: "indexing", progress: 0.9, message: "Indexando…" });
  parentPort.postMessage({ type: "result", result: {
    extractedText: text, chunks: [{ content: text, tokenCount: Math.ceil(text.length / 4) }],
    transcription: null, durationMs: null, pageCount: null, framePaths: [], metadata: {}, warning: null
  }});
}`,
      "utf8",
    );
    repository = new MaestroRepository(path.join(directory, "maestro.db"));
    const project = await repository.createProject({
      name: "Contexto",
      path: workspace,
      canonicalPath: workspace,
      displayName: "workspace",
    });
    rootId = project.roots[0]!.id;
    conversationId = (
      await repository.createConversation({
        projectId: project.id,
        title: "Contexto",
        mode: "chat",
        sessionKind: "structured",
        workspaceRootId: rootId,
      })
    ).id;
    events = [];
    service = new ContextService({
      repository,
      userDataDirectory: path.join(directory, "user-data"),
      workerScript,
      emitContext: (event) => events.push(event),
      emitModel: () => {},
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.dispose();
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("copies uploads privately, deduplicates, indexes and preserves linked message assets", async () => {
    const source = path.join(directory, "outside-upload.txt");
    await writeFile(source, "arquitetura multimodal local", "utf8");
    const [staged] = await service.stageFiles(conversationId, [source]);
    expect(staged).toBeDefined();
    const ready = await eventually(
      () => repository.getContextAsset(staged!.id),
      (asset) => asset.status === "ready",
    );
    expect(ready.managedPath).not.toBe(source);
    expect(await stat(ready.managedPath!)).toBeTruthy();
    expect((await service.stageFiles(conversationId, [source]))[0]?.id).toBe(staged!.id);
    expect(
      (await service.compile([ready], "arquitetura", { vision: false, contextWindow: 16_000 }))
        .parts,
    ).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("arquitetura multimodal local"),
      }),
    ]);

    await repository.addMessage({
      conversationId,
      role: "user",
      content: "analise",
      contextAssetIds: [ready.id],
    });
    await service.remove(conversationId, ready.id);
    expect(await repository.getContextAsset(ready.id)).toMatchObject({ status: "ready" });
    expect(await stat(ready.managedPath!)).toBeTruthy();
    expect(events.some((event) => event.stage === "ready")).toBe(true);
  });

  it("detects changed and missing live references and rejects a symlink escape", async () => {
    const referenced = path.join(workspace, "live.md");
    await writeFile(referenced, "versão inicial", "utf8");
    const [asset] = await service.prepareWorkspace(conversationId, [
      { workspaceRootId: rootId, relativePath: "live.md", kind: "file" },
    ]);
    await eventually(
      () => repository.getContextAsset(asset!.id),
      (record) => record.status === "ready",
    );
    await writeFile(referenced, "versão modificada e maior", "utf8");
    await service.refreshWorkspaceReferences(conversationId);
    expect(
      (await service.list(conversationId)).find((item) => item.id === asset!.id),
    ).toMatchObject({
      changeState: "changed",
    } satisfies Partial<ContextAssetSummary>);

    let changed = await repository.getContextAsset(asset!.id);
    expect(
      (await service.compile([changed], "versão", { vision: false, contextWindow: 16_000 })).parts,
    ).toEqual([expect.objectContaining({ text: expect.stringContaining("versão modificada") })]);
    await writeFile(referenced, "versão inicial", "utf8");
    changed = await repository.getContextAsset(asset!.id);
    expect(
      (await service.compile([changed], "versão", { vision: false, contextWindow: 16_000 })).parts,
    ).toEqual([expect.objectContaining({ text: expect.stringContaining("versão inicial") })]);
    expect(await repository.getContextAsset(asset!.id)).toMatchObject({ changeState: "current" });

    await rm(referenced);
    await service.refreshWorkspaceReferences(conversationId);
    expect(
      (await service.list(conversationId)).find((item) => item.id === asset!.id),
    ).toMatchObject({
      status: "missing",
      changeState: "missing",
    });

    const outside = path.join(directory, "outside.md");
    await writeFile(outside, "fora", "utf8");
    const linked = await symlink(outside, path.join(workspace, "escape.md"))
      .then(() => true)
      .catch(() => false);
    if (linked) {
      await expect(
        service.prepareWorkspace(conversationId, [
          { workspaceRootId: rootId, relativePath: "escape.md", kind: "file" },
        ]),
      ).rejects.toThrow("fora das raízes autorizadas");
    }
    await expect(
      service.prepareWorkspace(conversationId, [
        { workspaceRootId: rootId, relativePath: "../outside.md", kind: "file" },
      ]),
    ).rejects.toThrow("fora das raízes autorizadas");
  });

  it("processes only the authorized manifest of a mentioned folder", async () => {
    const folder = path.join(workspace, "notes");
    await Promise.all([
      mkdir(path.join(folder, "node_modules", "package"), { recursive: true }),
      mkdir(path.join(folder, "private"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(folder, ".gitignore"), "private/\n!node_modules/\n", "utf8"),
      writeFile(path.join(folder, "public.md"), "conteúdo permitido", "utf8"),
      writeFile(path.join(folder, "private", "secret.md"), "segredo ignorado", "utf8"),
      writeFile(
        path.join(folder, "node_modules", "package", "index.js"),
        "segredo de dependência",
        "utf8",
      ),
    ]);
    const [asset] = await service.prepareWorkspace(conversationId, [
      { workspaceRootId: rootId, relativePath: "notes", kind: "directory" },
    ]);
    const ready = await eventually(
      () => repository.getContextAsset(asset!.id),
      (record) => record.status === "ready",
    );
    const compiled = await service.compile([ready], "resuma", {
      vision: false,
      contextWindow: 16_000,
    });
    const textPart = compiled.parts.find((part) => part.type === "text");
    expect(textPart?.text).toContain("conteúdo permitido");
    expect(textPart?.text).not.toContain("segredo ignorado");
    expect(textPart?.text).not.toContain("segredo de dependência");
  });

  it("rejects a folder with more than 500 eligible files", async () => {
    const folder = path.join(directory, "oversized-folder");
    await mkdir(folder, { recursive: true });
    await Promise.all(
      Array.from({ length: 501 }, (_, index) =>
        writeFile(path.join(folder, `${String(index).padStart(3, "0")}.txt`), "x", "utf8"),
      ),
    );
    await expect(service.stageFolder(conversationId, folder)).rejects.toThrow(
      "500 arquivos elegíveis",
    );
  });

  it("validates a file batch before copying and keeps recorded WebM as audio", async () => {
    const valid = path.join(directory, "valid.txt");
    const unsupported = path.join(directory, "unsupported.bin");
    await writeFile(valid, "válido", "utf8");
    await writeFile(unsupported, "binário", "utf8");

    await expect(service.stageFiles(conversationId, [valid, unsupported])).rejects.toThrow(
      "Formato não suportado",
    );
    expect(await service.list(conversationId)).toEqual([]);

    const recording = await service.stageBuffer({
      conversationId,
      data: new Uint8Array([1, 2, 3]),
      name: "gravacao.webm",
      mimeType: "audio/webm;codecs=opus",
      source: "recording",
      durationMs: 250,
    });
    expect(recording).toMatchObject({
      kind: "audio",
      status: "needs_model",
      durationMs: 250,
    });
  });

  it("does not deduplicate a private upload against a live workspace reference", async () => {
    const referenced = path.join(workspace, "live-copy.md");
    const uploaded = path.join(directory, "uploaded-copy.md");
    await writeFile(referenced, "mesmo conteúdo", "utf8");
    await writeFile(uploaded, "mesmo conteúdo", "utf8");
    const [workspaceAsset] = await service.prepareWorkspace(conversationId, [
      { workspaceRootId: rootId, relativePath: "live-copy.md", kind: "file" },
    ]);
    const [uploadAsset] = await service.stageFiles(conversationId, [uploaded]);

    expect(uploadAsset?.id).not.toBe(workspaceAsset?.id);
    expect(await repository.getContextAsset(uploadAsset!.id)).toMatchObject({
      source: "upload",
      managedPath: expect.any(String),
    });
  });

  it("normalizes images privately and requires vision when compiling them", async () => {
    const source = path.join(directory, "image.png");
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 210, g: 30, b: 20 } },
    })
      .png()
      .toFile(source);
    const [asset] = await service.stageFiles(conversationId, [source]);
    const ready = await eventually(
      () => repository.getContextAsset(asset!.id),
      (record) => record.status === "ready",
    );

    await expect(
      service.compile([ready], "descreva", { vision: false, contextWindow: 16_000 }),
    ).rejects.toThrow("modelo com visão");
    const compiled = await service.compile([ready], "descreva", {
      vision: true,
      contextWindow: 16_000,
    });
    expect(compiled.parts[1]).toMatchObject({
      type: "localImage",
      mimeType: "image/png",
      path: expect.stringMatching(/context-image\.png$/),
    });
    expect((await service.previewTarget(conversationId, ready.id, false)).mimeType).toBe(
      "image/png",
    );
  });
});
