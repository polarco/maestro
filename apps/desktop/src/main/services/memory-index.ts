import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { MemoryRecord } from "@maestro/contracts";

const MODEL_ID = "Xenova/multilingual-e5-small";
const INDEX_VERSION = 1;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;

const persistedIndexSchema = z
  .object({
    version: z.literal(INDEX_VERSION),
    model: z.literal(MODEL_ID),
    records: z.record(
      z.string(),
      z
        .object({
          hash: z.string().length(64),
          vector: z.array(z.number().finite()).min(1).max(1_024),
        })
        .strict(),
    ),
  })
  .strict();

type Embedder = (values: string[]) => Promise<number[][]>;
type IndexRecord = z.infer<typeof persistedIndexSchema>["records"][string];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dot(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let value = 0;
  for (let index = 0; index < length; index += 1) value += left[index]! * right[index]!;
  return value;
}

/** Optional local semantic memory index. It never downloads a model or contacts the network. */
export class MemoryIndexService {
  readonly #indexPath: string;
  readonly #modelsDirectory: string;
  readonly #providedEmbedder: Embedder | null;
  #embedder: Promise<Embedder | null> | null = null;
  #loaded = false;
  #unavailable = false;
  #records = new Map<string, IndexRecord>();
  #operationTail: Promise<void> = Promise.resolve();

  constructor(input: { userDataDirectory: string; embedder?: Embedder }) {
    const directory = path.join(input.userDataDirectory, "memory-index");
    this.#indexPath = path.join(directory, "multilingual-e5-small.json");
    this.#modelsDirectory = path.join(input.userDataDirectory, "models", "memory-e5");
    this.#providedEmbedder = input.embedder ?? null;
  }

  async rank(
    memories: readonly MemoryRecord[],
    query: string,
    limit = 40,
  ): Promise<MemoryRecord[] | null> {
    return this.#exclusive(async () => {
      if (this.#unavailable || !query.trim() || memories.length === 0) return null;
      const embed = await this.#getEmbedder();
      if (!embed) return null;
      await this.#load();
      const candidates = memories.slice(0, 200);
      const missing = candidates.filter((memory) => {
        const record = this.#records.get(memory.id);
        return !record || record.hash !== hash(memory.content);
      });
      if (missing.length > 0) {
        const vectors = await embed(missing.map((memory) => `passage: ${memory.content}`));
        missing.forEach((memory, index) => {
          const vector = vectors[index];
          if (vector?.length)
            this.#records.set(memory.id, { hash: hash(memory.content), vector: [...vector] });
        });
        await this.#save().catch(() => undefined);
      }
      const [queryVector] = await embed([`query: ${query.trim()}`]);
      if (!queryVector?.length) return null;
      return candidates
        .map((memory) => ({
          memory,
          score: dot(queryVector, this.#records.get(memory.id)?.vector ?? []),
        }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(1, Math.min(limit, 200)))
        .map((item) => item.memory);
    });
  }

  async remove(memoryIds: readonly string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.#exclusive(async () => {
      await this.#load();
      for (const memoryId of memoryIds) this.#records.delete(memoryId);
      await this.#save();
    });
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release = () => {};
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #getEmbedder(): Promise<Embedder | null> {
    if (this.#providedEmbedder) return this.#providedEmbedder;
    if (this.#embedder) return this.#embedder;
    this.#embedder = (async () => {
      try {
        const { pipeline } = await import("@huggingface/transformers");
        const extractor = await pipeline("feature-extraction", MODEL_ID, {
          cache_dir: this.#modelsDirectory,
          local_files_only: true,
          dtype: "q8",
        });
        return async (values: string[]) => {
          const output = await extractor(values, { pooling: "mean", normalize: true });
          return output.tolist() as number[][];
        };
      } catch {
        this.#unavailable = true;
        return null;
      }
    })();
    return this.#embedder;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const metadata = await stat(this.#indexPath);
      if (!metadata.isFile() || metadata.size > MAX_INDEX_BYTES) return;
      const parsed = persistedIndexSchema.parse(
        JSON.parse(await readFile(this.#indexPath, "utf8")),
      );
      this.#records = new Map(Object.entries(parsed.records));
    } catch {
      this.#records.clear();
    }
  }

  async #save(): Promise<void> {
    const directory = path.dirname(this.#indexPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#indexPath}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        version: INDEX_VERSION,
        model: MODEL_ID,
        records: Object.fromEntries(this.#records),
      }),
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporary, this.#indexPath);
  }
}
