import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { protocol } from "electron";
import type { ContextService } from "./context-service.js";

function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  const rawStart = match[1] ? Number(match[1]) : null;
  const rawEnd = match[2] ? Number(match[2]) : null;
  if (rawStart === null && rawEnd === null) return null;
  let start = rawStart ?? Math.max(0, size - rawEnd!);
  let end = rawEnd ?? size - 1;
  start = Math.max(0, Math.min(start, size - 1));
  end = Math.max(start, Math.min(end, size - 1));
  return { start, end };
}

export function registerAttachmentProtocol(context: ContextService): void {
  protocol.handle("maestro-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const [conversationId, assetId, ...rest] = url.pathname
        .split("/")
        .filter(Boolean)
        .map((value) => decodeURIComponent(value));
      if (url.hostname !== "asset" || !conversationId || !assetId || rest.length > 0)
        return new Response("Preview inválido.", { status: 400 });
      const target = await context.previewTarget(
        conversationId,
        assetId,
        url.searchParams.get("thumbnail") === "1",
      );
      const metadata = await stat(target.path);
      const range = byteRange(request.headers.get("range"), metadata.size);
      const start = range?.start ?? 0;
      const end = range?.end ?? metadata.size - 1;
      const stream = Readable.toWeb(createReadStream(target.path, { start, end }));
      const headers = new Headers({
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=60",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(target.name)}`,
        "content-length": String(Math.max(0, end - start + 1)),
        "content-type": target.mimeType,
        "x-content-type-options": "nosniff",
      });
      if (range) headers.set("content-range", `bytes ${start}-${end}/${metadata.size}`);
      return new Response(stream as unknown as BodyInit, {
        status: range ? 206 : 200,
        headers,
      });
    } catch {
      return new Response("Preview indisponível.", { status: 404 });
    }
  });
}

export function unregisterAttachmentProtocol(): void {
  protocol.unhandle("maestro-attachment");
}
