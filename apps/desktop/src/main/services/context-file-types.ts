import path from "node:path";
import type { ContextAssetKind } from "@maestro/contracts";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".rtf": "application/rtf",
  ".epub": "application/epub+zip",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".kt": "text/x-kotlin",
  ".swift": "text/x-swift",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++",
  ".hpp": "text/x-c++",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".sql": "application/sql",
  ".sh": "application/x-sh",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".env": "text/plain",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
};

const DOCUMENT_EXTENSIONS = new Set([
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
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".avif",
]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".flac",
  ".opus",
]);
const VIDEO_EXTENSIONS = new Set([".webm", ".mp4", ".mov", ".mkv", ".avi", ".m4v"]);

export const MAX_CONTEXT_ITEMS = 20;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_AGGREGATE_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_FOLDER_FILES = 500;
export const MAX_FOLDER_BYTES = 250 * 1024 * 1024;

function fileExtension(filename: string): string {
  const basename = path.basename(filename).toLowerCase();
  return basename === ".env" ? ".env" : path.extname(basename);
}

export function mimeTypeForFile(filename: string): string {
  return MIME_TYPES[fileExtension(filename)] ?? "application/octet-stream";
}

export function contextKindForFile(filename: string, mimeType?: string): ContextAssetKind {
  const extension = fileExtension(filename);
  const mime = mimeType ?? mimeTypeForFile(filename);
  if (mimeType) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
  }
  if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) return "image";
  if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith("audio/")) return "audio";
  if (VIDEO_EXTENSIONS.has(extension) || mime.startsWith("video/")) return "video";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (mime.startsWith("text/") || MIME_TYPES[extension]) return "text";
  return "unknown";
}

export function isEligibleContextFile(filename: string): boolean {
  return contextKindForFile(filename) !== "unknown";
}

export function contextSizeLimit(kind: ContextAssetKind): number {
  return kind === "audio" || kind === "video" ? MAX_MEDIA_BYTES : MAX_DOCUMENT_BYTES;
}
