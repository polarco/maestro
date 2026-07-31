import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatWorkspaceResearch,
  inspectWorkspaceForResearch,
} from "../src/main/services/workspace-research.js";

describe("workspace research", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("reads relevant safe sources while honoring ignores, secrets and symlink boundaries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-workspace-research-"));
    directories.push(directory);
    const root = path.join(directory, "workspace");
    const outside = path.join(directory, "outside.md");
    await Promise.all([
      mkdir(path.join(root, "src", "composer"), { recursive: true }),
      mkdir(path.join(root, "ignored"), { recursive: true }),
      mkdir(path.join(root, "node_modules", "fixture"), { recursive: true }),
      mkdir(path.join(root, "docs", "private"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8"),
      writeFile(path.join(root, "docs", ".gitignore"), "private/\n", "utf8"),
      writeFile(path.join(root, "README.md"), "# Produto\nEditor colaborativo", "utf8"),
      writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: "fixture", scripts: { test: "vitest" } }),
        "utf8",
      ),
      writeFile(
        path.join(root, "src", "composer", "workflow.ts"),
        "export const collaborativeComposer = true;",
        "utf8",
      ),
      writeFile(path.join(root, "ignored", "hidden.md"), "não pode aparecer", "utf8"),
      writeFile(path.join(root, "docs", "private", "notes.md"), "privado", "utf8"),
      writeFile(path.join(root, "node_modules", "fixture", "index.js"), "ignored", "utf8"),
      writeFile(path.join(root, ".env"), "TOKEN=never-read", "utf8"),
      writeFile(path.join(root, "private-key.pem"), "never-read", "utf8"),
      writeFile(outside, "fora da raiz", "utf8"),
    ]);
    const linked = await symlink(outside, path.join(root, "outside-link.md"))
      .then(() => true)
      .catch(() => false);

    const snapshot = await inspectWorkspaceForResearch(root, "melhorar composer colaborativo");
    const mapped = snapshot.tree.join("\n");
    const sources = snapshot.sources.map((source) => source.path);
    const excerpts = snapshot.sources.map((source) => source.excerpt).join("\n");

    expect(sources).toEqual(
      expect.arrayContaining(["README.md", "package.json", "src/composer/workflow.ts"]),
    );
    expect(mapped).not.toContain("ignored/");
    expect(mapped).not.toContain("docs/private");
    expect(mapped).not.toContain("node_modules");
    expect(mapped).not.toContain(".env");
    expect(mapped).not.toContain("private-key.pem");
    if (linked) expect(mapped).not.toContain("outside-link.md");
    expect(excerpts).not.toContain("never-read");
    expect(formatWorkspaceResearch(snapshot)).toContain(
      '<workspace_source path="src/composer/workflow.ts">',
    );
  });

  it("skips oversized text files instead of loading them as research sources", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maestro-workspace-research-size-"));
    directories.push(directory);
    await writeFile(path.join(directory, "README.md"), "x".repeat(1024 * 1024 + 1), "utf8");

    const snapshot = await inspectWorkspaceForResearch(directory, "readme");

    expect(snapshot.tree).toContain("[file] README.md");
    expect(snapshot.sources).toEqual([]);
  });
});
