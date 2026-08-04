import { z } from "zod";
import type { SourceSnapshot } from "@maestro/contracts";
import type { MaestroRepository } from "@maestro/database";
import { errorMessage } from "@maestro/core";

interface CredentialStore {
  get(key: string): Promise<string | null>;
}

interface WebResearchInput {
  projectId: string;
  runId: string;
  turnId: string;
  query: string;
  signal?: AbortSignal;
  limit?: number;
}

export interface WebResearchResult {
  connectorId: string;
  invocationId: string;
  status: "completed" | "failed" | "denied";
  sources: SourceSnapshot[];
  warning: string | null;
}

const braveResponseSchema = z
  .object({
    web: z
      .object({
        results: z.array(
          z
            .object({
              title: z.string(),
              url: z.string(),
              description: z.string().optional().default(""),
              age: z.string().optional(),
              language: z.string().optional(),
            })
            .passthrough(),
        ),
      })
      .optional(),
  })
  .passthrough();

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function activeGrant(
  grants: Awaited<ReturnType<MaestroRepository["listConnectorGrants"]>>,
  capability: "read" | "network",
): boolean {
  const timestamp = Date.now();
  return grants.some(
    (grant) =>
      grant.capability === capability &&
      grant.granted &&
      (grant.expiresAt === null || Date.parse(grant.expiresAt) > timestamp),
  );
}

/** Read-only Brave Search fallback. Remote text is persisted only as untrusted source snapshots. */
export class WebResearchService {
  readonly #repository: MaestroRepository;
  readonly #credentials: CredentialStore;
  readonly #fetch: typeof fetch;

  constructor(input: {
    repository: MaestroRepository;
    credentials: CredentialStore;
    fetch?: typeof fetch;
  }) {
    this.#repository = input.repository;
    this.#credentials = input.credentials;
    this.#fetch = input.fetch ?? globalThis.fetch;
  }

  async search(input: WebResearchInput): Promise<WebResearchResult | null> {
    const connector = (await this.#repository.listConnectors(input.projectId)).find(
      (candidate) => candidate.enabled && candidate.kind === "brave_search",
    );
    if (!connector) return null;

    const grants = await this.#repository.listConnectorGrants(connector.id);
    if (!activeGrant(grants, "read") || !activeGrant(grants, "network")) {
      const denied = await this.#repository.startConnectorInvocation({
        connectorId: connector.id,
        runId: input.runId,
        turnId: input.turnId,
        operation: "search.web",
        mutability: "read",
        inputSummary: input.query.slice(0, 4_000),
        status: "denied",
      });
      await this.#repository.finishConnectorInvocation(denied.id, {
        status: "denied",
        error: "O conector requer grants ativos de leitura e rede.",
      });
      return {
        connectorId: connector.id,
        invocationId: denied.id,
        status: "denied",
        sources: [],
        warning: "A pesquisa web não foi executada porque o conector não possui grants ativos.",
      };
    }

    const invocation = await this.#repository.startConnectorInvocation({
      connectorId: connector.id,
      runId: input.runId,
      turnId: input.turnId,
      operation: "search.web",
      mutability: "read",
      inputSummary: input.query.slice(0, 4_000),
    });
    try {
      const credential = await this.#credentials.get(`connector:${connector.id}:credential`);
      if (!credential) throw new Error("Token do Brave Search ausente no vault.");
      const configuredCount = Number(connector.config.count);
      const limit = Math.max(
        1,
        Math.min(input.limit ?? (Number.isFinite(configuredCount) ? configuredCount : 6), 10),
      );
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", input.query.slice(0, 500));
      url.searchParams.set("count", String(limit));
      url.searchParams.set("safesearch", "moderate");
      if (typeof connector.config.country === "string")
        url.searchParams.set("country", connector.config.country.slice(0, 2));
      if (typeof connector.config.searchLang === "string")
        url.searchParams.set("search_lang", connector.config.searchLang.slice(0, 8));

      const controller = new AbortController();
      const abort = () => controller.abort(input.signal?.reason);
      input.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error("Timeout")), 15_000);
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": credential,
          },
          redirect: "error",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abort);
      }
      if (!response.ok) throw new Error(`Brave Search respondeu HTTP ${response.status}.`);
      const body = braveResponseSchema.parse(await response.json());
      const sources: SourceSnapshot[] = [];
      for (const result of body.web?.results.slice(0, limit) ?? []) {
        let sourceUrl: URL;
        try {
          sourceUrl = new URL(result.url);
        } catch {
          continue;
        }
        if (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") continue;
        const title = plainText(result.title).slice(0, 500);
        if (!title) continue;
        sources.push(
          await this.#repository.saveSourceSnapshot({
            projectId: input.projectId,
            url: sourceUrl.toString(),
            title,
            excerpt: plainText(result.description).slice(0, 20_000),
            provider: "brave_search",
            metadata: {
              connectorId: connector.id,
              ...(result.age ? { age: result.age } : {}),
              ...(result.language ? { language: result.language } : {}),
            },
          }),
        );
      }
      await this.#repository.finishConnectorInvocation(invocation.id, {
        status: "completed",
        outputSummary: `${sources.length} fonte(s) normalizada(s).`,
      });
      return {
        connectorId: connector.id,
        invocationId: invocation.id,
        status: "completed",
        sources,
        warning: null,
      };
    } catch (error) {
      const message = errorMessage(error).slice(0, 20_000);
      await this.#repository.finishConnectorInvocation(invocation.id, {
        status: "failed",
        error: message,
      });
      return {
        connectorId: connector.id,
        invocationId: invocation.id,
        status: "failed",
        sources: [],
        warning: `Pesquisa web indisponível: ${message}`,
      };
    }
  }
}
