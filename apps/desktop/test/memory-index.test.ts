import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MemoryRecord } from "@maestro/contracts";
import { MemoryIndexService } from "../src/main/services/memory-index.js";

function memory(id: string, content: string): MemoryRecord {
  const timestamp = new Date().toISOString();
  return {
    id,
    projectId: "project-1",
    scope: "project",
    kind: "fact",
    content,
    provenance: {
      sessionId: "session-1",
      turnId: "turn-1",
      messageId: "message-1",
      source: "user",
      excerpt: content,
    },
    confidence: 1,
    state: "accepted",
    expiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function vector(value: string): number[] {
  if (/auth|autentica/i.test(value)) return [1, 0];
  if (/design|visual/i.test(value)) return [0, 1];
  return [0.5, 0.5];
}

describe("MemoryIndexService", () => {
  it("ranks multilingual memories locally and reuses its persisted vector index", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-memory-index-"));
    const values = [
      memory("memory-auth", "A autenticação usa passkeys"),
      memory("memory-design", "O design usa vermelho"),
    ];
    const firstEmbedder = vi.fn((inputs: string[]) =>
      Promise.resolve(inputs.map((input) => vector(input))),
    );
    const first = new MemoryIndexService({
      userDataDirectory: directory,
      embedder: firstEmbedder,
    });
    await expect(first.rank(values, "authentication", 2)).resolves.toEqual([values[0], values[1]]);
    expect(firstEmbedder).toHaveBeenCalledWith([
      "passage: A autenticação usa passkeys",
      "passage: O design usa vermelho",
    ]);

    const secondEmbedder = vi.fn((inputs: string[]) =>
      Promise.resolve(inputs.map((input) => vector(input))),
    );
    const second = new MemoryIndexService({
      userDataDirectory: directory,
      embedder: secondEmbedder,
    });
    await second.rank(values, "visual design", 1);
    expect(secondEmbedder).toHaveBeenCalledTimes(1);
    expect(secondEmbedder).toHaveBeenCalledWith(["query: visual design"]);

    await second.remove(["memory-auth"]);
    const persisted = JSON.parse(
      await readFile(path.join(directory, "memory-index", "multilingual-e5-small.json"), "utf8"),
    ) as { records: Record<string, unknown> };
    expect(persisted.records).not.toHaveProperty("memory-auth");
  });
});
