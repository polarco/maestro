import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import ffmpegStatic from "ffmpeg-static";
import ignore, { type Ignore } from "ignore";
import sharp from "sharp";
import { ulid } from "ulid";
import type {
  ContextAssetKind,
  ContextAssetSource,
  ContextAssetSummary,
  ContextItemInput,
  ContextProcessingEvent,
  LocalModelPackageState,
  ProviderInputPart,
  WorkspaceContextCandidate,
} from "@maestro/contracts";
import type { ContextAssetRecord, MaestroRepository } from "@maestro/database";
import { assertPathWithinRoots, isPathWithinRootLexically, MaestroError } from "@maestro/core";
import {
  contextKindForFile,
  contextSizeLimit,
  isEligibleContextFile,
  MAX_AGGREGATE_BYTES,
  MAX_CONTEXT_ITEMS,
  MAX_FOLDER_BYTES,
  MAX_FOLDER_FILES,
  mimeTypeForFile,
} from "./context-file-types.js";
import type {
  ContextWorkerMessage,
  ContextWorkerRequest,
  ContextWorkerResult,
} from "./context-worker-protocol.js";
import { WorkspaceContextIndex } from "./workspace-context-index.js";

interface FolderEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
  modifiedAtMs: number;
}

interface FolderIgnoreScope {
  base: string;
  matcher: Ignore;
}

interface CompileOptions {
  vision: boolean;
  contextWindow: number | null;
}

interface ModelManifestFile {
  path: string;
  size: number;
  sha256: string;
}

interface QueuedAssetProcessing {
  assetId: string;
  media: boolean;
  resolve: () => void;
}

export interface CompiledContext {
  parts: ProviderInputPart[];
  warnings: string[];
}

const MODEL_ID = "whisper-small-multilingual-q4" as const;
const MODEL_VERSION = "onnx-community/whisper-small@q4-v1";
const MODEL_MARKER = "maestro-model-ready.json";
const LIVE_CHANGED_WARNING = "Este item mudou desde que foi mencionado.";
const FOLDER_ALWAYS_IGNORED = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  "release/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  "coverage/",
  "target/",
  "vendor/",
];

function safeFilename(value: string): string {
  const normalized = path
    .basename(value)
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .slice(0, 180);
  return normalized || "item";
}

function modifiedAt(value: Date): string {
  return value.toISOString();
}

function tokenEstimate(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function inputPath(record: ContextAssetRecord): string | null {
  return record.managedPath ?? record.sourcePath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workerStage(value: string): ContextProcessingEvent["stage"] {
  if (
    value === "staging" ||
    value === "hashing" ||
    value === "extracting" ||
    value === "transcoding" ||
    value === "transcribing" ||
    value === "indexing" ||
    value === "ready" ||
    value === "error"
  )
    return value;
  return "extracting";
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(absolute);
    else if (entry.isFile()) total += (await stat(absolute).catch(() => null))?.size ?? 0;
  }
  return total;
}

export class ContextService {
  readonly #repository: MaestroRepository;
  readonly #storageRoot: string;
  readonly #stagingRoot: string;
  readonly #conversationsRoot: string;
  readonly #modelsRoot: string;
  readonly #workerScript: string;
  readonly #index: WorkspaceContextIndex;
  readonly #workers = new Map<string, Worker>();
  readonly #processing = new Map<string, Promise<void>>();
  readonly #processingQueue: QueuedAssetProcessing[] = [];
  readonly #emitContext: (event: ContextProcessingEvent) => void;
  readonly #emitModel: (state: LocalModelPackageState) => void;
  #modelWorker: Worker | null = null;
  #modelDownloadGeneration = 0;
  #activeMediaProcessing = 0;
  #activeDocumentProcessing = 0;
  #disposed = false;
  #modelState: LocalModelPackageState = {
    id: MODEL_ID,
    version: MODEL_VERSION,
    status: "not_downloaded",
    progress: null,
    sizeBytes: 0,
    licenses: [
      "MIT (Whisper e ONNX Runtime)",
      "Apache-2.0 (Transformers.js)",
      "GPL-3.0 (FFmpeg estático)",
    ],
    message: "Pacote local ainda não baixado.",
  };

  constructor(input: {
    repository: MaestroRepository;
    userDataDirectory: string;
    emitContext: (event: ContextProcessingEvent) => void;
    emitModel: (state: LocalModelPackageState) => void;
    workerScript?: string;
  }) {
    this.#repository = input.repository;
    this.#storageRoot = path.join(input.userDataDirectory, "context");
    this.#stagingRoot = path.join(this.#storageRoot, "staging");
    this.#conversationsRoot = path.join(this.#storageRoot, "conversations");
    this.#modelsRoot = path.join(input.userDataDirectory, "models", MODEL_ID);
    this.#workerScript = input.workerScript ?? path.join(import.meta.dirname, "context-worker.js");
    this.#index = new WorkspaceContextIndex(input.repository);
    this.#emitContext = input.emitContext;
    this.#emitModel = input.emitModel;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.#stagingRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#conversationsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#modelsRoot, { recursive: true, mode: 0o700 }),
    ]);
    await this.cleanupStaging();
    await this.#cleanupOrphanedConversationStorage();
    const sizeBytes = await directorySize(this.#modelsRoot);
    const modelReady = await this.#validateModelManifest();
    this.#modelState = modelReady
      ? {
          ...this.#modelState,
          status: "ready",
          progress: 1,
          sizeBytes,
          message: "Whisper Small multilíngue está disponível offline.",
        }
      : {
          ...this.#modelState,
          sizeBytes,
          ...(sizeBytes > 0
            ? { message: "Cache local incompleto ou desatualizado; tente baixar novamente." }
            : {}),
        };
  }

  warmProject(projectId: string): void {
    this.#index.warm(projectId);
  }

  invalidateProject(projectId?: string): void {
    this.#index.invalidate(projectId);
  }

  searchWorkspace(
    projectId: string,
    query: string,
    limit?: number,
  ): Promise<WorkspaceContextCandidate[]> {
    return this.#index.search(projectId, query, limit);
  }

  async list(conversationId: string): Promise<ContextAssetSummary[]> {
    await this.refreshWorkspaceReferences(conversationId);
    if (this.#modelReady()) {
      const waiting = (await this.#repository.listContextAssetRecords(conversationId)).filter(
        (record) => record.status === "needs_model",
      );
      for (const record of waiting) {
        const updated = await this.#repository.updateContextAsset(record.id, {
          status: "processing",
          warning: null,
        });
        this.#scheduleProcessing(updated);
      }
    }
    return this.#repository.listContextAssets(conversationId);
  }

  async stageFiles(
    conversationId: string,
    paths: readonly string[],
    source: Extract<ContextAssetSource, "upload"> = "upload",
  ): Promise<ContextAssetSummary[]> {
    if (paths.length > MAX_CONTEXT_ITEMS)
      throw new MaestroError(
        "CONTEXT_ITEM_LIMIT",
        `Selecione no máximo ${MAX_CONTEXT_ITEMS} itens por mensagem.`,
        { recoverable: true },
      );
    const conversation = await this.#repository.getConversation(conversationId);
    const canonicalPaths = await Promise.all(paths.map((value) => realpath(value)));
    const metadata = await Promise.all(canonicalPaths.map((value) => stat(value)));
    const aggregate = metadata.reduce((total, value) => total + value.size, 0);
    if (aggregate > MAX_AGGREGATE_BYTES)
      throw new MaestroError(
        "CONTEXT_AGGREGATE_LIMIT",
        "A seleção ultrapassa 4 GiB. Refine os itens e tente novamente.",
        { recoverable: true },
      );
    for (const [index, canonicalPath] of canonicalPaths.entries()) {
      const fileMetadata = metadata[index]!;
      if (!fileMetadata.isFile())
        throw new MaestroError("INVALID_CONTEXT_ITEM", `O item não é um arquivo: ${canonicalPath}`);
      if (!isEligibleContextFile(canonicalPath))
        throw new MaestroError(
          "UNSUPPORTED_CONTEXT_TYPE",
          `Formato não suportado: ${path.basename(canonicalPath)}`,
          { recoverable: true },
        );
      const kind = contextKindForFile(canonicalPath);
      if (fileMetadata.size > contextSizeLimit(kind))
        throw new MaestroError(
          "CONTEXT_FILE_TOO_LARGE",
          `${path.basename(canonicalPath)} excede o limite permitido para este tipo.`,
          { recoverable: true },
        );
    }
    const summaries: ContextAssetSummary[] = [];
    for (const [index, canonicalPath] of canonicalPaths.entries()) {
      const fileMetadata = metadata[index]!;
      const kind = contextKindForFile(canonicalPath);
      summaries.push(
        await this.#stageManagedFile({
          projectId: conversation.projectId,
          conversationId,
          source,
          originalPath: canonicalPath,
          kind,
          mimeType: mimeTypeForFile(canonicalPath),
          size: fileMetadata.size,
          sourceModifiedAt: modifiedAt(fileMetadata.mtime),
        }),
      );
    }
    return summaries;
  }

  async stageFolder(conversationId: string, selectedPath: string): Promise<ContextAssetSummary> {
    const conversation = await this.#repository.getConversation(conversationId);
    const canonicalPath = await realpath(selectedPath);
    const folder = await stat(canonicalPath);
    if (!folder.isDirectory())
      throw new MaestroError("INVALID_CONTEXT_FOLDER", "O item selecionado não é uma pasta.");
    const entries = await this.#folderEntries(canonicalPath);
    const totalSize = entries.reduce((total, entry) => total + entry.size, 0);
    const hash = await this.#folderHash(entries);
    const duplicate = await this.#repository.findContextAssetByHash(conversationId, hash);
    if (duplicate) return this.#repository.toContextAssetSummary(duplicate);
    const id = ulid();
    const staging = path.join(this.#stagingRoot, id);
    const destinationDirectory = path.join(this.#conversationsRoot, conversationId, id);
    const managedPath = path.join(destinationDirectory, safeFilename(path.basename(canonicalPath)));
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const stagedFolder = path.join(staging, safeFilename(path.basename(canonicalPath)));
    for (const entry of entries) {
      const destination = path.join(stagedFolder, entry.relativePath);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(entry.absolutePath, destination);
      await chmod(destination, 0o600);
    }
    await mkdir(path.dirname(destinationDirectory), { recursive: true, mode: 0o700 });
    await rename(staging, destinationDirectory);
    const record = await this.#repository.createContextAsset({
      id,
      projectId: conversation.projectId,
      conversationId,
      workspaceRootId: null,
      source: "upload",
      kind: "folder",
      status: "processing",
      changeState: "not_applicable",
      name: path.basename(canonicalPath),
      mimeType: "application/x-directory",
      size: totalSize,
      relativePath: null,
      sourcePath: null,
      managedPath,
      thumbnailPath: null,
      contentHash: hash,
      currentHash: hash,
      sourceModifiedAt: modifiedAt(folder.mtime),
      durationMs: null,
      pageCount: null,
      extractedText: null,
      transcription: null,
      framePaths: [],
      metadata: { fileCount: entries.length },
      warning: null,
      error: null,
    });
    this.#emit(record, "staging", 1, "Pasta copiada para o armazenamento privado.");
    this.#scheduleProcessing(record);
    return this.#repository.toContextAssetSummary(record);
  }

  async stageBuffer(input: {
    conversationId: string;
    data: Uint8Array;
    name: string;
    mimeType: string;
    source: Extract<ContextAssetSource, "clipboard" | "recording">;
    durationMs?: number;
  }): Promise<ContextAssetSummary> {
    const conversation = await this.#repository.getConversation(input.conversationId);
    const kind = contextKindForFile(input.name, input.mimeType);
    if (kind === "unknown")
      throw new MaestroError("UNSUPPORTED_CONTEXT_TYPE", "O conteúdo colado não é compatível.");
    if (input.data.byteLength > contextSizeLimit(kind))
      throw new MaestroError("CONTEXT_FILE_TOO_LARGE", "O item excede o limite permitido.");
    const hash = createHash("sha256").update(input.data).digest("hex");
    const duplicate = await this.#repository.findContextAssetByHash(input.conversationId, hash);
    if (duplicate) return this.#repository.toContextAssetSummary(duplicate);
    const id = ulid();
    const directory = path.join(this.#conversationsRoot, input.conversationId, id);
    const managedPath = path.join(directory, safeFilename(input.name));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(managedPath, input.data, { mode: 0o600 });
    const record = await this.#repository.createContextAsset({
      id,
      projectId: conversation.projectId,
      conversationId: input.conversationId,
      workspaceRootId: null,
      source: input.source,
      kind,
      status: kind === "audio" && !this.#modelReady() ? "needs_model" : "processing",
      changeState: "not_applicable",
      name: input.name,
      mimeType: input.mimeType,
      size: input.data.byteLength,
      relativePath: null,
      sourcePath: null,
      managedPath,
      thumbnailPath: null,
      contentHash: hash,
      currentHash: hash,
      sourceModifiedAt: null,
      durationMs: input.durationMs ?? null,
      pageCount: null,
      extractedText: null,
      transcription: null,
      framePaths: [],
      metadata: {},
      warning:
        kind === "audio" && !this.#modelReady()
          ? "Baixe o pacote local para transcrever este áudio."
          : null,
      error: null,
    });
    this.#emit(record, "staging", 1, "Item salvo no armazenamento privado.");
    if (record.status === "processing") this.#scheduleProcessing(record);
    return this.#repository.toContextAssetSummary(record);
  }

  async prepareWorkspace(
    conversationId: string,
    candidates: readonly Pick<
      WorkspaceContextCandidate,
      "workspaceRootId" | "relativePath" | "kind"
    >[],
  ): Promise<ContextAssetSummary[]> {
    if (candidates.length > MAX_CONTEXT_ITEMS)
      throw new MaestroError(
        "CONTEXT_ITEM_LIMIT",
        `Mencione no máximo ${MAX_CONTEXT_ITEMS} itens por mensagem.`,
      );
    const conversation = await this.#repository.getConversation(conversationId);
    const existing = await this.#repository.listContextAssetRecords(conversationId);
    const result: ContextAssetSummary[] = [];
    for (const candidate of candidates) {
      const root = await this.#repository.getWorkspaceRoot(candidate.workspaceRootId);
      if (root.projectId !== conversation.projectId)
        throw new MaestroError(
          "WORKSPACE_PROJECT_MISMATCH",
          "A referência não pertence ao projeto desta conversa.",
        );
      const normalizedRelative = candidate.relativePath.replaceAll("\\", "/");
      const prior = existing.find(
        (record) =>
          record.source === "workspace" &&
          record.workspaceRootId === root.id &&
          record.relativePath === normalizedRelative,
      );
      if (prior) {
        result.push(this.#repository.toContextAssetSummary(prior));
        continue;
      }
      const lexical = path.resolve(root.canonicalPath, candidate.relativePath);
      const canonical = await assertPathWithinRoots(lexical, [root.canonicalPath]);
      const metadata = await stat(canonical);
      if (
        (candidate.kind === "file" && !metadata.isFile()) ||
        (candidate.kind === "directory" && !metadata.isDirectory())
      )
        throw new MaestroError("INVALID_WORKSPACE_REFERENCE", "A referência mudou de tipo.");
      let kind: ContextAssetKind;
      let size = metadata.size;
      let hash: string;
      let itemMetadata: Record<string, unknown> = {};
      if (metadata.isDirectory()) {
        const entries = await this.#folderEntries(canonical);
        size = entries.reduce((total, entry) => total + entry.size, 0);
        hash = await this.#folderHash(entries);
        kind = "folder";
        itemMetadata = {
          fileCount: entries.length,
          observedFolderSignature: this.#folderSignature(entries),
        };
      } else {
        kind = contextKindForFile(canonical);
        if (kind === "unknown")
          throw new MaestroError(
            "UNSUPPORTED_CONTEXT_TYPE",
            `Formato não suportado: ${path.basename(canonical)}`,
          );
        if (size > contextSizeLimit(kind))
          throw new MaestroError(
            "CONTEXT_FILE_TOO_LARGE",
            "A referência excede o limite permitido.",
          );
        hash = await this.#hashFile(canonical);
      }
      const record = await this.#repository.createContextAsset({
        projectId: conversation.projectId,
        conversationId,
        workspaceRootId: root.id,
        source: "workspace",
        kind,
        status:
          (kind === "audio" || kind === "video") && !this.#modelReady()
            ? "needs_model"
            : "processing",
        changeState: "current",
        name: path.basename(canonical),
        mimeType: kind === "folder" ? "application/x-directory" : mimeTypeForFile(canonical),
        size,
        relativePath: normalizedRelative,
        sourcePath: canonical,
        managedPath: null,
        thumbnailPath: null,
        contentHash: hash,
        currentHash: hash,
        sourceModifiedAt: modifiedAt(metadata.mtime),
        durationMs: null,
        pageCount: null,
        extractedText: null,
        transcription: null,
        framePaths: [],
        metadata: itemMetadata,
        warning:
          (kind === "audio" || kind === "video") && !this.#modelReady()
            ? "Baixe o pacote local para transcrever esta mídia."
            : null,
        error: null,
      });
      this.#emit(record, "hashing", 1, "Referência do workspace verificada.");
      if (record.status === "processing") this.#scheduleProcessing(record);
      result.push(this.#repository.toContextAssetSummary(record));
    }
    return result;
  }

  async resolveItems(
    conversationId: string,
    items: readonly ContextItemInput[],
  ): Promise<ContextAssetRecord[]> {
    if (items.length > MAX_CONTEXT_ITEMS)
      throw new MaestroError(
        "CONTEXT_ITEM_LIMIT",
        `Use no máximo ${MAX_CONTEXT_ITEMS} itens por mensagem.`,
      );
    const workspaceItems = items.filter(
      (item): item is Extract<ContextItemInput, { type: "workspace" }> => item.type === "workspace",
    );
    const prepared = workspaceItems.length
      ? await this.prepareWorkspace(conversationId, workspaceItems)
      : [];
    const assetIds = items.flatMap((item) =>
      item.type === "asset"
        ? [item.assetId]
        : prepared
            .filter(
              (asset) =>
                asset.workspaceRootId === item.workspaceRootId &&
                asset.relativePath === item.relativePath.replaceAll("\\", "/"),
            )
            .map((asset) => asset.id),
    );
    const uniqueIds = [...new Set(assetIds)];
    const records = await this.#repository.getContextAssets(uniqueIds);
    if (records.length !== uniqueIds.length)
      throw new MaestroError("CONTEXT_ASSET_NOT_FOUND", "Um item de contexto não foi encontrado.");
    if (records.some((record) => record.conversationId !== conversationId))
      throw new MaestroError(
        "CONTEXT_CONVERSATION_MISMATCH",
        "Um item de contexto pertence a outra conversa.",
      );
    const total = records.reduce((sum, record) => sum + record.size, 0);
    if (total > MAX_AGGREGATE_BYTES)
      throw new MaestroError(
        "CONTEXT_AGGREGATE_LIMIT",
        "Os itens somam mais de 4 GiB. Remova alguns anexos.",
      );
    for (const record of records) {
      if (record.status === "needs_model" && this.#modelReady()) {
        await this.#repository.updateContextAsset(record.id, {
          status: "processing",
          warning: null,
        });
        await this.#enqueueProcessing(record);
        Object.assign(record, await this.#repository.getContextAsset(record.id));
      }
      if (record.status === "needs_model")
        throw new MaestroError(
          "LOCAL_MODEL_REQUIRED",
          "Baixe o pacote local de mídia antes de enviar áudio ou vídeo.",
          { recoverable: true },
        );
      if (record.status === "processing" || record.status === "staging")
        throw new MaestroError("CONTEXT_PROCESSING", "Aguarde o processamento de todos os itens.", {
          recoverable: true,
        });
      if (record.status === "error")
        throw new MaestroError(
          "CONTEXT_PROCESSING_FAILED",
          record.error ?? `Falha ao processar ${record.name}.`,
          { recoverable: true },
        );
      if (record.status === "missing")
        throw new MaestroError(
          "CONTEXT_ASSET_MISSING",
          `${record.name} não está mais disponível.`,
          { recoverable: true },
        );
    }
    return records;
  }

  async compile(
    records: readonly ContextAssetRecord[],
    prompt: string,
    options: CompileOptions,
  ): Promise<CompiledContext> {
    const warnings: string[] = [];
    for (const record of records) {
      if (record.source === "workspace") await this.#refreshWorkspaceRecord(record, true);
    }
    const refreshed = await this.#repository.getContextAssets(records.map((record) => record.id));
    if (refreshed.reduce((total, record) => total + record.size, 0) > MAX_AGGREGATE_BYTES)
      throw new MaestroError(
        "CONTEXT_AGGREGATE_LIMIT",
        "Os itens agora somam mais de 4 GiB. Remova alguns anexos ou refine as referências.",
        { recoverable: true },
      );
    const unavailable = refreshed.find(
      (record) => record.status === "missing" || record.status === "error",
    );
    if (unavailable)
      throw new MaestroError(
        unavailable.status === "missing" ? "CONTEXT_ASSET_MISSING" : "CONTEXT_PROCESSING_FAILED",
        unavailable.error ?? `${unavailable.name} não está disponível para envio.`,
        { recoverable: true },
      );
    const maxTokens = Math.min(
      64_000,
      options.contextWindow ? options.contextWindow * 0.25 : 32_000,
    );
    let remainingTokens = Math.floor(maxTokens);
    const textSections: string[] = [];
    const large: ContextAssetRecord[] = [];
    const images: Array<{ path: string; mimeType: string; label: string }> = [];

    for (const record of refreshed) {
      const source = inputPath(record);
      const heading = record.relativePath ? `${record.name} (${record.relativePath})` : record.name;
      if (record.kind === "image" && source) {
        const normalized =
          typeof record.metadata.providerImagePath === "string"
            ? record.metadata.providerImagePath
            : source;
        images.push({
          path: normalized,
          mimeType: normalized === source ? record.mimeType : "image/png",
          label: heading,
        });
        continue;
      }
      if (record.framePaths.length > 0) {
        if (options.vision) {
          for (const frame of record.framePaths.slice(0, 12))
            images.push({ path: frame, mimeType: "image/jpeg", label: heading });
        } else if (record.metadata.scannedPdf === true) {
          throw new MaestroError(
            "MODEL_VISION_REQUIRED",
            `${record.name} é um PDF digitalizado e exige um modelo com visão.`,
            { recoverable: true },
          );
        } else {
          warnings.push(`Quadros de ${record.name} omitidos porque o modelo não possui visão.`);
        }
      }
      const text = record.transcription ?? record.extractedText ?? "";
      if (!text.trim()) continue;
      const estimated = tokenEstimate(text);
      if (estimated <= 8_000 && estimated <= remainingTokens) {
        textSections.push(`### ${heading}\n${text}`);
        remainingTokens -= estimated;
      } else large.push(record);
    }

    if (large.length > 0 && remainingTokens > 0) {
      const selected = await this.#repository.searchContextChunks(
        large.map((record) => record.id),
        prompt,
        Math.min(80, Math.max(8, Math.ceil(remainingTokens / 900))),
      );
      const byId = new Map(large.map((record) => [record.id, record]));
      for (const chunk of selected) {
        if (chunk.tokenCount > remainingTokens) continue;
        const record = byId.get(chunk.assetId);
        textSections.push(
          `### ${record?.name ?? "Item"} · trecho ${chunk.ordinal + 1}\n${chunk.content}`,
        );
        remainingTokens -= chunk.tokenCount;
        if (remainingTokens <= 0) break;
      }
    }

    if (images.length > 0 && !options.vision)
      throw new MaestroError(
        "MODEL_VISION_REQUIRED",
        "Os itens incluem imagem sem texto disponível. Escolha um modelo com visão.",
        { recoverable: true },
      );

    const contextText = [
      textSections.length
        ? "\n\n<contexto_anexado>\n" + textSections.join("\n\n") + "\n</contexto_anexado>"
        : "",
      warnings.length
        ? `\n\nAvisos de contexto:\n${warnings.map((item) => `- ${item}`).join("\n")}`
        : "",
    ].join("");
    const parts: ProviderInputPart[] = [{ type: "text", text: `${prompt}${contextText}` }];
    for (const image of images)
      parts.push({ type: "localImage", path: image.path, mimeType: image.mimeType });
    return { parts, warnings };
  }

  async refreshWorkspaceReferences(conversationId: string): Promise<void> {
    const records = await this.#repository.listContextAssetRecords(conversationId);
    await Promise.all(
      records
        .filter((record) => record.source === "workspace")
        .map((record) => this.#refreshWorkspaceRecord(record, false)),
    );
  }

  async remove(conversationId: string, assetId: string): Promise<void> {
    const record = await this.#repository.getContextAsset(assetId);
    if (record.conversationId !== conversationId)
      throw new MaestroError(
        "CONTEXT_CONVERSATION_MISMATCH",
        "O item de contexto não pertence a esta conversa.",
      );
    // Reusing a previous attachment in the composer must only detach it from the
    // draft. The persisted message remains immutable and keeps its asset.
    if (await this.#repository.isContextAssetLinked(assetId)) return;
    const worker = this.#workers.get(assetId);
    if (worker) await worker.terminate().catch(() => null);
    this.#workers.delete(assetId);
    await this.#repository.deleteContextAsset(conversationId, assetId);
    await this.#removeManagedRecord(record);
  }

  async removeConversationFiles(conversationId: string): Promise<void> {
    for (const [assetId, worker] of this.#workers) {
      const record = await this.#repository.getContextAsset(assetId).catch(() => null);
      if (record?.conversationId !== conversationId) continue;
      await worker.terminate().catch(() => null);
      this.#workers.delete(assetId);
    }
    const directory = path.join(this.#conversationsRoot, conversationId);
    if (isPathWithinRootLexically(directory, this.#conversationsRoot))
      await rm(directory, { recursive: true, force: true });
  }

  async removeProjectFiles(projectId: string): Promise<void> {
    const records = await this.#repository.listProjectContextAssetRecords(projectId);
    await Promise.all(
      [...new Set(records.map((record) => record.conversationId))].map((conversationId) =>
        this.removeConversationFiles(conversationId),
      ),
    );
  }

  async previewTarget(
    conversationId: string,
    assetId: string,
    thumbnail: boolean,
  ): Promise<{ path: string; mimeType: string; name: string }> {
    let record = await this.#repository.getContextAsset(assetId);
    if (record.conversationId !== conversationId)
      throw new MaestroError("CONTEXT_PREVIEW_FORBIDDEN", "Preview fora da conversa solicitada.");
    const activeProjectId = await this.#repository.getActiveProjectId();
    if (activeProjectId !== record.projectId)
      throw new MaestroError("CONTEXT_PREVIEW_FORBIDDEN", "Preview fora do projeto ativo.");
    if (record.source === "workspace") {
      await this.#refreshWorkspaceRecord(record, record.kind === "image");
      record = await this.#repository.getContextAsset(assetId);
    }
    if (record.status === "missing")
      throw new MaestroError("CONTEXT_ASSET_MISSING", "O arquivo não está mais autorizado.");
    const normalizedImage =
      record.kind === "image" && typeof record.metadata.providerImagePath === "string"
        ? record.metadata.providerImagePath
        : null;
    const selected = thumbnail ? record.thumbnailPath : (normalizedImage ?? inputPath(record));
    if (!selected)
      throw new MaestroError("CONTEXT_PREVIEW_UNAVAILABLE", "Preview indisponível para este item.");
    await stat(selected).catch(() => {
      throw new MaestroError("CONTEXT_ASSET_MISSING", "O arquivo de preview não existe mais.");
    });
    return {
      path: selected,
      mimeType: thumbnail || normalizedImage ? "image/png" : record.mimeType,
      name: record.name,
    };
  }

  getLocalModelState(): LocalModelPackageState {
    return { ...this.#modelState };
  }

  downloadLocalModel(): LocalModelPackageState {
    if (this.#modelState.status === "ready" || this.#modelState.status === "downloading")
      return this.getLocalModelState();
    this.#modelState = {
      ...this.#modelState,
      status: "downloading",
      progress: 0,
      message: "Baixando Whisper Small multilíngue…",
    };
    this.#emitModel(this.getLocalModelState());
    const worker = this.#createWorker({ type: "warm-model", modelsDirectory: this.#modelsRoot });
    const generation = ++this.#modelDownloadGeneration;
    this.#modelWorker = worker;
    worker.on("message", (message: ContextWorkerMessage) => {
      if (this.#modelWorker !== worker || this.#modelDownloadGeneration !== generation) return;
      if (message.type === "progress") {
        this.#modelState = {
          ...this.#modelState,
          progress: message.progress,
          message: message.message,
        };
        this.#emitModel(this.getLocalModelState());
      }
      if (message.type === "model-ready") {
        void this.#finishModelDownload(worker, generation).catch((error: unknown) =>
          this.#failModelDownload(errorMessage(error), worker, generation),
        );
      }
      if (message.type === "error") this.#failModelDownload(message.message, worker, generation);
    });
    worker.once("error", (error: Error) =>
      this.#failModelDownload(error.message, worker, generation),
    );
    return this.getLocalModelState();
  }

  async cancelLocalModelDownload(): Promise<LocalModelPackageState> {
    const worker = this.#modelWorker;
    const wasDownloading = this.#modelState.status === "downloading";
    this.#modelDownloadGeneration += 1;
    this.#modelWorker = null;
    if (worker) await worker.terminate().catch(() => null);
    if (wasDownloading) {
      await rm(path.join(this.#modelsRoot, MODEL_MARKER), { force: true });
      this.#modelState = {
        ...this.#modelState,
        status: "not_downloaded",
        progress: null,
        message: "Download cancelado. Arquivos parciais podem ser retomados.",
      };
      this.#emitModel(this.getLocalModelState());
    }
    return this.getLocalModelState();
  }

  async removeLocalModel(): Promise<LocalModelPackageState> {
    await this.cancelLocalModelDownload();
    await rm(this.#modelsRoot, { recursive: true, force: true });
    await mkdir(this.#modelsRoot, { recursive: true, mode: 0o700 });
    this.#modelState = {
      ...this.#modelState,
      status: "not_downloaded",
      progress: null,
      sizeBytes: 0,
      message: "Pacote local removido.",
    };
    this.#emitModel(this.getLocalModelState());
    return this.getLocalModelState();
  }

  async cleanupStaging(): Promise<void> {
    const entries = await readdir(this.#stagingRoot, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - 24 * 60 * 60_000;
    await Promise.all(
      entries.map(async (entry) => {
        const absolute = path.join(this.#stagingRoot, entry.name);
        const metadata = await stat(absolute).catch(() => null);
        if (metadata && metadata.mtimeMs < cutoff)
          await rm(absolute, { recursive: true, force: true });
      }),
    );
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    const processing = [...this.#processing.values()];
    for (const queued of this.#processingQueue.splice(0)) {
      this.#processing.delete(queued.assetId);
      queued.resolve();
    }
    await Promise.allSettled([...this.#workers.values()].map((worker) => worker.terminate()));
    this.#workers.clear();
    await Promise.allSettled(processing);
    const modelWorker = this.#modelWorker;
    this.#modelDownloadGeneration += 1;
    this.#modelWorker = null;
    if (modelWorker) await modelWorker.terminate().catch(() => null);
  }

  async #stageManagedFile(input: {
    projectId: string;
    conversationId: string;
    source: ContextAssetSource;
    originalPath: string;
    kind: ContextAssetKind;
    mimeType: string;
    size: number;
    sourceModifiedAt: string;
  }): Promise<ContextAssetSummary> {
    const hash = await this.#hashFile(input.originalPath);
    const duplicate = await this.#repository.findContextAssetByHash(input.conversationId, hash);
    if (duplicate) return this.#repository.toContextAssetSummary(duplicate);
    const id = ulid();
    const staged = path.join(this.#stagingRoot, `${id}-${safeFilename(input.originalPath)}`);
    const directory = path.join(this.#conversationsRoot, input.conversationId, id);
    const managedPath = path.join(directory, safeFilename(input.originalPath));
    await copyFile(input.originalPath, staged);
    await chmod(staged, 0o600);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rename(staged, managedPath);
    const needsModel = (input.kind === "audio" || input.kind === "video") && !this.#modelReady();
    const record = await this.#repository.createContextAsset({
      id,
      projectId: input.projectId,
      conversationId: input.conversationId,
      workspaceRootId: null,
      source: input.source,
      kind: input.kind,
      status: needsModel ? "needs_model" : "processing",
      changeState: "not_applicable",
      name: path.basename(input.originalPath),
      mimeType: input.mimeType,
      size: input.size,
      relativePath: null,
      sourcePath: null,
      managedPath,
      thumbnailPath: null,
      contentHash: hash,
      currentHash: hash,
      sourceModifiedAt: input.sourceModifiedAt,
      durationMs: null,
      pageCount: null,
      extractedText: null,
      transcription: null,
      framePaths: [],
      metadata: {},
      warning: needsModel ? "Baixe o pacote local para transcrever esta mídia." : null,
      error: null,
    });
    this.#emit(record, "staging", 1, "Arquivo copiado para o armazenamento privado.");
    if (!needsModel) this.#scheduleProcessing(record);
    return this.#repository.toContextAssetSummary(record);
  }

  #scheduleProcessing(record: ContextAssetRecord): void {
    void this.#enqueueProcessing(record);
  }

  #enqueueProcessing(record: ContextAssetRecord): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const existing = this.#processing.get(record.id);
    if (existing) return existing;
    let resolve!: () => void;
    const completion = new Promise<void>((done) => {
      resolve = done;
    });
    this.#processing.set(record.id, completion);
    this.#processingQueue.push({
      assetId: record.id,
      media: record.kind === "audio" || record.kind === "video",
      resolve,
    });
    queueMicrotask(() => this.#drainProcessingQueue());
    return completion;
  }

  #drainProcessingQueue(): void {
    if (this.#disposed) return;
    while (this.#processingQueue.length > 0) {
      const index = this.#processingQueue.findIndex((item) =>
        item.media ? this.#activeMediaProcessing < 1 : this.#activeDocumentProcessing < 2,
      );
      if (index < 0) return;
      const [queued] = this.#processingQueue.splice(index, 1);
      if (!queued) return;
      if (queued.media) this.#activeMediaProcessing += 1;
      else this.#activeDocumentProcessing += 1;
      void this.#process(queued.assetId).finally(() => {
        if (queued.media) this.#activeMediaProcessing -= 1;
        else this.#activeDocumentProcessing -= 1;
        this.#processing.delete(queued.assetId);
        queued.resolve();
        this.#drainProcessingQueue();
      });
    }
  }

  async #process(assetId: string): Promise<void> {
    const initial = await this.#repository.getContextAsset(assetId).catch(() => null);
    if (!initial || this.#disposed || this.#workers.has(assetId)) return;
    const source = inputPath(initial);
    if (!source) return;
    try {
      if (initial.kind === "image") {
        const outputDirectory = initial.managedPath
          ? path.dirname(initial.managedPath)
          : path.join(this.#conversationsRoot, initial.conversationId, initial.id, "derived");
        await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
        const thumbnailPath = path.join(outputDirectory, "thumbnail.png");
        const providerImagePath = path.join(outputDirectory, "context-image.png");
        this.#emit(initial, "extracting", 0.4, "Gerando miniatura…");
        const image = sharp(source, { animated: false }).rotate();
        await Promise.all([
          image
            .clone()
            .resize({ width: 420, height: 420, fit: "inside", withoutEnlargement: true })
            .png()
            .toFile(thumbnailPath),
          image
            .clone()
            .resize({ width: 2_048, height: 2_048, fit: "inside", withoutEnlargement: true })
            .png()
            .toFile(providerImagePath),
        ]);
        const updated = await this.#repository.updateContextAsset(assetId, {
          thumbnailPath,
          status: "ready",
          metadata: {
            ...initial.metadata,
            providerImagePath,
            processedContentHash: initial.currentHash,
          },
          error: null,
          warning: null,
        });
        this.#emit(updated, "ready", 1, "Imagem pronta.");
        return;
      }
      if (initial.kind === "audio" || initial.kind === "video") {
        if (!this.#modelReady()) {
          const updated = await this.#repository.updateContextAsset(assetId, {
            status: "needs_model",
            warning: "Baixe o pacote local para transcrever esta mídia.",
          });
          this.#emit(updated, "transcribing", null, updated.warning!);
          return;
        }
      }
      if (initial.kind === "unknown") throw new Error("Formato de contexto não suportado.");
      const outputDirectory = initial.managedPath
        ? path.dirname(initial.managedPath)
        : path.join(this.#conversationsRoot, initial.conversationId, initial.id, "derived");
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      const folderEntries =
        initial.kind === "folder"
          ? (await this.#folderEntries(source)).map((entry) => entry.relativePath)
          : null;
      const ffmpegPath = this.#ffmpegPath();
      const request: ContextWorkerRequest = {
        type: "extract",
        assetKind: initial.kind,
        inputPath: source,
        outputDirectory,
        mimeType: initial.mimeType,
        modelsDirectory: this.#modelsRoot,
        ffmpegPath,
        allowRemoteModels: false,
        ...(folderEntries ? { folderEntries } : {}),
      };
      const result = await this.#runAssetWorker(initial, request);
      let thumbnailPath: string | null = null;
      const representativeFrame = result.framePaths[0];
      if (representativeFrame) {
        thumbnailPath = path.join(outputDirectory, "thumbnail.png");
        await sharp(representativeFrame, { animated: false })
          .rotate()
          .resize({ width: 420, height: 420, fit: "inside", withoutEnlargement: true })
          .png()
          .toFile(thumbnailPath);
      }
      await this.#repository.replaceContextChunks(assetId, result.chunks);
      const updated = await this.#repository.updateContextAsset(assetId, {
        status: "ready",
        thumbnailPath,
        extractedText: result.extractedText || null,
        transcription: result.transcription,
        durationMs: result.durationMs ?? initial.durationMs,
        pageCount: result.pageCount,
        framePaths: result.framePaths,
        metadata: {
          ...initial.metadata,
          ...result.metadata,
          processedContentHash: initial.currentHash,
        },
        warning: result.warning,
        error: null,
      });
      this.#emit(updated, "ready", 1, "Item pronto para envio.");
    } catch (error) {
      const updated = await this.#repository
        .updateContextAsset(assetId, {
          status: "error",
          error: errorMessage(error),
        })
        .catch(() => null);
      if (updated) this.#emit(updated, "error", null, updated.error ?? "Falha no processamento.");
    }
  }

  #runAssetWorker(
    record: ContextAssetRecord,
    request: ContextWorkerRequest,
  ): Promise<ContextWorkerResult> {
    return new Promise((resolve, reject) => {
      const worker = this.#createWorker(request);
      this.#workers.set(record.id, worker);
      let settled = false;
      const finish = (): void => {
        this.#workers.delete(record.id);
      };
      worker.on("message", (message: ContextWorkerMessage) => {
        if (message.type === "progress")
          this.#emit(record, workerStage(message.stage), message.progress, message.message);
        if (message.type === "result" && !settled) {
          settled = true;
          finish();
          resolve(message.result);
        }
        if (message.type === "error" && !settled) {
          settled = true;
          finish();
          reject(new Error(message.message));
        }
      });
      worker.once("error", (error: Error) => {
        if (settled) return;
        settled = true;
        finish();
        reject(error);
      });
      worker.once("exit", (code) => {
        if (settled) return;
        settled = true;
        finish();
        reject(
          new Error(
            code === 0
              ? "Worker de contexto encerrou sem produzir resultado."
              : `Worker de contexto encerrou com código ${code}.`,
          ),
        );
      });
    });
  }

  #createWorker(request: ContextWorkerRequest): Worker {
    return new Worker(this.#workerScript, { workerData: request });
  }

  async #refreshWorkspaceRecord(record: ContextAssetRecord, reprocess: boolean): Promise<void> {
    if (record.source !== "workspace" || !record.sourcePath) return;
    const root = record.workspaceRootId
      ? await this.#repository.getWorkspaceRoot(record.workspaceRootId).catch(() => null)
      : null;
    const canonical = root
      ? await assertPathWithinRoots(record.sourcePath, [root.canonicalPath]).catch(() => null)
      : null;
    const metadata = canonical ? await stat(canonical).catch(() => null) : null;
    if (!metadata || !canonical) {
      await this.#repository.updateContextAsset(record.id, {
        status: "missing",
        changeState: "missing",
        error: "O arquivo ou pasta não existe mais dentro de uma raiz autorizada.",
      });
      return;
    }
    const expectedDirectory = record.kind === "folder";
    if (metadata.isDirectory() !== expectedDirectory) {
      await this.#repository.updateContextAsset(record.id, {
        status: "error",
        changeState: "changed",
        metadata: { ...record.metadata, liveTypeChanged: true },
        warning: null,
        error: "O item mudou de arquivo para pasta, ou de pasta para arquivo.",
      });
      return;
    }

    const observedModifiedAt = modifiedAt(metadata.mtime);
    let liveSize = metadata.size;
    let folderEntries: FolderEntry[] | null = null;
    let observedFolderSignature: string | null = null;
    if (metadata.isDirectory()) {
      try {
        folderEntries = await this.#folderEntries(canonical);
      } catch (error) {
        if (!(error instanceof MaestroError) || error.code !== "CONTEXT_FOLDER_LIMIT") throw error;
        await this.#repository.updateContextAsset(record.id, {
          status: "error",
          changeState: "changed",
          metadata: { ...record.metadata, liveLimitExceeded: true },
          warning: null,
          error: error.message,
        });
        return;
      }
      liveSize = folderEntries.reduce((total, entry) => total + entry.size, 0);
      observedFolderSignature = this.#folderSignature(folderEntries);
      if (
        !reprocess &&
        record.status !== "missing" &&
        record.status !== "error" &&
        record.metadata.observedFolderSignature === observedFolderSignature
      )
        return;
    } else {
      if (metadata.size > contextSizeLimit(record.kind)) {
        await this.#repository.updateContextAsset(record.id, {
          status: "error",
          changeState: "changed",
          size: metadata.size,
          sourceModifiedAt: observedModifiedAt,
          metadata: { ...record.metadata, liveLimitExceeded: true },
          warning: null,
          error: `${record.name} passou a exceder o limite permitido para este tipo.`,
        });
        return;
      }
      if (
        !reprocess &&
        record.status !== "missing" &&
        record.status !== "error" &&
        record.sourceModifiedAt === observedModifiedAt &&
        record.size === metadata.size
      )
        return;
    }

    const currentHash = folderEntries
      ? await this.#folderHash(folderEntries)
      : await this.#hashFile(canonical);
    const changed = currentHash !== record.contentHash;
    const processedContentHash =
      typeof record.metadata.processedContentHash === "string"
        ? record.metadata.processedContentHash
        : record.contentHash;
    const contentChangedSinceProcessing = currentHash !== processedContentHash;
    const recovering =
      record.status === "missing" ||
      record.metadata.liveLimitExceeded === true ||
      record.metadata.liveTypeChanged === true;
    const priorWarning = record.warning === LIVE_CHANGED_WARNING ? null : record.warning;
    await this.#repository.updateContextAsset(record.id, {
      currentHash,
      size: liveSize,
      sourceModifiedAt: observedModifiedAt,
      changeState: changed ? "changed" : "current",
      metadata: {
        ...record.metadata,
        liveLimitExceeded: false,
        liveTypeChanged: false,
        ...(observedFolderSignature ? { observedFolderSignature } : {}),
      },
      ...(recovering ? { status: "ready", error: null } : {}),
      warning: changed ? LIVE_CHANGED_WARNING : priorWarning,
    });
    if (contentChangedSinceProcessing && (reprocess || record.status === "error")) {
      const processing = await this.#repository.updateContextAsset(record.id, {
        status: "processing",
        error: null,
      });
      await this.#enqueueProcessing(processing);
    }
  }

  async #folderEntries(directory: string): Promise<FolderEntry[]> {
    const entries: FolderEntry[] = [];
    let totalSize = 0;
    const walk = async (current: string, parentScopes: FolderIgnoreScope[]): Promise<void> => {
      const rules = await readFile(path.join(current, ".gitignore"), "utf8").catch(() => "");
      const scopes = rules
        ? [...parentScopes, { base: current, matcher: ignore().add(rules) }]
        : parentScopes;
      const children = await readdir(current, { withFileTypes: true });
      for (const child of children) {
        if (child.isSymbolicLink()) continue;
        const absolute = path.join(current, child.name);
        const excluded = scopes.some((scope) => {
          const relative = path.relative(scope.base, absolute).split(path.sep).join("/");
          return (
            relative !== "" &&
            !relative.startsWith("../") &&
            scope.matcher.ignores(child.isDirectory() ? `${relative}/` : relative)
          );
        });
        if (excluded) continue;
        if (child.isDirectory()) {
          await walk(absolute, scopes);
          continue;
        }
        if (!child.isFile() || !isEligibleContextFile(child.name)) continue;
        const canonicalFile = await assertPathWithinRoots(absolute, [directory]);
        const metadata = await stat(canonicalFile);
        entries.push({
          absolutePath: canonicalFile,
          relativePath: path.relative(directory, absolute),
          size: metadata.size,
          modifiedAtMs: metadata.mtimeMs,
        });
        totalSize += metadata.size;
        if (entries.length > MAX_FOLDER_FILES || totalSize > MAX_FOLDER_BYTES)
          throw new MaestroError(
            "CONTEXT_FOLDER_LIMIT",
            "A pasta excede 500 arquivos elegíveis ou 250 MiB. Selecione uma subpasta menor.",
            { recoverable: true },
          );
      }
    };
    await walk(directory, [{ base: directory, matcher: ignore().add(FOLDER_ALWAYS_IGNORED) }]);
    return entries;
  }

  async #folderHash(entries: readonly FolderEntry[]): Promise<string> {
    const hash = createHash("sha256");
    for (const entry of [...entries].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )) {
      hash.update(entry.relativePath);
      hash.update(await this.#hashFile(entry.absolutePath));
    }
    return hash.digest("hex");
  }

  #folderSignature(entries: readonly FolderEntry[]): string {
    const hash = createHash("sha256");
    for (const entry of [...entries].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )) {
      hash.update(entry.relativePath);
      hash.update(String(entry.size));
      hash.update(String(entry.modifiedAtMs));
    }
    return hash.digest("hex");
  }

  #hashFile(filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filename);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.once("error", reject);
      stream.once("end", () => resolve(hash.digest("hex")));
    });
  }

  async #removeManagedRecord(record: ContextAssetRecord): Promise<void> {
    const directory = path.join(this.#conversationsRoot, record.conversationId, record.id);
    if (!isPathWithinRootLexically(directory, this.#conversationsRoot))
      throw new MaestroError("CONTEXT_STORAGE_ESCAPE", "Caminho privado inválido.");
    await rm(directory, { recursive: true, force: true });
  }

  #emit(
    record: ContextAssetRecord,
    stage: ContextProcessingEvent["stage"],
    progress: number | null,
    message: string,
  ): void {
    this.#emitContext({
      conversationId: record.conversationId,
      asset: this.#repository.toContextAssetSummary(record),
      stage,
      progress,
      message,
    });
  }

  #modelReady(): boolean {
    return this.#modelState.status === "ready";
  }

  #ffmpegPath(): string {
    if (!ffmpegStatic)
      throw new MaestroError("FFMPEG_UNAVAILABLE", "Runtime local de mídia não está disponível.");
    return ffmpegStatic.replace("app.asar", "app.asar.unpacked");
  }

  async #finishModelDownload(worker: Worker, generation: number): Promise<void> {
    if (this.#modelWorker !== worker || this.#modelDownloadGeneration !== generation) return;
    this.#modelState = {
      ...this.#modelState,
      progress: 0.99,
      message: "Verificando integridade do pacote local…",
    };
    this.#emitModel(this.getLocalModelState());
    const files = await this.#modelManifestFiles();
    if (this.#modelWorker !== worker || this.#modelDownloadGeneration !== generation) return;
    if (files.length === 0) {
      this.#failModelDownload(
        "O download terminou sem arquivos de modelo utilizáveis.",
        worker,
        generation,
      );
      return;
    }
    await writeFile(
      path.join(this.#modelsRoot, MODEL_MARKER),
      JSON.stringify({
        id: MODEL_ID,
        version: MODEL_VERSION,
        generation,
        downloadedAt: new Date().toISOString(),
        files,
      }),
      { mode: 0o600 },
    );
    if (this.#modelWorker !== worker || this.#modelDownloadGeneration !== generation) {
      await this.#removeModelMarkerForGeneration(generation);
      return;
    }
    const sizeBytes = await directorySize(this.#modelsRoot);
    if (this.#modelWorker !== worker || this.#modelDownloadGeneration !== generation) {
      await this.#removeModelMarkerForGeneration(generation);
      return;
    }
    this.#modelWorker = null;
    this.#modelState = {
      ...this.#modelState,
      status: "ready",
      progress: 1,
      sizeBytes,
      message: "Pacote local pronto; transcrição funcionará offline.",
    };
    this.#emitModel(this.getLocalModelState());
    // Assets waiting for consent are retried lazily when their conversation is opened or sent.
  }

  async #modelManifestFiles(): Promise<ModelManifestFile[]> {
    const files: ModelManifestFile[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.name === MODEL_MARKER || entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          const metadata = await stat(absolute);
          files.push({
            path: path.relative(this.#modelsRoot, absolute).split(path.sep).join("/"),
            size: metadata.size,
            sha256: await this.#hashFile(absolute),
          });
        }
      }
    };
    await walk(this.#modelsRoot);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async #cleanupOrphanedConversationStorage(): Promise<void> {
    const entries = await readdir(this.#conversationsRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map(async (entry) => {
          const conversation = await this.#repository.getConversation(entry.name).catch(() => null);
          if (conversation) return;
          const target = path.join(this.#conversationsRoot, entry.name);
          if (isPathWithinRootLexically(target, this.#conversationsRoot))
            await rm(target, { recursive: true, force: true });
        }),
    );
  }

  async #validateModelManifest(): Promise<boolean> {
    const markerPath = path.join(this.#modelsRoot, MODEL_MARKER);
    try {
      const value = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
      if (value.id !== MODEL_ID || value.version !== MODEL_VERSION || !Array.isArray(value.files))
        return false;
      const files = value.files as Array<Record<string, unknown>>;
      if (files.length === 0) return false;
      for (const file of files) {
        if (
          typeof file.path !== "string" ||
          typeof file.size !== "number" ||
          typeof file.sha256 !== "string"
        )
          return false;
        const absolute = path.resolve(this.#modelsRoot, file.path);
        if (!isPathWithinRootLexically(absolute, this.#modelsRoot)) return false;
        const metadata = await stat(absolute).catch(() => null);
        if (!metadata?.isFile() || metadata.size !== file.size) return false;
        if ((await this.#hashFile(absolute)) !== file.sha256) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async #removeModelMarkerForGeneration(generation: number): Promise<void> {
    const markerPath = path.join(this.#modelsRoot, MODEL_MARKER);
    const marker = await readFile(markerPath, "utf8")
      .then((value) => JSON.parse(value) as Record<string, unknown>)
      .catch(() => null);
    if (marker?.generation === generation) await rm(markerPath, { force: true });
  }

  #failModelDownload(message: string, worker: Worker, generation: number): void {
    if (this.#modelWorker !== worker || this.#modelDownloadGeneration !== generation) return;
    this.#modelWorker = null;
    this.#modelState = {
      ...this.#modelState,
      status: "error",
      progress: null,
      message,
    };
    this.#emitModel(this.getLocalModelState());
  }
}
