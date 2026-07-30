import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaestroRepository } from "@maestro/database";
import {
  searchIndexedCandidates,
  type IndexedCandidate,
  WorkspaceContextIndex,
} from "../src/main/services/workspace-context-index.js";

describe("WorkspaceContextIndex", () => {
  let directory: string;
  let database: MaestroRepository;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "maestro-context-index-"));
    database = new MaestroRepository(path.join(directory, "maestro.db"));
  });

  afterEach(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("searches every root while honoring gitignore, build exclusions and symlinks", async () => {
    const firstRoot = path.join(directory, "first");
    const secondRoot = path.join(directory, "second");
    const outside = path.join(directory, "outside.txt");
    await Promise.all([
      mkdir(path.join(firstRoot, "src"), { recursive: true }),
      mkdir(path.join(firstRoot, "ignored"), { recursive: true }),
      mkdir(path.join(firstRoot, "node_modules", "package"), { recursive: true }),
      mkdir(path.join(secondRoot, "docs"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(firstRoot, ".gitignore"), "ignored/\n*.secret\n!node_modules/\n", "utf8"),
      writeFile(path.join(firstRoot, "src", "main.ts"), "export {};\n", "utf8"),
      writeFile(path.join(firstRoot, "ignored", "hidden.md"), "hidden\n", "utf8"),
      writeFile(path.join(firstRoot, "token.secret"), "hidden\n", "utf8"),
      writeFile(path.join(firstRoot, "node_modules", "package", "index.js"), "hidden\n", "utf8"),
      writeFile(path.join(secondRoot, "docs", "manual.md"), "manual\n", "utf8"),
      writeFile(outside, "outside\n", "utf8"),
    ]);
    const symlinkCreated = await symlink(outside, path.join(firstRoot, "outside-link.txt"))
      .then(() => true)
      .catch(() => false);

    const project = await database.createProject({
      name: "Busca",
      path: firstRoot,
      canonicalPath: firstRoot,
      displayName: "first",
    });
    await database.addWorkspaceRoot(project.id, {
      path: secondRoot,
      canonicalPath: secondRoot,
      displayName: "second",
    });
    const index = new WorkspaceContextIndex(database);
    const all = await index.search(project.id, "", 100);

    expect(all.map((item) => item.relativePath)).toEqual(
      expect.arrayContaining(["src", "src/main.ts", "docs", "docs/manual.md"]),
    );
    const indexedPaths = all.map((item) => item.relativePath);
    expect(indexedPaths).not.toEqual(
      expect.arrayContaining(["ignored", "ignored/hidden.md", "token.secret", "node_modules"]),
    );
    if (symlinkCreated) expect(indexedPaths).not.toContain("outside-link.txt");
    expect((await index.search(project.id, "manl", 10))[0]).toMatchObject({
      rootName: "second",
      relativePath: "docs/manual.md",
      kind: "file",
    });
  });

  it("keeps a warmed fuzzy search below 150 ms for 50 thousand paths", () => {
    const entries: IndexedCandidate[] = Array.from({ length: 50_000 }, (_, index) => {
      const name = index === 42_424 ? "needle-target.md" : `file-${index}.md`;
      const relativePath = `src/group-${index % 250}/${name}`;
      return {
        id: `root:${relativePath}`,
        projectId: "project",
        workspaceRootId: "root",
        rootName: "workspace",
        relativePath,
        name,
        kind: "file",
        mimeType: "text/markdown",
        size: null,
        searchable: `${name} ${relativePath} workspace`.toLowerCase(),
      };
    });
    const startedAt = performance.now();
    const result = searchIndexedCandidates(entries, "needle-target", 12);
    const elapsed = performance.now() - startedAt;

    expect(result[0]?.name).toBe("needle-target.md");
    expect(elapsed).toBeLessThan(150);
  });
});
