import type { MemoryRecord } from "@maestro/contracts";

export interface MemoryCandidate {
  kind: MemoryRecord["kind"];
  content: string;
  confidence: number;
  evidence: string;
}

const SIGNALS: Array<{ kind: MemoryCandidate["kind"]; pattern: RegExp; confidence: number }> = [
  {
    kind: "preference",
    pattern: /\b(?:prefiro|minha preferência|sempre use|i prefer|always use)\b/i,
    confidence: 0.88,
  },
  {
    kind: "constraint",
    pattern: /\b(?:não use|nunca|deve|precisa|must|never|do not)\b/i,
    confidence: 0.84,
  },
  {
    kind: "decision",
    pattern: /\b(?:decidimos|fica decidido|vamos usar|we decided|we will use)\b/i,
    confidence: 0.9,
  },
  {
    kind: "instruction",
    pattern: /\b(?:daqui em diante|neste projeto|from now on|in this project)\b/i,
    confidence: 0.86,
  },
];

/** Conservative local extraction: suggestions only, always with verbatim provenance. */
export function extractMemoryCandidates(content: string): MemoryCandidate[] {
  const sentences = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 8 && value.length <= 2_000);
  const seen = new Set<string>();
  return sentences.flatMap((sentence): MemoryCandidate[] => {
    const signal = SIGNALS.find((candidate) => candidate.pattern.test(sentence));
    const normalized = sentence.toLocaleLowerCase().replace(/\s+/g, " ");
    if (!signal || seen.has(normalized)) return [];
    seen.add(normalized);
    return [
      {
        kind: signal.kind,
        content: sentence,
        confidence: signal.confidence,
        evidence: sentence,
      },
    ];
  });
}

export function canCreateMemory(
  scope: "project" | "personal",
  personalMemoryEnabled: boolean,
): boolean {
  return scope === "project" || personalMemoryEnabled;
}
