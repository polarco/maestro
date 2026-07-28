import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Code2,
  Folder,
  LockKeyhole,
  MessageCircle,
  Paperclip,
  Send,
  Settings2,
  Shield,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import type {
  BootstrapPayload,
  Effort,
  Project,
  ProviderSummary,
  RunMode,
  SessionKind,
} from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { cn, RUN_LABELS, stateTone } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/app-store";
import { Button } from "@renderer/components/ui/button";
import { Badge } from "@renderer/components/ui/badge";
import { Select, Textarea } from "@renderer/components/ui/form";
import { LoadingPane } from "@renderer/components/ui/skeleton";
import { ErrorPane } from "@renderer/components/ui/feedback";
import { MessageList } from "@renderer/components/conversation/message-list";
import { PlanApprovalCard } from "@renderer/components/conversation/plan-approval";
import { AgentPipeline } from "@renderer/components/operations/agent-pipeline";

const modes: Array<{ id: RunMode; label: string; description: string; icon: typeof Sparkles }> = [
  {
    id: "maestro",
    label: "Maestro",
    description: "Planeja, aguarda aprovação e coordena",
    icon: Sparkles,
  },
  { id: "agent", label: "Agente", description: "Coding agent direto no workspace", icon: Code2 },
  {
    id: "chat",
    label: "Chat",
    description: "Conversa sem ferramentas ou workspace",
    icon: MessageCircle,
  },
];

const emptyStates: Record<RunMode, { title: string; description: string; suggestions: string[] }> =
  {
    maestro: {
      title: "O que vamos construir?",
      description:
        "Descreva o resultado. O Maestro analisa, cria um plano revisável e só altera arquivos depois da sua aprovação.",
      suggestions: [
        "Investigue e corrija os testes que falham",
        "Implemente uma melhoria completa nesta interface",
        "Revise a arquitetura e proponha um plano seguro",
      ],
    },
    agent: {
      title: "Qual mudança você quer fazer?",
      description:
        "O agente trabalha diretamente na pasta selecionada com as permissões definidas para o projeto.",
      suggestions: [
        "Localize e corrija um bug específico",
        "Refatore este módulo mantendo o comportamento",
        "Implemente a próxima tarefa do projeto",
      ],
    },
    chat: {
      title: "Em que posso ajudar?",
      description:
        "Converse sem acesso ao workspace. Ideal para explorar ideias, tirar dúvidas e preparar uma tarefa.",
      suggestions: [
        "Ajude a organizar uma ideia de produto",
        "Explique uma decisão técnica com exemplos",
        "Transforme meus requisitos em uma especificação",
      ],
    },
  };

function providerAllowed(provider: ProviderSummary, mode: RunMode): boolean {
  if (provider.health.status !== "ready") return false;
  if (mode === "chat" || mode === "agent")
    return provider.descriptor.kind === "cli" && provider.descriptor.supportsStructuredSessions;
  return provider.descriptor.supportsStructuredSessions || provider.descriptor.kind === "api";
}

export function ConversationPage({
  id,
  bootstrap,
  project,
}: {
  id: string;
  bootstrap: BootstrapPayload;
  project: Project;
}) {
  const queryClient = useQueryClient();
  const setView = useAppStore((state) => state.setView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api().getConversation(id),
    refetchInterval: (value) => {
      const detail = value.state.data;
      return detail?.messages.some((message) => message.status === "streaming") ? 2_000 : false;
    },
  });
  const detail = query.data;
  const [mode, setMode] = useState<RunMode>(
    detail?.conversation.mode ?? bootstrap.settings.defaultMode,
  );
  const [sessionKind, setSessionKind] = useState<SessionKind>(
    detail?.conversation.sessionKind ?? "structured",
  );
  const [providerId, setProviderId] = useState(detail?.conversation.providerId ?? "");
  const [providerConnectionId, setProviderConnectionId] = useState(
    detail?.conversation.providerConnectionId ?? "",
  );
  const [modelId, setModelId] = useState(detail?.conversation.modelId ?? "");
  const [effort, setEffort] = useState<Effort>("medium");
  const [workspaceRootId, setWorkspaceRootId] = useState(
    detail?.conversation.workspaceRootId ?? project.roots[0]?.id ?? "",
  );
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [modeMenu, setModeMenu] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const stickToBottom = useRef(true);

  const allowedProviders = bootstrap.providers.filter((provider) =>
    providerAllowed(provider, mode),
  );
  const selectedProvider =
    allowedProviders.find((provider) => provider.descriptor.id === providerId) ??
    allowedProviders[0];
  const selectedModel =
    selectedProvider?.models.find((model) => model.id === modelId) ??
    selectedProvider?.models.find((model) => model.isDefault) ??
    selectedProvider?.models[0];
  const availableConnections = bootstrap.providerConnections.filter(
    (item) =>
      item.connection.providerId === selectedProvider?.descriptor.id &&
      item.connection.enabled &&
      item.health.status === "ready",
  );
  const selectedConnection =
    availableConnections.find((item) => item.connection.id === providerConnectionId) ??
    availableConnections[0];

  useEffect(() => {
    if (!detail) return;
    setMode(detail.conversation.mode);
    setSessionKind(detail.conversation.sessionKind);
    setProviderId(detail.conversation.providerId ?? "");
    setProviderConnectionId(detail.conversation.providerConnectionId ?? "");
    setModelId(detail.conversation.modelId ?? "");
    setWorkspaceRootId(detail.conversation.workspaceRootId ?? project.roots[0]?.id ?? "");
  }, [detail?.conversation.id]);

  useEffect(() => {
    if (!selectedProvider) return;
    if (providerId !== selectedProvider.descriptor.id)
      setProviderId(selectedProvider.descriptor.id);
    if (selectedModel && modelId !== selectedModel.id) setModelId(selectedModel.id);
    if (selectedProvider.descriptor.kind === "cli") {
      if (selectedConnection && providerConnectionId !== selectedConnection.connection.id)
        setProviderConnectionId(selectedConnection.connection.id);
    } else if (providerConnectionId) setProviderConnectionId("");
    const efforts = selectedModel?.capabilities.reasoningEffort ?? [];
    if (efforts.length > 0 && !efforts.includes(effort))
      setEffort(efforts.includes("medium") ? "medium" : efforts[0]!);
  }, [mode, selectedProvider?.descriptor.id, selectedModel?.id, selectedConnection?.connection.id]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
      setShowJumpToBottom(false);
    }
  }, [detail?.messages, detail?.runs]);

  const latestRun = detail?.runs[0];
  const runQuery = useQuery({
    queryKey: ["run", latestRun?.id],
    queryFn: () => api().getRun(latestRun!.id),
    enabled: Boolean(latestRun),
    refetchInterval:
      latestRun && !["completed", "failed", "canceled"].includes(latestRun.state) ? 2_000 : false,
  });

  const send = useMutation({
    mutationFn: async () => {
      if (sessionKind === "pty") {
        setView({ type: "terminal" });
        return null;
      }
      if (!selectedProvider || !selectedModel)
        throw new Error("Nenhum provedor compatível está pronto.");
      return api().sendMessage({
        conversationId: id,
        content: content.trim(),
        mode,
        sessionKind,
        providerId: selectedProvider.descriptor.id,
        ...(selectedConnection ? { providerConnectionId: selectedConnection.connection.id } : {}),
        modelId: selectedModel.id,
        effort,
        workspaceRootId,
        attachmentPaths: attachments,
      });
    },
    onSuccess: (value) => {
      if (!value) return;
      queryClient.setQueryData(["conversation", id], (current: typeof detail) =>
        current
          ? {
              ...current,
              conversation: value.conversation,
              messages: [...current.messages, value.userMessage, value.assistantMessage],
              runs: value.run ? [value.run, ...current.runs] : current.runs,
            }
          : current,
      );
      setContent("");
      setAttachments([]);
      stickToBottom.current = true;
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
  });

  const chooseAttachments = async () => {
    const values = await api().selectAttachments();
    setAttachments((current) => [...new Set([...current, ...values])].slice(0, 20));
  };

  if (query.isError) return <ErrorPane error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !detail) return <LoadingPane />;
  const activeMode = modes.find((item) => item.id === mode)!;
  const emptyState = emptyStates[mode];
  const ActiveIcon = activeMode.icon;
  const canSend = Boolean(
    content.trim() &&
    workspaceRootId &&
    (sessionKind === "pty" ||
      (selectedProvider &&
        selectedModel &&
        (selectedProvider.descriptor.kind !== "cli" || selectedConnection))),
  );

  return (
    <div className="page-enter flex h-full min-w-0 flex-col bg-bg/45">
      <header className="flex min-h-[66px] shrink-0 items-center gap-3 border-b border-border bg-bg/75 px-4 py-2.5 md:px-5">
        <div className="grid size-9 place-items-center rounded-[10px] border border-primary/15 bg-primary/[0.07] text-primary-soft">
          <MessageCircle size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold text-text">
            {detail.conversation.title}
          </h1>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-text-faint">
            <span className="font-medium text-text-muted">{project.name}</span>
            <span>·</span>
            <span>{activeMode.label}</span>
            <span>·</span>
            <span>{selectedProvider?.descriptor.name ?? "Sem provedor"}</span>
            {selectedConnection ? (
              <>
                <span>·</span>
                <span>{selectedConnection.connection.name}</span>
              </>
            ) : null}
          </div>
        </div>
        {latestRun && !["completed", "failed", "canceled"].includes(latestRun.state) ? (
          <button
            className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-hover"
            onClick={() => setView({ type: "run", id: latestRun.id })}
          >
            <span className="size-1.5 animate-pulse rounded-full bg-info" />
            <span className="text-[11px] font-medium text-text-muted">
              {RUN_LABELS[latestRun.state]}
            </span>
            <ChevronRight size={12} className="text-text-faint" />
          </button>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
          stickToBottom.current = nearBottom;
          setShowJumpToBottom(!nearBottom);
        }}
      >
        <div className="mx-auto flex min-h-full max-w-[940px] flex-col px-5 py-7 md:px-7">
          {detail.messages.length === 0 ? (
            <div className="my-auto flex flex-col items-center py-12 text-center">
              <div className="relative grid size-16 place-items-center rounded-[19px] border border-primary/20 bg-primary/[0.08] text-primary-soft shadow-[0_16px_50px_rgb(91_88_210/0.12)]">
                <BrainCircuit size={27} />
                <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-bg bg-success" />
              </div>
              <div className="mt-4 rounded-full border border-border bg-surface px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                Modo {activeMode.label}
              </div>
              <h2 className="mt-4 text-[21px] font-semibold tracking-[-0.025em]">
                {emptyState.title}
              </h2>
              <p className="mt-2 max-w-lg text-[13px] leading-5 text-text-muted">
                {emptyState.description}
              </p>
              <div className="mt-7 grid w-full max-w-2xl gap-2 sm:grid-cols-3">
                {emptyState.suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    className="group rounded-[12px] border border-border bg-surface p-3.5 text-left text-[11px] leading-4 text-text-muted transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/[0.035] hover:text-text"
                    onClick={() => setContent(suggestion)}
                  >
                    <span className="mb-2 grid size-6 place-items-center rounded-[7px] bg-bg-elevated text-[9px] font-semibold text-primary-soft group-hover:bg-primary/10">
                      {index + 1}
                    </span>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageList messages={detail.messages} />
          )}

          {runQuery.data?.run.state === "awaiting_approval" ? (
            <div className="mt-6">
              <PlanApprovalCard detail={runQuery.data} providers={bootstrap.providers} />
            </div>
          ) : null}
          {runQuery.data &&
          ["queued", "running", "validating", "integrating"].includes(runQuery.data.run.state) ? (
            <button
              className="mt-6 rounded-[12px] border border-info/20 bg-info/[0.035] p-4 text-left hover:border-info/35"
              onClick={() => setView({ type: "run", id: runQuery.data.run.id })}
            >
              <div className="flex items-center gap-3">
                <div className="grid size-8 place-items-center rounded-[8px] bg-info/10 text-info">
                  <Bot size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-text">Execução em andamento</div>
                  <div className="mt-1 text-[10px] text-text-faint">
                    {runQuery.data.tasks.filter((task) => task.state === "completed").length}/
                    {runQuery.data.tasks.length} tarefas concluídas
                  </div>
                </div>
                <Badge tone={stateTone(runQuery.data.run.state)}>
                  {RUN_LABELS[runQuery.data.run.state]}
                </Badge>
                <ArrowRight size={13} className="text-text-faint" />
              </div>
              <div className="mt-4">
                <AgentPipeline state={runQuery.data.run.state} />
              </div>
            </button>
          ) : null}
        </div>
        {showJumpToBottom ? (
          <button
            className="sticky bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-strong bg-surface-raised px-3 py-1.5 text-[10px] font-medium text-text-muted shadow-xl hover:text-text"
            onClick={() => {
              const element = scrollRef.current;
              if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
              stickToBottom.current = true;
              setShowJumpToBottom(false);
            }}
          >
            <ArrowDown size={12} /> Ir para o fim
          </button>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur-xl md:px-5">
        <div className="mx-auto max-w-[940px]">
          <div className="relative mb-2 flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                className="flex h-9 items-center gap-2 rounded-[9px] border border-border bg-surface px-3 text-[11px] font-semibold text-text transition-colors hover:border-border-strong hover:bg-surface-hover"
                onClick={() => {
                  setModeMenu((value) => !value);
                  setConfigurationOpen(false);
                }}
                aria-label={`Modo atual: ${activeMode.label}`}
                aria-expanded={modeMenu}
              >
                <ActiveIcon
                  size={13}
                  className={
                    mode === "maestro"
                      ? "text-primary-soft"
                      : mode === "agent"
                        ? "text-info"
                        : "text-success"
                  }
                />
                {activeMode.label}
                <ChevronDown
                  size={11}
                  className={cn("text-text-faint transition-transform", modeMenu && "rotate-180")}
                />
              </button>
              {modeMenu ? (
                <div className="glass-popover absolute bottom-11 left-0 z-40 w-80 rounded-[13px] p-1.5">
                  <div className="px-2.5 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                    Como o Maestro deve trabalhar?
                  </div>
                  {modes.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-[9px] p-2.5 text-left transition-colors hover:bg-surface-hover",
                          mode === item.id && "bg-primary/[0.09]",
                        )}
                        onClick={() => {
                          setMode(item.id);
                          setSessionKind("structured");
                          setModeMenu(false);
                        }}
                      >
                        <div className="mt-0.5 grid size-8 place-items-center rounded-[8px] border border-border bg-bg-elevated text-text-muted">
                          <Icon size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold text-text">{item.label}</div>
                          <div className="mt-0.5 text-[10px] leading-4 text-text-faint">
                            {item.description}
                          </div>
                        </div>
                        {mode === item.id ? (
                          <span className="mt-2 size-1.5 rounded-full bg-primary" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              className={cn(
                "flex h-9 min-w-0 items-center gap-2 rounded-[9px] border bg-surface px-3 text-[10px] text-text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text",
                configurationOpen ? "border-primary/40 bg-primary/[0.06]" : "border-border",
              )}
              onClick={() => {
                setConfigurationOpen((value) => !value);
                setModeMenu(false);
              }}
              aria-expanded={configurationOpen}
            >
              <Settings2 size={12} />
              <span className="max-w-72 truncate">
                {sessionKind === "pty"
                  ? "Terminal interativo"
                  : selectedProvider && selectedModel
                    ? `${selectedProvider.descriptor.name} · ${selectedModel.name}`
                    : "Configurar execução"}
              </span>
              <ChevronDown
                size={11}
                className={cn(
                  "text-text-faint transition-transform",
                  configurationOpen && "rotate-180",
                )}
              />
            </button>

            <div className="ml-auto flex h-9 items-center gap-2 rounded-[9px] border border-border/75 bg-bg-elevated/70 px-3 text-[10px] text-text-faint">
              {mode === "chat" ? <LockKeyhole size={11} /> : <Shield size={11} />}
              <span className="hidden sm:inline">
                {mode === "maestro"
                  ? "Escrita só após aprovação"
                  : mode === "chat"
                    ? "Sem acesso ao workspace"
                    : "Permissões do projeto"}
              </span>
              <span className="sm:hidden">Protegido</span>
            </div>

            {configurationOpen ? (
              <section className="glass-popover absolute bottom-11 left-0 right-0 z-30 rounded-[15px] p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[13px] font-semibold text-text">
                      Configuração da execução
                    </h3>
                    <p className="mt-1 text-[10px] text-text-faint">
                      Ajuste o contexto e o modelo somente quando precisar.
                    </p>
                  </div>
                  <button
                    className="grid size-7 place-items-center rounded-[7px] text-text-faint hover:bg-surface-hover hover:text-text"
                    onClick={() => setConfigurationOpen(false)}
                    aria-label="Fechar configurações da execução"
                  >
                    <X size={13} />
                  </button>
                </div>

                {mode === "agent" ? (
                  <div className="mb-4">
                    <div className="mb-1.5 text-[10px] font-semibold text-text-muted">
                      Tipo de sessão
                    </div>
                    <div className="inline-flex rounded-[9px] border border-border bg-bg-elevated p-1">
                      <button
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[10px] text-text-faint",
                          sessionKind === "structured" && "bg-surface-hover font-medium text-text",
                        )}
                        onClick={() => setSessionKind("structured")}
                      >
                        <Bot size={11} /> Estruturada
                      </button>
                      <button
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-[10px] text-text-faint",
                          sessionKind === "pty" && "bg-surface-hover font-medium text-text",
                        )}
                        onClick={() => setSessionKind("pty")}
                      >
                        <SquareTerminal size={11} /> Terminal PTY
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {mode !== "chat" ? (
                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
                        <Folder size={11} /> Pasta de trabalho
                      </span>
                      <Select
                        className="w-full"
                        value={workspaceRootId}
                        onChange={(event) => setWorkspaceRootId(event.target.value)}
                        aria-label="Pasta de trabalho"
                      >
                        {project.roots.map((root) => (
                          <option key={root.id} value={root.id}>
                            {root.displayName}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : (
                    <div className="flex min-h-[62px] items-center gap-2 rounded-[10px] border border-success/15 bg-success/[0.04] px-3 text-[10px] text-text-muted">
                      <LockKeyhole size={13} className="shrink-0 text-success" />
                      Sem acesso ao workspace
                    </div>
                  )}

                  {sessionKind === "structured" ? (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">
                          Provedor
                        </span>
                        <Select
                          className="w-full"
                          value={selectedProvider?.descriptor.id ?? ""}
                          onChange={(event) => {
                            setProviderId(event.target.value);
                            setProviderConnectionId("");
                            setModelId("");
                          }}
                          aria-label="Provedor"
                        >
                          {allowedProviders.length ? (
                            allowedProviders.map((provider) => (
                              <option key={provider.descriptor.id} value={provider.descriptor.id}>
                                {provider.descriptor.name}
                              </option>
                            ))
                          ) : (
                            <option value="">Nenhum provedor pronto</option>
                          )}
                        </Select>
                      </label>
                      {selectedProvider?.descriptor.kind === "cli" ? (
                        <label className="block">
                          <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">
                            Conta
                          </span>
                          <Select
                            className="w-full"
                            value={selectedConnection?.connection.id ?? ""}
                            onChange={(event) => setProviderConnectionId(event.target.value)}
                            aria-label="Conta por assinatura"
                          >
                            {availableConnections.length ? (
                              availableConnections.map((account) => (
                                <option key={account.connection.id} value={account.connection.id}>
                                  {account.connection.name}
                                </option>
                              ))
                            ) : (
                              <option value="">Nenhuma conta conectada</option>
                            )}
                          </Select>
                        </label>
                      ) : null}
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">
                          Modelo
                        </span>
                        <Select
                          className="w-full"
                          value={selectedModel?.id ?? ""}
                          onChange={(event) => setModelId(event.target.value)}
                          aria-label="Modelo"
                        >
                          {(selectedProvider?.models ?? []).map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                        </Select>
                      </label>
                      {(selectedModel?.capabilities.reasoningEffort.length ?? 0) > 0 ? (
                        <label className="block">
                          <span className="mb-1.5 block text-[10px] font-semibold text-text-muted">
                            Esforço
                          </span>
                          <Select
                            className="w-full"
                            value={effort}
                            onChange={(event) => setEffort(event.target.value as Effort)}
                            aria-label="Nível de esforço"
                          >
                            {selectedModel!.capabilities.reasoningEffort.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ) : null}
                      {selectedProvider?.descriptor.kind === "api" ? (
                        <div className="flex items-end pb-1">
                          <Badge tone="warning">API · somente orquestrador</Badge>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>

          <div className="composer-card p-2">
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-b border-border/70 px-1 pb-2">
                {attachments.map((attachment) => (
                  <span
                    key={attachment}
                    className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-bg-elevated px-2 py-1 text-[10px] text-text-muted"
                    title={attachment}
                  >
                    <Paperclip size={10} />
                    {attachment.split(/[\\/]/).at(-1)}
                    <button
                      aria-label="Remover anexo"
                      onClick={() =>
                        setAttachments((values) => values.filter((value) => value !== attachment))
                      }
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Textarea
              className="min-h-[68px] max-h-44 border-0 bg-transparent px-2.5 py-2.5 text-[14px] focus:bg-transparent focus:ring-0"
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={
                sessionKind === "pty"
                  ? "Abra um terminal completo nesta raiz…"
                  : mode === "maestro"
                    ? "Descreva o resultado que você quer…"
                    : mode === "agent"
                      ? "Peça uma alteração direta no workspace…"
                      : "Escreva uma mensagem…"
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && canSend && !send.isPending) {
                  event.preventDefault();
                  send.mutate();
                }
              }}
            />
            <div className="flex items-center gap-1 px-1 pt-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Adicionar anexos"
                title="Adicionar anexos"
                onClick={() => void chooseAttachments()}
              >
                <Paperclip size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Configurações da execução"
                title="Configurações da execução"
                className={configurationOpen ? "bg-primary/10 text-primary-soft" : undefined}
                onClick={() => {
                  setConfigurationOpen((value) => !value);
                  setModeMenu(false);
                }}
              >
                <Settings2 size={14} />
              </Button>
              <span className="ml-1 hidden text-[10px] text-text-faint sm:inline">
                Enter envia · Shift Enter quebra linha
              </span>
              <Button
                className="ml-auto"
                size="md"
                disabled={!canSend || send.isPending}
                onClick={() => send.mutate()}
              >
                {sessionKind === "pty" ? <SquareTerminal size={14} /> : <Send size={14} />}
                {send.isPending ? "Enviando…" : sessionKind === "pty" ? "Abrir terminal" : "Enviar"}
              </Button>
            </div>
          </div>
          {send.error ? (
            <p
              className="mt-2 rounded-[9px] border border-danger/15 bg-danger/[0.045] px-3 py-2 text-[11px] text-danger"
              role="alert"
            >
              {send.error instanceof Error ? send.error.message : String(send.error)}
            </p>
          ) : null}
          {!selectedProvider && sessionKind === "structured" ? (
            <button
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[9px] py-1.5 text-[11px] font-medium text-warning hover:bg-warning/[0.05] hover:text-text"
              onClick={() => setView({ type: "settings" })}
            >
              <Settings2 size={11} />
              Configure um provedor compatível para continuar
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
