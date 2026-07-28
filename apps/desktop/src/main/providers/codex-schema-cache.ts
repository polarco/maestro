import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProcessSupervisor } from "../services/process-supervisor.js";

export class CodexSchemaCache {
  readonly #directory: string;
  readonly #supervisor: ProcessSupervisor;

  constructor(userDataDirectory: string, supervisor: ProcessSupervisor) {
    this.#directory = path.join(userDataDirectory, "provider-schemas", "codex");
    this.#supervisor = supervisor;
  }

  async ensure(version: string, executable = "codex"): Promise<string | null> {
    const marker = path.join(this.#directory, ".version");
    const current = await readFile(marker, "utf8").catch(() => null);
    if (current?.trim() === version.trim()) return this.#directory;
    await rm(this.#directory, { recursive: true, force: true });
    await mkdir(this.#directory, { recursive: true });
    const result = await this.#supervisor
      .capture(
        {
          executable,
          args: ["app-server", "generate-json-schema", "--out", this.#directory],
          label: "Codex schema generator",
        },
        { timeoutMs: 30_000, maxOutputBytes: 512_000 },
      )
      .catch(() => null);
    if (!result || result.exitCode !== 0) {
      await rm(this.#directory, { recursive: true, force: true });
      return null;
    }
    await writeFile(marker, `${version.trim()}\n`, "utf8");
    return this.#directory;
  }
}
