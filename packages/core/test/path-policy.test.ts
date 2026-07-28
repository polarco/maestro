import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertPathWithinRoots, canonicalizeDirectory } from "../src/path-policy.js";

describe("workspace path policy", () => {
  it("accepts existing and future paths inside the selected root", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "maestro-path-"));
    const root = path.join(base, "root");
    await mkdir(root);
    await writeFile(path.join(root, "file.txt"), "ok");
    const canonical = await canonicalizeDirectory(root);
    await expect(
      assertPathWithinRoots(path.join(root, "file.txt"), [canonical]),
    ).resolves.toContain("file.txt");
    await expect(
      assertPathWithinRoots(path.join(root, "new", "file.ts"), [canonical], { allowMissing: true }),
    ).resolves.toContain(path.join("new", "file.ts"));
  });

  it("blocks lexical traversal and symlink escapes", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "maestro-path-"));
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret"), "nope");
    await symlink(outside, path.join(root, "link"), "dir");
    const canonical = await canonicalizeDirectory(root);
    await expect(
      assertPathWithinRoots(path.join(root, "..", "outside", "secret"), [canonical]),
    ).rejects.toThrow("fora das raízes");
    await expect(
      assertPathWithinRoots(path.join(root, "link", "secret"), [canonical]),
    ).rejects.toThrow("fora das raízes");
  });
});
