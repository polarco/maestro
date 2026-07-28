import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { MaestroError } from "./errors.js";

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export async function canonicalizeDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  const metadata = await stat(resolved).catch(() => null);
  if (!metadata?.isDirectory()) {
    throw new MaestroError("INVALID_WORKSPACE_ROOT", `A pasta não existe: ${directory}`);
  }
  return realpath(resolved);
}

async function canonicalizePossiblyMissing(candidate: string): Promise<string> {
  let cursor = path.resolve(candidate);
  const suffix: string[] = [];

  while (true) {
    const metadata = await lstat(cursor).catch(() => null);
    if (metadata) {
      const base = await realpath(cursor);
      return path.join(base, ...suffix.reverse());
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new MaestroError(
        "PATH_NOT_RESOLVABLE",
        `Não foi possível resolver o path: ${candidate}`,
      );
    }
    suffix.push(path.basename(cursor));
    cursor = parent;
  }
}

export async function assertPathWithinRoots(
  candidate: string,
  canonicalRoots: readonly string[],
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  if (canonicalRoots.length === 0) {
    throw new MaestroError("NO_WORKSPACE_ROOT", "Nenhuma raiz de workspace foi autorizada.");
  }

  const normalizedRoots = await Promise.all(
    canonicalRoots.map((root) => realpath(path.resolve(root))),
  );
  const resolvedCandidate = options.allowMissing
    ? await canonicalizePossiblyMissing(candidate)
    : await realpath(path.resolve(candidate)).catch(() => {
        throw new MaestroError("PATH_NOT_FOUND", `Path não encontrado: ${candidate}`);
      });

  if (!normalizedRoots.some((root) => isContained(root, resolvedCandidate))) {
    throw new MaestroError(
      "PATH_OUTSIDE_WORKSPACE",
      `Acesso fora das raízes autorizadas: ${candidate}`,
      {
        detail: { candidate: resolvedCandidate, roots: normalizedRoots },
      },
    );
  }
  return resolvedCandidate;
}

export function isPathWithinRootLexically(candidate: string, root: string): boolean {
  return isContained(path.resolve(root), path.resolve(candidate));
}
