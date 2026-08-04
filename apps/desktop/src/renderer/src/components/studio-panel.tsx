import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bot,
  Check,
  ChevronRight,
  Download,
  FileCode2,
  FileText,
  FolderTree,
  History,
  MemoryStick,
  Network,
  PanelRightClose,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
} from "lucide-react";
import type { Artifact, Connector, Project } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { cn } from "@renderer/lib/utils";

type StudioTab = "artifacts" | "context" | "memory" | "activity";

const tabs: Array<{ id: StudioTab; label: string; icon: typeof Archive }> = [
  { id: "artifacts", label: "Artefatos", icon: Archive },
  { id: "context", label: "Contexto", icon: FolderTree },
  { id: "memory", label: "Memória", icon: MemoryStick },
  { id: "activity", label: "Validação", icon: TestTube2 },
];

function ArtifactIcon({ artifact }: { artifact: Artifact }) {
  return artifact.kind === "code" || artifact.kind === "html" || artifact.kind === "svg" ? (
    <FileCode2 size={14} />
  ) : (
    <FileText size={14} />
  );
}

function ConnectorCard({ connector }: { connector: Connector }) {
  const queryClient = useQueryClient();
  const grants = useQuery({
    queryKey: ["connector-grants", connector.id],
    queryFn: () => api().listConnectorGrants(connector.id),
  });
  const invocations = useQuery({
    queryKey: ["connector-invocations", connector.id],
    queryFn: () => api().listConnectorInvocations(connector.id),
    refetchInterval: 5_000,
  });
  const active = (grants.data ?? []).filter(
    (grant) =>
      grant.granted && (grant.expiresAt === null || Date.parse(grant.expiresAt) > Date.now()),
  );
  const mutationsEnabled = ["write", "external_mutation"].every((capability) =>
    active.some((grant) => grant.capability === capability),
  );
  const updateGrants = useMutation({
    mutationFn: async (action: "mutations" | "revoke") => {
      if (action === "mutations") {
        for (const capability of ["write", "external_mutation"] as const) {
          if (!active.some((grant) => grant.capability === capability))
            await api().grantConnector({ connectorId: connector.id, capability });
        }
        return;
      }
      for (const grant of active) await api().revokeConnector(connector.id, grant.id);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["connector-grants", connector.id] }),
  });
  const latest = invocations.data?.[0];
  return (
    <div className="rounded-[8px] bg-bg-elevated px-2.5 py-2 text-[10px]">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-1.5 rounded-full",
            connector.enabled ? "bg-success" : "bg-text-faint",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{connector.name}</span>
        <span className="text-[8px] uppercase text-text-faint">{connector.kind}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[8px] text-text-faint">
        {active.map((grant) => (
          <span key={grant.id} className="rounded bg-surface px-1.5 py-0.5 uppercase">
            {grant.capability}
          </span>
        ))}
        {latest ? (
          <span className="ml-auto uppercase">
            {latest.operation} · {latest.status}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex gap-1.5">
        {(connector.kind === "github" || connector.kind.startsWith("mcp_")) && !mutationsEnabled ? (
          <button
            className="studio-secondary-button"
            disabled={updateGrants.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Liberar escrita e mutações externas para ${connector.name}? Cada execução ainda exigirá aprovação explícita no plano.`,
                )
              )
                updateGrants.mutate("mutations");
            }}
          >
            <ShieldCheck size={10} /> Liberar mutações
          </button>
        ) : null}
        {active.length > 0 ? (
          <button
            className="studio-secondary-button"
            disabled={updateGrants.isPending}
            onClick={() => updateGrants.mutate("revoke")}
          >
            <Trash2 size={10} /> Revogar
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function StudioPanel({
  project,
  sessionId,
  branchId,
  onClose,
}: {
  project: Project;
  sessionId: string;
  branchId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<StudioTab>("artifacts");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [connectorSetupOpen, setConnectorSetupOpen] = useState(false);
  const [connectorKind, setConnectorKind] = useState<Connector["kind"]>("brave_search");
  const [connectorCredential, setConnectorCredential] = useState("");
  const [connectorEndpoint, setConnectorEndpoint] = useState("");
  const [connectorCommand, setConnectorCommand] = useState("");
  const [connectorArgs, setConnectorArgs] = useState("");
  const [connectorCredentialEnv, setConnectorCredentialEnv] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const artifacts = useQuery({
    queryKey: ["artifacts", project.id, sessionId],
    queryFn: () => api().listArtifacts(project.id, sessionId),
  });
  const artifact = useQuery({
    queryKey: ["artifact", selectedArtifactId],
    queryFn: () => api().openArtifact(selectedArtifactId!),
    enabled: Boolean(selectedArtifactId),
  });
  const memories = useQuery({
    queryKey: ["memories", project.id],
    queryFn: async () => {
      const [projectMemories, personalMemories] = await Promise.all([
        api().listMemories({ projectId: project.id, scope: "project" }),
        api().listMemories({ scope: "personal" }),
      ]);
      return [...projectMemories, ...personalMemories];
    },
  });
  const jobs = useQuery({
    queryKey: ["jobs", project.id],
    queryFn: () => api().listJobs(project.id),
    refetchInterval: 3_000,
  });
  const connectors = useQuery({
    queryKey: ["connectors", project.id],
    queryFn: () => api().listConnectors(project.id),
  });
  const autonomy = useQuery({
    queryKey: ["autonomy", project.id],
    queryFn: () => api().getProjectAutonomy(project.id),
  });

  useEffect(() => {
    if (!selectedArtifactId && artifacts.data?.[0]) setSelectedArtifactId(artifacts.data[0].id);
  }, [artifacts.data, selectedArtifactId]);

  useEffect(() => {
    setContent(artifact.data?.versions[0]?.content ?? "");
    setPreview(false);
    setCompareVersion(null);
  }, [artifact.data?.artifact.id, artifact.data?.artifact.currentVersion]);

  const createArtifact = useMutation({
    mutationFn: () =>
      api().createArtifact({
        projectId: project.id,
        sessionId,
        ...(branchId ? { branchId } : {}),
        title: "Novo documento",
        kind: "markdown",
        content: "# Novo documento\n\n",
      }),
    onSuccess: (value) => {
      setSelectedArtifactId(value.artifact.id);
      void queryClient.invalidateQueries({ queryKey: ["artifacts", project.id, sessionId] });
    },
  });
  const saveArtifact = useMutation({
    mutationFn: () => {
      if (!artifact.data) throw new Error("Selecione um artefato.");
      return api().updateArtifact({ artifactId: artifact.data.artifact.id, content });
    },
    onSuccess: (value) => {
      queryClient.setQueryData(["artifact", value.artifact.id], value);
      void queryClient.invalidateQueries({ queryKey: ["artifacts", project.id, sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["timeline", sessionId] });
    },
  });
  const updateAutonomy = useMutation({
    mutationFn: (level: "observe" | "review" | "autopilot") =>
      api().setProjectAutonomy(project.id, level),
    onSuccess: (value) => queryClient.setQueryData(["autonomy", project.id], value),
  });
  const configureConnector = useMutation({
    mutationFn: async () => {
      const existing = connectors.data?.find((connector) => connector.kind === connectorKind);
      if (
        !existing &&
        (connectorKind === "brave_search" || connectorKind === "github") &&
        !connectorCredential.trim()
      )
        throw new Error("Informe o token para criar o conector.");
      if (!existing && connectorKind === "mcp_stdio" && !connectorCommand.trim())
        throw new Error("Informe o executável do servidor MCP.");
      if (!existing && connectorKind === "mcp_http" && !connectorEndpoint.trim())
        throw new Error("Informe o endpoint Streamable HTTP.");
      const names: Record<Connector["kind"], string> = {
        brave_search: "Brave Search",
        github: "GitHub",
        mcp_stdio: "MCP local",
        mcp_http: "MCP HTTP",
      };
      const newConfig: Record<Connector["kind"], Record<string, unknown>> = {
        brave_search: { count: 6, country: "BR", searchLang: "pt-br" },
        github: { apiBase: connectorEndpoint.trim() || "https://api.github.com" },
        mcp_http: { url: connectorEndpoint.trim(), timeoutMs: 30_000 },
        mcp_stdio: {
          command: connectorCommand.trim(),
          args: connectorArgs
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean),
          ...(connectorCredentialEnv.trim()
            ? { credentialEnv: connectorCredentialEnv.trim() }
            : {}),
          timeoutMs: 30_000,
        },
      };
      const connector = await api().configureConnector({
        projectId: project.id,
        ...(existing ? { connectorId: existing.id } : {}),
        name: existing?.name ?? names[connectorKind],
        kind: connectorKind,
        enabled: true,
        config: existing?.config ?? newConfig[connectorKind],
        ...(connectorCredential.trim() ? { credential: connectorCredential.trim() } : {}),
      });
      if (!existing) {
        await api().grantConnector({ connectorId: connector.id, capability: "read" });
        if (connector.kind !== "mcp_stdio")
          await api().grantConnector({ connectorId: connector.id, capability: "network" });
      }
      return connector;
    },
    onSuccess: () => {
      setConnectorCredential("");
      setConnectorEndpoint("");
      setConnectorCommand("");
      setConnectorArgs("");
      setConnectorCredentialEnv("");
      setConnectorSetupOpen(false);
      void connectors.refetch();
    },
  });

  const previewDocument = useMemo(() => {
    if (!artifact.data) return "";
    const policy =
      "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";
    const body =
      artifact.data.artifact.kind === "svg"
        ? `<div style="display:grid;place-items:center;min-height:100vh">${content}</div>`
        : content;
    return `<meta http-equiv="Content-Security-Policy" content="${policy}">${body}`;
  }, [artifact.data, content]);

  return (
    <aside
      className="studio-panel flex h-full w-[390px] min-w-[320px] flex-col border-l border-border bg-sidebar"
      aria-label="Studio"
    >
      <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="grid size-8 place-items-center rounded-[9px] bg-primary/10 text-primary-soft">
          <Sparkles size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-text">Studio</div>
          <div className="truncate text-[9px] text-text-faint">
            Artefatos e contexto verificável
          </div>
        </div>
        <button className="studio-icon-button" onClick={onClose} aria-label="Fechar Studio">
          <PanelRightClose size={15} />
        </button>
      </header>
      <div className="grid shrink-0 grid-cols-4 border-b border-border px-2 py-2" role="tablist">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={cn("studio-tab", tab === item.id && "is-active")}
              onClick={() => setTab(item.id)}
              title={item.label}
            >
              <Icon size={13} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "artifacts" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <select
              className="studio-select min-w-0 flex-1"
              value={selectedArtifactId ?? ""}
              onChange={(event) => setSelectedArtifactId(event.target.value || null)}
              aria-label="Artefato aberto"
            >
              <option value="">Nenhum artefato</option>
              {(artifacts.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.currentVersion}
                </option>
              ))}
            </select>
            <button
              className="studio-icon-button"
              onClick={() => createArtifact.mutate()}
              aria-label="Criar artefato"
            >
              <Plus size={14} />
            </button>
          </div>
          {artifact.data ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[10px] text-text-faint">
                <ArtifactIcon artifact={artifact.data.artifact} />
                <span className="min-w-0 flex-1 truncate">{artifact.data.artifact.title}</span>
                <button
                  className={cn("studio-text-button", preview && "is-active")}
                  disabled={
                    artifact.data.artifact.kind !== "html" && artifact.data.artifact.kind !== "svg"
                  }
                  onClick={() => {
                    setCompareVersion(null);
                    setPreview((value) => !value);
                  }}
                >
                  Preview
                </button>
                <button
                  className={cn("studio-text-button", compareVersion !== null && "is-active")}
                  disabled={artifact.data.versions.length < 2}
                  onClick={() => {
                    setPreview(false);
                    setCompareVersion((current) =>
                      current === null ? (artifact.data?.versions[1]?.version ?? null) : null,
                    );
                  }}
                >
                  <History size={11} /> Comparar
                </button>
                <button
                  className="studio-icon-button"
                  onClick={() => void api().exportArtifact(artifact.data.artifact.id)}
                  aria-label="Exportar artefato"
                >
                  <Download size={13} />
                </button>
              </div>
              {compareVersion !== null ? (
                <div className="studio-compare min-h-0 flex-1">
                  <section>
                    <div className="studio-compare-label">
                      Atual · v{artifact.data.versions[0]?.version}
                    </div>
                    <pre>{content}</pre>
                  </section>
                  <section>
                    <div className="studio-compare-label">
                      <span>Anterior</span>
                      <select
                        value={compareVersion}
                        onChange={(event) => setCompareVersion(Number(event.target.value))}
                        aria-label="Versão para comparar"
                      >
                        {artifact.data.versions.slice(1).map((version) => (
                          <option key={version.id} value={version.version}>
                            v{version.version}
                          </option>
                        ))}
                      </select>
                    </div>
                    <pre>
                      {artifact.data.versions.find((version) => version.version === compareVersion)
                        ?.content ?? ""}
                    </pre>
                  </section>
                </div>
              ) : preview ? (
                <iframe
                  className="min-h-0 flex-1 border-0 bg-white"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={previewDocument}
                  title={`Preview isolado de ${artifact.data.artifact.title}`}
                />
              ) : (
                <textarea
                  className="studio-editor min-h-0 flex-1 resize-none"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={artifact.data.artifact.kind === "markdown"}
                  aria-label="Conteúdo do artefato"
                />
              )}
              <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
                <span className="text-[9px] text-text-faint">
                  {artifact.data.versions.length} versõe(s) · local
                </span>
                <button
                  className="studio-primary-button ml-auto"
                  disabled={
                    compareVersion !== null ||
                    saveArtifact.isPending ||
                    content === artifact.data.versions[0]?.content
                  }
                  onClick={() => saveArtifact.mutate()}
                >
                  <Save size={12} /> {saveArtifact.isPending ? "Salvando…" : "Salvar versão"}
                </button>
              </footer>
            </>
          ) : (
            <div className="studio-empty">
              <Archive size={22} />
              <p>Nenhum artefato nesta conversa.</p>
              <button onClick={() => createArtifact.mutate()}>Criar documento</button>
            </div>
          )}
        </div>
      ) : null}

      {tab === "context" ? (
        <div className="studio-scroll space-y-4 p-3">
          <section className="studio-card">
            <div className="studio-card-title">
              <ShieldCheck size={13} /> Autonomia do projeto
            </div>
            <select
              className="studio-select mt-3 w-full"
              value={autonomy.data?.level ?? "review"}
              onChange={(event) =>
                updateAutonomy.mutate(event.target.value as "observe" | "review" | "autopilot")
              }
            >
              <option value="observe">Observe · somente leitura</option>
              <option value="review">Review · aprovar mutações</option>
              <option value="autopilot">Autopilot · escopo pré-aprovado</option>
            </select>
            <p className="mt-2 text-[9.5px] leading-4 text-text-faint">
              Push, deploy, publicação e ações destrutivas continuam pedindo confirmação.
            </p>
          </section>
          <section className="studio-card">
            <div className="studio-card-title">
              <FolderTree size={13} /> Pastas autorizadas
            </div>
            <div className="mt-2 space-y-1.5">
              {project.roots.map((root) => (
                <div key={root.id} className="rounded-[8px] bg-bg-elevated px-2.5 py-2">
                  <div className="truncate text-[10px] font-medium text-text">
                    {root.displayName}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[8.5px] text-text-faint">
                    {root.canonicalPath}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="studio-card">
            <div className="studio-card-title flex items-center">
              <Network size={13} /> <span className="flex-1">Conectores</span>
              <button
                className="studio-icon-button"
                onClick={() => setConnectorSetupOpen((value) => !value)}
                aria-label="Configurar conector"
              >
                <Plus size={12} />
              </button>
            </div>
            {connectorSetupOpen ? (
              <div className="mt-3 space-y-2 rounded-[9px] border border-border bg-bg-elevated p-2.5">
                <select
                  className="studio-select w-full"
                  value={connectorKind}
                  onChange={(event) => setConnectorKind(event.target.value as Connector["kind"])}
                  aria-label="Tipo de conector"
                >
                  <option value="brave_search">Brave Search</option>
                  <option value="github">GitHub</option>
                  <option value="mcp_stdio">MCP · stdio</option>
                  <option value="mcp_http">MCP · Streamable HTTP</option>
                </select>
                {connectorKind === "github" || connectorKind === "mcp_http" ? (
                  <input
                    className="studio-select w-full"
                    value={connectorEndpoint}
                    onChange={(event) => setConnectorEndpoint(event.target.value)}
                    placeholder={
                      connectorKind === "github"
                        ? "https://api.github.com"
                        : "https://servidor.example/mcp"
                    }
                    aria-label="Endpoint do conector"
                  />
                ) : null}
                {connectorKind === "mcp_stdio" ? (
                  <>
                    <input
                      className="studio-select w-full"
                      value={connectorCommand}
                      onChange={(event) => setConnectorCommand(event.target.value)}
                      placeholder="Executável, por exemplo npx"
                      aria-label="Executável MCP"
                    />
                    <textarea
                      className="studio-select min-h-20 w-full resize-y py-2"
                      value={connectorArgs}
                      onChange={(event) => setConnectorArgs(event.target.value)}
                      placeholder={
                        "Argumentos, um por linha\n-y\n@modelcontextprotocol/server-filesystem"
                      }
                      aria-label="Argumentos MCP"
                    />
                    <input
                      className="studio-select w-full"
                      value={connectorCredentialEnv}
                      onChange={(event) => setConnectorCredentialEnv(event.target.value)}
                      placeholder="Variável do token (opcional)"
                      aria-label="Variável de ambiente da credencial MCP"
                    />
                  </>
                ) : null}
                <input
                  className="studio-select w-full"
                  type="password"
                  value={connectorCredential}
                  onChange={(event) => setConnectorCredential(event.target.value)}
                  placeholder={
                    connectors.data?.some((connector) => connector.kind === connectorKind)
                      ? "Novo token (opcional)"
                      : connectorKind.startsWith("mcp_")
                        ? "Token opcional, armazenado no vault"
                        : "Token armazenado no vault"
                  }
                  aria-label="Token do conector"
                  autoComplete="off"
                />
                <button
                  className="studio-primary-button w-full justify-center"
                  disabled={configureConnector.isPending}
                  onClick={() => configureConnector.mutate()}
                >
                  <ShieldCheck size={11} />
                  {configureConnector.isPending
                    ? "Protegendo…"
                    : connectorKind === "mcp_stdio"
                      ? "Conectar com leitura"
                      : "Conectar com leitura e rede"}
                </button>
                {configureConnector.error ? (
                  <p className="text-[9px] leading-4 text-danger" role="alert">
                    {configureConnector.error instanceof Error
                      ? configureConnector.error.message
                      : String(configureConnector.error)}
                  </p>
                ) : null}
                <p className="text-[8.5px] leading-4 text-text-faint">
                  O token vai direto ao vault; resultados externos continuam sendo contexto não
                  confiável.
                </p>
              </div>
            ) : null}
            {(connectors.data ?? []).length ? (
              <div className="mt-2 space-y-1.5">
                {connectors.data!.map((connector) => (
                  <ConnectorCard key={connector.id} connector={connector} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[9.5px] text-text-faint">Nenhum conector liberado.</p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div className="studio-scroll space-y-2 p-3">
          {(memories.data ?? []).length ? (
            memories.data!.map((memory) => (
              <article key={memory.id} className="studio-card">
                <div className="flex items-center gap-2 text-[8.5px] uppercase tracking-[0.08em] text-text-faint">
                  <span>{memory.kind}</span>
                  <span>·</span>
                  <span>{memory.scope === "personal" ? "pessoal" : "projeto"}</span>
                  <span>·</span>
                  <span>{Math.round(memory.confidence * 100)}%</span>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 py-0.5",
                      memory.state === "accepted"
                        ? "bg-success/10 text-success"
                        : "bg-warning/10 text-warning",
                    )}
                  >
                    {memory.state}
                  </span>
                </div>
                {editingMemoryId === memory.id ? (
                  <textarea
                    className="studio-editor mt-2 min-h-24 rounded-[8px] border border-border p-2 text-[10px]"
                    value={memoryDraft}
                    onChange={(event) => setMemoryDraft(event.target.value)}
                    aria-label="Conteúdo da memória"
                  />
                ) : (
                  <p className="mt-2 text-[11px] leading-4.5 text-text-muted">{memory.content}</p>
                )}
                <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-2">
                  {memory.state === "suggested" ? (
                    <button
                      className="studio-text-button"
                      onClick={() =>
                        void api()
                          .acceptMemory(memory.id)
                          .then(() => memories.refetch())
                      }
                    >
                      <Check size={11} /> Aceitar
                    </button>
                  ) : null}
                  {editingMemoryId === memory.id ? (
                    <button
                      className="studio-text-button"
                      disabled={!memoryDraft.trim()}
                      onClick={() =>
                        void api()
                          .updateMemory({ memoryId: memory.id, content: memoryDraft.trim() })
                          .then(() => {
                            setEditingMemoryId(null);
                            void memories.refetch();
                          })
                      }
                    >
                      <Save size={11} /> Salvar
                    </button>
                  ) : (
                    <button
                      className="studio-text-button"
                      onClick={() => {
                        setEditingMemoryId(memory.id);
                        setMemoryDraft(memory.content);
                      }}
                    >
                      <FileText size={11} /> Editar
                    </button>
                  )}
                  <button
                    className="studio-text-button ml-auto text-danger"
                    onClick={() =>
                      void api()
                        .forgetMemory(memory.id)
                        .then(() => memories.refetch())
                    }
                  >
                    <Trash2 size={11} /> Esquecer
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="studio-empty">
              <MemoryStick size={22} />
              <p>Decisões e preferências verificáveis aparecerão aqui.</p>
            </div>
          )}
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="studio-scroll space-y-2 p-3">
          {(jobs.data ?? []).map((job) => (
            <article key={job.id} className="studio-card">
              <div className="flex items-center gap-2">
                {job.kind === "agent" ? <Bot size={13} /> : <History size={13} />}
                <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-text">
                  {job.title}
                </span>
                <span className="text-[8.5px] uppercase text-text-faint">{job.state}</span>
                <ChevronRight size={11} className="text-text-faint" />
              </div>
              {job.progress !== null ? (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-elevated">
                  <div className="h-full bg-primary" style={{ width: `${job.progress * 100}%` }} />
                </div>
              ) : null}
              <div className="mt-2 flex gap-3 text-[8.5px] text-text-faint">
                <span>{job.inputTokens + job.outputTokens} tokens</span>
                <span>US$ {job.costUsd.toFixed(3)}</span>
              </div>
            </article>
          ))}
          {(jobs.data ?? []).length === 0 ? (
            <div className="studio-empty">
              <TestTube2 size={22} />
              <p>Testes e validações das execuções aparecerão aqui.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
