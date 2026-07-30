import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { env, pipeline } from "@huggingface/transformers";
import { OfficeParser } from "officeparser";
import type {
  ContextWorkerChunk,
  ContextWorkerMessage,
  ContextWorkerRequest,
  ContextWorkerResult,
} from "./services/context-worker-protocol.js";

const request = workerData as ContextWorkerRequest;
const port = parentPort;
if (!port) throw new Error("Context worker requires a parent port.");

function post(message: ContextWorkerMessage): void {
  port!.postMessage(message);
}

function progress(stage: string, value: number | null, message: string): void {
  post({ type: "progress", stage, progress: value, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunksFromText(text: string, targetCharacters = 6_000): ContextWorkerChunk[] {
  const normalized = text.replaceAll("\u0000", "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > targetCharacters) {
      chunks.push(current.trim());
      current = "";
    }
    if (paragraph.length > targetCharacters) {
      if (current) chunks.push(current.trim());
      current = "";
      for (let offset = 0; offset < paragraph.length; offset += targetCharacters - 500) {
        chunks.push(paragraph.slice(offset, offset + targetCharacters).trim());
      }
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean).map((content) => ({
    content,
    tokenCount: Math.max(1, Math.ceil(content.length / 4)),
  }));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function officeText(inputPath: string): Promise<{
  text: string;
  chunks: ContextWorkerChunk[];
  pageCount: number | null;
  metadata: Record<string, unknown>;
}> {
  const ast = await OfficeParser.parseOffice(inputPath, {
    extractAttachments: false,
    ocr: false,
    ignoreSlideMasters: true,
  });
  const output = await ast.to("text");
  const text = typeof output.value === "string" ? output.value : "";
  const metadata = record(ast.metadata);
  const pageCount =
    numeric(metadata.pageCount) ??
    numeric(metadata.pages) ??
    numeric(metadata.slideCount) ??
    numeric(metadata.sheetCount);
  return { text, chunks: chunksFromText(text), pageCount, metadata };
}

async function renderPdfPages(
  inputPath: string,
  outputDirectory: string,
): Promise<{ paths: string[]; pageCount: number }> {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await readFile(inputPath));
  const document = await pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
  }).promise;
  const selected = Array.from(
    new Set(
      Array.from({ length: Math.min(12, document.numPages) }, (_, index) =>
        document.numPages <= 12
          ? index + 1
          : Math.round(1 + (index * (document.numPages - 1)) / 11),
      ),
    ),
  );
  const paths: string[] = [];
  for (const [index, pageNumber] of selected.entries()) {
    progress(
      "extracting",
      0.2 + (index / Math.max(1, selected.length)) * 0.45,
      `Renderizando página ${pageNumber} de ${document.numPages}…`,
    );
    const page = await document.getPage(pageNumber);
    const initial = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1_440 / Math.max(initial.width, initial.height));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as never,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const destination = path.join(
      outputDirectory,
      `pdf-page-${String(pageNumber).padStart(3, "0")}.jpg`,
    );
    await writeFile(destination, canvas.toBuffer("image/jpeg"));
    paths.push(destination);
    page.cleanup();
  }
  const pageCount = document.numPages;
  await (document as unknown as { destroy: () => Promise<void> }).destroy();
  return { paths, pageCount };
}

function supportedTextExtension(filename: string): boolean {
  return new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".csv",
    ".tsv",
    ".log",
    ".xml",
    ".css",
    ".scss",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".sql",
    ".sh",
    ".toml",
    ".ini",
    ".env",
  ]).has(
    path.basename(filename).toLowerCase() === ".env"
      ? ".env"
      : path.extname(filename).toLowerCase(),
  );
}

function supportedDocumentExtension(filename: string): boolean {
  return new Set([
    ".pdf",
    ".docx",
    ".xlsx",
    ".pptx",
    ".odt",
    ".ods",
    ".odp",
    ".rtf",
    ".epub",
    ".html",
    ".htm",
  ]).has(path.extname(filename).toLowerCase());
}

function supportedImageExtension(filename: string): boolean {
  return new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".avif"]).has(
    path.extname(filename).toLowerCase(),
  );
}

function supportedMediaExtension(filename: string): boolean {
  return new Set([
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".ogg",
    ".oga",
    ".flac",
    ".opus",
    ".webm",
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".m4v",
  ]).has(path.extname(filename).toLowerCase());
}

async function folderText(
  directory: string,
  relativePaths: readonly string[],
): Promise<{
  text: string;
  metadata: Record<string, unknown>;
  framePaths: string[];
  warning: string | null;
}> {
  const sections: string[] = [];
  let visited = 0;
  let skippedMedia = 0;
  let scannedPdfs = 0;
  const framePaths: string[] = [];
  for (const relative of [...relativePaths].sort((left, right) => left.localeCompare(right))) {
    if (visited >= 500 || sections.join("\n").length >= 12_000_000) break;
    if (path.isAbsolute(relative)) continue;
    const absolute = path.resolve(directory, relative);
    const contained = path.relative(directory, absolute);
    if (contained === ".." || contained.startsWith(`..${path.sep}`) || path.isAbsolute(contained))
      continue;
    try {
      if (supportedImageExtension(relative)) {
        if (framePaths.length < 12) framePaths.push(absolute);
        sections.push(`--- ${relative} ---\n[imagem incluída como contexto visual]`);
      } else if (supportedMediaExtension(relative)) {
        skippedMedia += 1;
        sections.push(
          `--- ${relative} ---\n[mídia não transcrita dentro da pasta; anexe o arquivo individualmente]`,
        );
      } else {
        let text = "";
        if (supportedTextExtension(relative)) text = await readFile(absolute, "utf8");
        else if (supportedDocumentExtension(relative)) {
          text = (await officeText(absolute)).text;
          if (path.extname(relative).toLowerCase() === ".pdf" && text.trim().length < 120)
            scannedPdfs += 1;
        } else continue;
        sections.push(`--- ${relative} ---\n${text}`);
      }
      visited += 1;
      progress("extracting", null, `Extraindo ${relative}…`);
    } catch (error) {
      sections.push(`--- ${relative} ---\n[falha ao extrair: ${errorMessage(error)}]`);
      visited += 1;
    }
  }
  const warnings = [
    skippedMedia > 0
      ? `${skippedMedia} arquivo(s) de áudio/vídeo da pasta foram omitidos; anexe-os individualmente para transcrever.`
      : null,
    scannedPdfs > 0
      ? `${scannedPdfs} PDF(s) sem texto da pasta foram omitidos do contexto visual; anexe-os individualmente.`
      : null,
  ].filter((value): value is string => Boolean(value));
  return {
    text: sections.join("\n\n"),
    metadata: {
      fileCount: visited,
      imageCount: framePaths.length,
      skippedMedia,
      scannedPdfs,
    },
    framePaths,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

async function runFfmpeg(
  executable: string,
  args: string[],
  stage: "transcoding" | "extracting",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-hide_banner", "-nostdin", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64_000);
      progress(stage, null, stage === "transcoding" ? "Convertendo mídia…" : "Extraindo quadros…");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stderr);
      else
        reject(
          new Error(
            `FFmpeg encerrou com código ${code ?? "desconhecido"}: ${stderr.slice(-2_000)}`,
          ),
        );
    });
  });
}

function durationFromFfmpeg(output: string): number | null {
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  return Math.round((Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000);
}

async function probeMedia(executable: string, inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-hide_banner", "-nostdin", "-i", inputPath], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-64_000);
    });
    child.once("error", reject);
    child.once("exit", () => resolve(stderr));
  });
}

function wavSamples(bytes: Buffer): Float32Array {
  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "data") {
      dataStart = offset + 8;
      dataSize = Math.min(size, bytes.length - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error("Arquivo WAV convertido não contém bloco de áudio.");
  const samples = new Float32Array(Math.floor(dataSize / 2));
  for (let index = 0; index < samples.length; index += 1)
    samples[index] = bytes.readInt16LE(dataStart + index * 2) / 32_768;
  return samples;
}

async function createTranscriber(modelsDirectory: string, allowRemoteModels: boolean) {
  env.cacheDir = modelsDirectory;
  env.allowRemoteModels = allowRemoteModels;
  env.allowLocalModels = true;
  return pipeline("automatic-speech-recognition", "onnx-community/whisper-small", {
    dtype: "q4",
    progress_callback: (value: unknown) => {
      const item = record(value);
      const raw = numeric(item.progress);
      progress(
        "transcribing",
        raw === null ? null : Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)),
        allowRemoteModels ? "Baixando o pacote de transcrição…" : "Carregando o modelo local…",
      );
    },
  });
}

async function transcribe(
  inputPath: string,
  outputDirectory: string,
  modelsDirectory: string,
  ffmpegPath: string,
  allowRemoteModels: boolean,
): Promise<{ text: string; durationMs: number | null }> {
  const wavPath = path.join(outputDirectory, "audio-16khz.wav");
  const ffmpegOutput = await runFfmpeg(
    ffmpegPath,
    ["-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath],
    "transcoding",
  );
  const transcriber = await createTranscriber(modelsDirectory, allowRemoteModels);
  progress("transcribing", null, "Transcrevendo localmente…");
  const output = record(
    await transcriber(wavSamples(await readFile(wavPath)), {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      task: "transcribe",
    }),
  );
  return {
    text: typeof output.text === "string" ? output.text.trim() : "",
    durationMs: durationFromFfmpeg(ffmpegOutput),
  };
}

async function videoFrames(
  inputPath: string,
  outputDirectory: string,
  ffmpegPath: string,
  durationMs: number | null,
): Promise<string[]> {
  const pattern = path.join(outputDirectory, "video-frame-%02d.jpg");
  const intervalSeconds = Math.max(0.25, (durationMs ?? 360_000) / 1_000 / 12);
  await runFfmpeg(
    ffmpegPath,
    [
      "-i",
      inputPath,
      "-vf",
      `fps=1/${intervalSeconds.toFixed(3)},scale='min(1280,iw)':-2`,
      "-frames:v",
      "12",
      "-q:v",
      "3",
      pattern,
    ],
    "extracting",
  );
  return (await readdir(outputDirectory))
    .filter((name) => /^video-frame-\d+\.jpg$/.test(name))
    .sort()
    .map((name) => path.join(outputDirectory, name));
}

async function extract(
  value: Extract<ContextWorkerRequest, { type: "extract" }>,
): Promise<ContextWorkerResult> {
  progress("extracting", 0.05, "Preparando extração local…");
  let extractedText = "";
  let chunks: ContextWorkerChunk[] = [];
  let transcription: string | null = null;
  let durationMs: number | null = null;
  let pageCount: number | null = null;
  let framePaths: string[] = [];
  let metadata: Record<string, unknown> = {};
  let warning: string | null = null;

  if (value.assetKind === "text") {
    extractedText = (await readFile(value.inputPath, "utf8")).slice(0, 20_000_000);
    chunks = chunksFromText(extractedText);
  } else if (value.assetKind === "document") {
    const parsed = await officeText(value.inputPath);
    extractedText = parsed.text;
    chunks = parsed.chunks;
    pageCount = parsed.pageCount;
    metadata = parsed.metadata;
    if (
      path.extname(value.inputPath).toLowerCase() === ".pdf" &&
      extractedText.trim().length < 120
    ) {
      const rendered = await renderPdfPages(value.inputPath, value.outputDirectory);
      framePaths = rendered.paths;
      pageCount = rendered.pageCount;
      warning =
        "PDF sem camada de texto; páginas representativas serão enviadas a um modelo com visão.";
      metadata = { ...metadata, scannedPdf: true };
    }
  } else if (value.assetKind === "folder") {
    const parsed = await folderText(value.inputPath, value.folderEntries ?? []);
    extractedText = parsed.text;
    chunks = chunksFromText(extractedText);
    metadata = parsed.metadata;
    framePaths = parsed.framePaths;
    warning = parsed.warning;
  } else if (value.assetKind === "audio") {
    const result = await transcribe(
      value.inputPath,
      value.outputDirectory,
      value.modelsDirectory,
      value.ffmpegPath,
      value.allowRemoteModels,
    );
    transcription = result.text;
    extractedText = result.text;
    durationMs = result.durationMs;
    chunks = chunksFromText(result.text);
  } else if (value.assetKind === "video") {
    const probe = await probeMedia(value.ffmpegPath, value.inputPath);
    durationMs = durationFromFfmpeg(probe);
    if (/Stream #.*Audio:/i.test(probe)) {
      const result = await transcribe(
        value.inputPath,
        value.outputDirectory,
        value.modelsDirectory,
        value.ffmpegPath,
        value.allowRemoteModels,
      );
      transcription = result.text;
      extractedText = result.text;
      durationMs = result.durationMs ?? durationMs;
      chunks = chunksFromText(result.text);
    } else {
      transcription = "";
      warning = "Vídeo sem faixa de áudio; somente os quadros representativos estão disponíveis.";
    }
    framePaths = await videoFrames(
      value.inputPath,
      value.outputDirectory,
      value.ffmpegPath,
      durationMs,
    );
  }
  progress("indexing", 0.95, "Indexando contexto…");
  return {
    extractedText,
    chunks,
    transcription,
    durationMs,
    pageCount,
    framePaths,
    metadata,
    warning,
  };
}

async function run(): Promise<void> {
  if (request.type === "warm-model") {
    await createTranscriber(request.modelsDirectory, true);
    post({ type: "model-ready" });
    return;
  }
  post({ type: "result", result: await extract(request) });
}

void run().catch((error: unknown) =>
  post({
    type: "error",
    message: errorMessage(error),
    ...(error instanceof Error && "code" in error && typeof error.code === "string"
      ? { code: error.code }
      : {}),
  }),
);
