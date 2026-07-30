import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { WorkspaceContextCandidate } from "@maestro/contracts";
import type { MaestroRepository } from "@maestro/database";
import { isEligibleContextFile, mimeTypeForFile } from "./context-file-types.js";

export interface IndexedCandidate extends WorkspaceContextCandidate {
  searchable: string;
}

interface IgnoreScope {
  base: string;
  matcher: Ignore;
}

interface ProjectIndex {
  builtAt: number;
  entries: IndexedCandidate[];
  building: Promise<IndexedCandidate[]> | null;
}

const ALWAYS_IGNORED = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  "release/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  "coverage/",
  "target/",
  "vendor/",
];

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

function ignored(
  relativePath: string,
  directory: boolean,
  scopes: readonly IgnoreScope[],
): boolean {
  for (const scope of scopes) {
    const scoped = posix(path.relative(scope.base, relativePath));
    if (scoped === "" || scoped.startsWith("../")) continue;
    if (scope.matcher.ignores(directory ? `${scoped}/` : scoped)) return true;
  }
  return false;
}

function fuzzyScore(query: string, candidate: IndexedCandidate): number {
  if (!query) return candidate.kind === "directory" ? 20 : 10;
  const value = candidate.searchable;
  const name = candidate.name.toLowerCase();
  if (name === query) return 10_000;
  if (name.startsWith(query)) return 8_000 - name.length;
  const direct = value.indexOf(query);
  if (direct >= 0) return 6_000 - direct - value.length / 100;
  let cursor = 0;
  let first = -1;
  let gaps = 0;
  for (const character of query) {
    const found = value.indexOf(character, cursor);
    if (found < 0) return -1;
    if (first < 0) first = found;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 3_000 - first * 2 - gaps - value.length / 50;
}

export function searchIndexedCandidates(
  entries: readonly IndexedCandidate[],
  query: string,
  limit = 40,
): WorkspaceContextCandidate[] {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  type Ranked = { candidate: IndexedCandidate; score: number };
  const compare = (left: Ranked, right: Ranked) =>
    right.score - left.score ||
    left.candidate.relativePath.localeCompare(right.candidate.relativePath, "pt-BR");
  const worse = (left: Ranked, right: Ranked) => compare(left, right) > 0;
  const heap: Ranked[] = [];
  const siftDown = () => {
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let worst = parent;
      if (left < heap.length && worse(heap[left]!, heap[worst]!)) worst = left;
      if (right < heap.length && worse(heap[right]!, heap[worst]!)) worst = right;
      if (worst === parent) return;
      [heap[parent], heap[worst]] = [heap[worst]!, heap[parent]!];
      parent = worst;
    }
  };
  for (const candidate of entries) {
    const score = fuzzyScore(normalized, candidate);
    if (score < 0) continue;
    const ranked = { candidate, score };
    if (heap.length < boundedLimit) {
      heap.push(ranked);
      let child = heap.length - 1;
      while (child > 0) {
        const parent = Math.floor((child - 1) / 2);
        if (!worse(heap[child]!, heap[parent]!)) break;
        [heap[parent], heap[child]] = [heap[child]!, heap[parent]!];
        child = parent;
      }
    } else if (compare(ranked, heap[0]!) < 0) {
      heap[0] = ranked;
      siftDown();
    }
  }
  return heap
    .sort(compare)
    .map(({ candidate: { searchable: _searchable, ...candidate } }) => candidate);
}

export class WorkspaceContextIndex {
  readonly #repository: MaestroRepository;
  readonly #indexes = new Map<string, ProjectIndex>();

  constructor(repository: MaestroRepository) {
    this.#repository = repository;
  }

  invalidate(projectId?: string): void {
    if (projectId) this.#indexes.delete(projectId);
    else this.#indexes.clear();
  }

  warm(projectId: string): void {
    void this.#entries(projectId).catch(() => null);
  }

  async search(projectId: string, query: string, limit = 40): Promise<WorkspaceContextCandidate[]> {
    const entries = await this.#entries(projectId);
    return searchIndexedCandidates(entries, query, limit);
  }

  async #entries(projectId: string): Promise<IndexedCandidate[]> {
    const cached = this.#indexes.get(projectId);
    if (cached && Date.now() - cached.builtAt < 30_000 && !cached.building) return cached.entries;
    if (cached?.building) return cached.building;
    const target: ProjectIndex = cached ?? { builtAt: 0, entries: [], building: null };
    target.building = this.#build(projectId).then(
      (entries) => {
        target.entries = entries;
        target.builtAt = Date.now();
        target.building = null;
        return entries;
      },
      (error: unknown) => {
        target.building = null;
        throw error;
      },
    );
    this.#indexes.set(projectId, target);
    return target.building;
  }

  async #build(projectId: string): Promise<IndexedCandidate[]> {
    const project = await this.#repository.getProject(projectId);
    const result: IndexedCandidate[] = [];
    for (const root of project.roots) {
      const scopes: IgnoreScope[] = [{ base: "", matcher: ignore().add(ALWAYS_IGNORED) }];
      const rootIgnore = await readFile(path.join(root.canonicalPath, ".gitignore"), "utf8").catch(
        () => "",
      );
      if (rootIgnore) scopes.push({ base: "", matcher: ignore().add(rootIgnore) });
      const walk = async (
        absoluteDirectory: string,
        relativeDirectory: string,
        scopes: IgnoreScope[],
      ): Promise<void> => {
        if (result.length >= 100_000) return;
        let nextScopes = scopes;
        if (relativeDirectory) {
          const rules = await readFile(path.join(absoluteDirectory, ".gitignore"), "utf8").catch(
            () => "",
          );
          if (rules)
            nextScopes = [...scopes, { base: relativeDirectory, matcher: ignore().add(rules) }];
        }
        const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (result.length >= 100_000 || entry.isSymbolicLink()) continue;
          const relative = relativeDirectory
            ? path.join(relativeDirectory, entry.name)
            : entry.name;
          if (ignored(relative, entry.isDirectory(), nextScopes)) continue;
          if (entry.isDirectory()) {
            result.push({
              id: `${root.id}:${posix(relative)}`,
              projectId,
              workspaceRootId: root.id,
              rootName: root.displayName,
              relativePath: posix(relative),
              name: entry.name,
              kind: "directory",
              mimeType: null,
              size: null,
              searchable: `${entry.name} ${posix(relative)} ${root.displayName}`.toLocaleLowerCase(
                "pt-BR",
              ),
            });
            await walk(path.join(absoluteDirectory, entry.name), relative, nextScopes);
          } else if (entry.isFile() && isEligibleContextFile(entry.name)) {
            result.push({
              id: `${root.id}:${posix(relative)}`,
              projectId,
              workspaceRootId: root.id,
              rootName: root.displayName,
              relativePath: posix(relative),
              name: entry.name,
              kind: "file",
              mimeType: mimeTypeForFile(entry.name),
              size: null,
              searchable: `${entry.name} ${posix(relative)} ${root.displayName}`.toLocaleLowerCase(
                "pt-BR",
              ),
            });
          }
        }
      };
      await walk(root.canonicalPath, "", scopes);
    }
    return result;
  }
}
