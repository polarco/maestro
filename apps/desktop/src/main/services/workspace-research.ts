import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

interface IgnoreScope {
  base: string;
  matcher: Ignore;
}

interface WorkspaceEntry {
  absolutePath: string;
  relativePath: string;
  directory: boolean;
}

export interface WorkspaceResearchSource {
  path: string;
  excerpt: string;
}

export interface WorkspaceResearchSnapshot {
  files: number;
  directories: number;
  truncated: boolean;
  tree: string[];
  sources: WorkspaceResearchSource[];
  observations: string[];
}

const ALWAYS_IGNORED = ignore().add([
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
]);

const STOP_WORDS = new Set([
  "a",
  "as",
  "ao",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "eu",
  "faca",
  "fazer",
  "implemente",
  "mais",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "que",
  "quero",
  "sem",
  "um",
  "uma",
  "the",
  "and",
  "for",
  "from",
  "with",
]);

const IMPORTANT_NAMES = new Map<string, number>([
  ["readme.md", 1_200],
  ["agents.md", 1_150],
  ["package.json", 1_100],
  ["pyproject.toml", 1_100],
  ["cargo.toml", 1_100],
  ["go.mod", 1_100],
  ["composer.json", 1_100],
  ["gemfile", 1_100],
  ["dockerfile", 850],
  ["vite.config.ts", 800],
  ["next.config.js", 800],
  ["next.config.mjs", 800],
  ["tsconfig.json", 750],
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".md",
  ".mdx",
  ".php",
  ".prisma",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

function posix(value: string): string {
  return value.split(path.sep).join("/");
}

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function promptTerms(prompt: string): string[] {
  return [
    ...new Set(
      fold(prompt)
        .match(/[a-z0-9_-]{3,}/g)
        ?.filter((term) => !STOP_WORDS.has(term)) ?? [],
    ),
  ].slice(0, 20);
}

function ignoredByScopes(relativePath: string, directory: boolean, scopes: IgnoreScope[]): boolean {
  for (const scope of scopes) {
    const scoped = scope.base ? path.posix.relative(scope.base, relativePath) : relativePath;
    if (!scoped || scoped.startsWith("../")) continue;
    if (scope.matcher.ignores(directory ? `${scoped}/` : scoped)) return true;
  }
  return false;
}

function sensitive(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase();
  if (name === ".env.example" || name === ".env.sample") return false;
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    /(?:secret|credential|private[-_.]?key|id_rsa|id_ed25519|\.pem$|\.p12$|\.pfx$)/i.test(name)
  );
}

function readableSource(relativePath: string): boolean {
  if (sensitive(relativePath)) return false;
  const name = path.posix.basename(relativePath).toLowerCase();
  return IMPORTANT_NAMES.has(name) || TEXT_EXTENSIONS.has(path.posix.extname(name));
}

function sourceScore(relativePath: string, terms: string[]): number {
  const normalized = fold(relativePath);
  const name = path.posix.basename(normalized);
  let score = IMPORTANT_NAMES.get(name) ?? 0;
  for (const term of terms) {
    if (name.includes(term)) score += 420;
    else if (normalized.includes(term)) score += 180;
  }
  if (/^(src|app|apps|packages|docs|test|tests)\//.test(normalized)) score += 70;
  score -= normalized.split("/").length * 4;
  return score;
}

export async function inspectWorkspaceForResearch(
  canonicalRoot: string,
  prompt: string,
): Promise<WorkspaceResearchSnapshot> {
  const entries: WorkspaceEntry[] = [];
  let directories = 0;
  let files = 0;
  let truncated = false;
  const maxEntries = 4_000;

  const walk = async (
    absoluteDirectory: string,
    relativeDirectory: string,
    parentScopes: IgnoreScope[],
  ): Promise<void> => {
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    const rules = await readFile(path.join(absoluteDirectory, ".gitignore"), "utf8").catch(
      () => "",
    );
    const scopes = rules
      ? [...parentScopes, { base: relativeDirectory, matcher: ignore().add(rules) }]
      : parentScopes;
    const children = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      if (child.isSymbolicLink()) continue;
      const relativePath = posix(
        relativeDirectory ? path.join(relativeDirectory, child.name) : child.name,
      );
      const directory = child.isDirectory();
      if (sensitive(relativePath)) continue;
      if (
        ALWAYS_IGNORED.ignores(directory ? `${relativePath}/` : relativePath) ||
        ignoredByScopes(relativePath, directory, scopes)
      )
        continue;
      const absolutePath = path.join(absoluteDirectory, child.name);
      if (directory) {
        directories += 1;
        entries.push({ absolutePath, relativePath, directory: true });
        await walk(absolutePath, relativePath, scopes);
      } else if (child.isFile()) {
        files += 1;
        entries.push({ absolutePath, relativePath, directory: false });
      }
    }
  };

  await walk(canonicalRoot, "", []);
  const terms = promptTerms(prompt);
  const candidates = entries
    .filter((entry) => !entry.directory && readableSource(entry.relativePath))
    .sort(
      (left, right) =>
        sourceScore(right.relativePath, terms) - sourceScore(left.relativePath, terms) ||
        left.relativePath.localeCompare(right.relativePath, "en"),
    );
  const sources: WorkspaceResearchSource[] = [];
  let remainingCharacters = 48_000;
  for (const candidate of candidates) {
    if (sources.length >= 12 || remainingCharacters <= 0) break;
    const metadata = await stat(candidate.absolutePath).catch(() => null);
    if (!metadata?.isFile() || metadata.size > 1024 * 1024) continue;
    const content = await readFile(candidate.absolutePath, "utf8").catch(() => "");
    if (!content || content.includes("\0")) continue;
    const excerpt = content.slice(0, Math.min(8_000, remainingCharacters)).trim();
    if (!excerpt) continue;
    sources.push({ path: candidate.relativePath, excerpt });
    remainingCharacters -= excerpt.length;
  }

  const manifests = entries
    .filter(
      (entry) =>
        !entry.directory &&
        IMPORTANT_NAMES.has(path.posix.basename(entry.relativePath).toLowerCase()),
    )
    .map((entry) => entry.relativePath)
    .slice(0, 8);
  const related = candidates
    .filter((entry) => sourceScore(entry.relativePath, terms) >= 180)
    .map((entry) => entry.relativePath)
    .slice(0, 8);
  const observations = [
    `${files} arquivos e ${directories} pastas elegíveis foram mapeados${truncated ? " (amostra limitada)" : ""}.`,
    ...(manifests.length > 0 ? [`Estrutura e stack: ${manifests.join(", ")}.`] : []),
    ...(sources.length > 0
      ? [
          `Fontes lidas para entender o projeto: ${sources.map((source) => source.path).join(", ")}.`,
        ]
      : ["Nenhuma fonte textual segura foi encontrada para leitura automática."]),
    ...(related.length > 0 ? [`Caminhos relacionados ao pedido: ${related.join(", ")}.`] : []),
  ];

  return {
    files,
    directories,
    truncated,
    tree: entries
      .slice(0, 240)
      .map((entry) => `${entry.directory ? "[dir]" : "[file]"} ${entry.relativePath}`),
    sources,
    observations,
  };
}

export function formatWorkspaceResearch(snapshot: WorkspaceResearchSnapshot): string {
  const sourceText = snapshot.sources
    .map(
      (source) =>
        `<workspace_source path=${JSON.stringify(source.path)}>\n${source.excerpt.replaceAll("</workspace_source>", "<\\/workspace_source>")}\n</workspace_source>`,
    )
    .join("\n\n");
  return [
    "<workspace_research>",
    `Arquivos: ${snapshot.files}; pastas: ${snapshot.directories}; amostra limitada: ${snapshot.truncated ? "sim" : "não"}.`,
    "Estrutura:",
    snapshot.tree.join("\n"),
    sourceText,
    "</workspace_research>",
  ].join("\n");
}
