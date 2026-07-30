export interface ContextWorkerChunk {
  content: string;
  tokenCount: number;
}

export interface ContextWorkerResult {
  extractedText: string;
  chunks: ContextWorkerChunk[];
  transcription: string | null;
  durationMs: number | null;
  pageCount: number | null;
  framePaths: string[];
  metadata: Record<string, unknown>;
  warning: string | null;
}

export type ContextWorkerRequest =
  | {
      type: "extract";
      assetKind: "document" | "text" | "audio" | "video" | "folder";
      inputPath: string;
      outputDirectory: string;
      mimeType: string;
      modelsDirectory: string;
      ffmpegPath: string;
      allowRemoteModels: boolean;
      folderEntries?: string[];
    }
  | {
      type: "warm-model";
      modelsDirectory: string;
    };

export type ContextWorkerMessage =
  | { type: "progress"; stage: string; progress: number | null; message: string }
  | { type: "result"; result: ContextWorkerResult }
  | { type: "model-ready" }
  | { type: "error"; message: string; code?: string };
