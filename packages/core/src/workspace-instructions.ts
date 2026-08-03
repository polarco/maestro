import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { assertPathWithinRoots } from "./path-policy.js";

export interface WorkspaceInstructionFile {
  path: string;
  scope: string;
  content: string;
  truncated: boolean;
}

function ancestors(root: string, cwd: string): string[] {
  const values: string[] = [];
  let cursor = cwd;
  while (true) {
    values.unshift(cursor);
    if (cursor === root) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return values;
}

/** Loads only explicitly trusted durable-instruction filenames. */
export async function loadWorkspaceInstructions(
  workspaceRoot: string,
  cwd = workspaceRoot,
  options: { maxBytesPerFile?: number; includeOverride?: boolean } = {},
): Promise<WorkspaceInstructionFile[]> {
  const root = await realpath(path.resolve(workspaceRoot));
  const current = await assertPathWithinRoots(cwd, [root]);
  const maximum = Math.max(1_024, options.maxBytesPerFile ?? 32_768);
  const names =
    options.includeOverride === false ? ["AGENTS.md"] : ["AGENTS.md", "AGENTS.override.md"];
  const files: WorkspaceInstructionFile[] = [];
  for (const directory of ancestors(root, current)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      const metadata = await lstat(candidate).catch(() => null);
      if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
      const canonical = await assertPathWithinRoots(candidate, [root]);
      const bytes = await readFile(canonical);
      files.push({
        path: canonical,
        scope: path.relative(root, directory) || ".",
        content: bytes.subarray(0, maximum).toString("utf8"),
        truncated: bytes.byteLength > maximum,
      });
    }
  }
  return files;
}

export function formatWorkspaceInstructions(files: readonly WorkspaceInstructionFile[]): string {
  if (files.length === 0) return "";
  return [
    '<workspace_instructions trust="durable-project-guidance">',
    ...files.map((file) =>
      [
        `<instruction_file path=${JSON.stringify(file.path)} scope=${JSON.stringify(file.scope)} truncated=${JSON.stringify(file.truncated)}>`,
        file.content,
        "</instruction_file>",
      ].join("\n"),
    ),
    "</workspace_instructions>",
  ].join("\n");
}

export function wrapUntrustedWorkspaceData(label: string, content: string): string {
  return [
    `<workspace_data trust="untrusted" label=${JSON.stringify(label)}>`,
    content,
    "</workspace_data>",
  ].join("\n");
}
