import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Bot,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  FileUp,
  FileVideo,
  Folder,
  FolderOpen,
  Gauge,
  LockKeyhole,
  LoaderCircle,
  MessageCircle,
  Mic,
  Paperclip,
  Send,
  Settings2,
  Shield,
  Sparkles,
  SquareTerminal,
  Zap,
  X,
} from "lucide-react";
import type {
  BootstrapPayload,
  ContextAssetSummary,
  ContextProcessingEvent,
  Effort,
  LocalModelPackageState,
  Project,
  ProviderSummary,
  RunEvent,
  RunMode,
  SessionKind,
  StructuredQuestionAnswer,
  WorkspaceContextCandidate,
} from "@maestro/contracts";
import { api, getAllRunEvents } from "@renderer/lib/api";
import { cn, RUN_LABELS, stateTone } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/app-store";
import { Button } from "@renderer/components/ui/button";
import { Badge } from "@renderer/components/ui/badge";
import { Select } from "@renderer/components/ui/form";
import { LoadingPane } from "@renderer/components/ui/skeleton";
import { ErrorPane } from "@renderer/components/ui/feedback";
import { SuggestedActions } from "@renderer/components/ui/suggested-actions";
import { MessageList } from "@renderer/components/conversation/message-list";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "@renderer/components/conversation/composer-editor";
import { ContextAssetTray } from "@renderer/components/conversation/context-asset-tray";
import { AudioRecorder } from "@renderer/components/conversation/audio-recorder";
import { PlanApprovalCard } from "@renderer/components/conversation/plan-approval";
import { MaestroProcess } from "@renderer/components/conversation/maestro-process";
import {
  FastModelSwitcher,
  type FastModelSelection,
} from "@renderer/components/conversation/fast-model-switcher";
import { AgentPipeline } from "@renderer/components/operations/agent-pipeline";

const modes: Array<{ id: RunMode; label: string; description: string; icon: typeof Sparkles }> = [
  {
    id: "maestro",
    label: "Maestro",
    description: "Entende com você, pesquisa, planeja e coordena",
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

const MAX_COMPOSER_CONTEXT_BYTES = 4 * 1024 * 1024 * 1024;

function fallbackContextWindow(): number {
  return 128_000;
}

function compactTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

const emptyStates: Record<RunMode, { title: string; description: string; suggestions: string[] }> =
  {
    maestro: {
      title: "O que vamos construir?",
      description:
        "Descreva o resultado. O Maestro estuda o contexto, tira dúvidas com você, resume o entendimento e só então cria um plano revisável.",
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
        "Converse sem acesso geral ao workspace. O modelo recebe somente os itens anexados ou mencionados com @.",
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
    return provider.descriptor.kind === "api" || provider.descriptor.supportsStructuredSessions;
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
  const liveEvents = useAppStore((state) => state.recentEvents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerEditorHandle>(null);
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
  const [contextAssets, setContextAssets] = useState<ContextAssetSummary[]>([]);
  const contextAssetsRef = useRef<ContextAssetSummary[]>([]);
  const [contextProgress, setContextProgress] = useState<Map<string, ContextProcessingEvent>>(
    new Map(),
  );
  const [contextError, setContextError] = useState<string | null>(null);
  const [attachmentMenu, setAttachmentMenu] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [stagingCount, setStagingCount] = useState(0);
  const [localModel, setLocalModel] = useState<LocalModelPackageState | null>(null);
  const [modeMenu, setModeMenu] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [fastModelOpen, setFastModelOpen] = useState(false);
  const [automaticRouting, setAutomaticRouting] = useState(
    () => window.localStorage.getItem(`maestro.routing-mode:${id}`) !== "manual",
  );
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const stickToBottom = useRef(true);

  const allowedProviders = bootstrap.providers.filter((provider) =>
    providerAllowed(provider, mode),
  );
  const selectedProvider =
    allowedProviders.find((provider) => provider.descriptor.id === providerId) ??
    allowedProviders[0];
  const availableConnections = bootstrap.providerConnections.filter(
    (item) =>
      item.connection.providerId === selectedProvider?.descriptor.id &&
      item.connection.enabled &&
      item.health.status === "ready",
  );
  const selectedConnection =
    availableConnections.find((item) => item.connection.id === providerConnectionId) ??
    availableConnections[0];
  const selectableModels =
    selectedConnection && selectedConnection.models.length > 0
      ? selectedConnection.models
      : (selectedProvider?.models ?? []);
  const selectedModel =
    selectableModels.find((model) => model.id === modelId) ??
    selectableModels.find((model) => model.isDefault) ??
    selectableModels[0];

  contextAssetsRef.current = contextAssets;

  const addContextAssets = useCallback(
    (values: ContextAssetSummary[]) => {
      setContextError(null);
      const current = contextAssetsRef.current;
      const currentIds = new Set(current.map((asset) => asset.id));
      const byId = new Map(current.map((asset) => [asset.id, asset]));
      values.forEach((asset) => byId.set(asset.id, asset));
      const merged = [...byId.values()];
      const next: ContextAssetSummary[] = [];
      const overflow: ContextAssetSummary[] = [];
      let totalBytes = 0;
      for (const asset of merged) {
        if (next.length >= 20 || totalBytes + asset.size > MAX_COMPOSER_CONTEXT_BYTES) {
          overflow.push(asset);
          continue;
        }
        next.push(asset);
        totalBytes += asset.size;
      }
      contextAssetsRef.current = next;
      setContextAssets(next);
      if (overflow.length > 0) {
        setContextError(
          merged.length > 20
            ? "Use no máximo 20 itens por mensagem. Refine a seleção."
            : "Os itens somam mais de 4 GiB. Remova alguns anexos.",
        );
        void Promise.allSettled(
          overflow
            .filter((asset) => !currentIds.has(asset.id))
            .map((asset) => api().removeContextAsset(id, asset.id)),
        );
      }
    },
    [id],
  );

  const stageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setStagingCount((value) => value + 1);
      try {
        addContextAssets(await api().stageDroppedFiles(id, files));
      } catch (error) {
        setContextError(error instanceof Error ? error.message : String(error));
      } finally {
        setStagingCount((value) => Math.max(0, value - 1));
      }
    },
    [addContextAssets, id],
  );

  const searchWorkspace = useCallback(
    (query: string) => api().searchWorkspaceContext({ projectId: project.id, query, limit: 12 }),
    [project.id],
  );

  const addWorkspaceMention = useCallback(
    (candidate: WorkspaceContextCandidate) => {
      setStagingCount((value) => value + 1);
      void api()
        .prepareWorkspaceContext({
          conversationId: id,
          candidates: [
            {
              workspaceRootId: candidate.workspaceRootId,
              relativePath: candidate.relativePath,
              kind: candidate.kind,
            },
          ],
        })
        .then(addContextAssets)
        .catch((error: unknown) =>
          setContextError(error instanceof Error ? error.message : String(error)),
        )
        .finally(() => setStagingCount((value) => Math.max(0, value - 1)));
    },
    [addContextAssets, id],
  );

  useEffect(() => {
    const disposeContext = api().onContextProcessing((event) => {
      if (event.conversationId !== id) return;
      setContextProgress((current) => new Map(current).set(event.asset.id, event));
      setContextAssets((current) => {
        const next = current.map((asset) => (asset.id === event.asset.id ? event.asset : asset));
        contextAssetsRef.current = next;
        return next;
      });
    });
    const disposeModel = api().onLocalModelState(setLocalModel);
    void api().getLocalModelState().then(setLocalModel);
    return () => {
      disposeContext();
      disposeModel();
    };
  }, [id]);

  useEffect(() => {
    if (
      localModel?.status !== "ready" ||
      !contextAssets.some((asset) => asset.status === "needs_model")
    )
      return;
    const selectedIds = new Set(contextAssets.map((asset) => asset.id));
    void api()
      .listContextAssets(id)
      .then((assets) =>
        setContextAssets((current) => {
          const refreshed = new Map(
            assets.filter((asset) => selectedIds.has(asset.id)).map((asset) => [asset.id, asset]),
          );
          const next = current.map((asset) => refreshed.get(asset.id) ?? asset);
          contextAssetsRef.current = next;
          return next;
        }),
      )
      .catch((error: unknown) =>
        setContextError(error instanceof Error ? error.message : String(error)),
      );
  }, [contextAssets, id, localModel?.status]);

  const processingContextKey = contextAssets
    .filter((asset) => asset.status === "staging" || asset.status === "processing")
    .map((asset) => asset.id)
    .sort()
    .join(":");
  useEffect(() => {
    if (!processingContextKey) return;
    let active = true;
    const refresh = () => {
      void api()
        .listContextAssets(id)
        .then((assets) => {
          if (!active) return;
          const byId = new Map(assets.map((asset) => [asset.id, asset]));
          setContextAssets((current) => {
            const next = current.map((asset) => byId.get(asset.id) ?? asset);
            contextAssetsRef.current = next;
            return next;
          });
        })
        .catch(() => null);
    };
    refresh();
    const interval = window.setInterval(refresh, 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [id, processingContextKey]);

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
    window.localStorage.setItem(`maestro.routing-mode:${id}`, automaticRouting ? "auto" : "manual");
  }, [automaticRouting, id]);

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
    if (element && stickToBottom.current && (detail?.messages.length ?? 0) > 0) {
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
  const runEventsQuery = useQuery({
    queryKey: ["run-events", latestRun?.id],
    queryFn: () => getAllRunEvents(latestRun!.id),
    enabled: Boolean(latestRun),
    refetchInterval:
      latestRun && !["completed", "failed", "canceled"].includes(latestRun.state) ? 3_000 : false,
  });
  const processEvents = useMemo(() => {
    if (!latestRun) return [];
    const byId = new Map<string, RunEvent>();
    for (const event of runEventsQuery.data?.events ?? []) byId.set(event.id, event);
    for (const event of liveEvents) {
      if (event.runId === latestRun.id) byId.set(event.id, event);
    }
    return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
  }, [latestRun?.id, liveEvents, runEventsQuery.data?.events]);
  const awaitingClarification = runQuery.data?.run.state === "awaiting_clarification";
  const activeRunForSwitch = runQuery.data
    ? !["completed", "failed", "canceled"].includes(runQuery.data.run.state)
    : false;
  const modelSelectionLocked = false;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "m" ||
        !event.shiftKey ||
        (!event.ctrlKey && !event.metaKey) ||
        sessionKind !== "structured" ||
        modelSelectionLocked
      )
        return;
      event.preventDefault();
      setFastModelOpen((value) => !value);
      setConfigurationOpen(false);
      setModeMenu(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modelSelectionLocked, sessionKind]);

  const send = useMutation({
    mutationFn: async () => {
      if (sessionKind === "pty") {
        setView({ type: "terminal" });
        return null;
      }
      const forkCommand = content.trim().match(/^\/fork\b\s*(.*)$/i);
      if (mode === "maestro" && forkCommand) {
        const fork = await api().forkConversation({
          conversationId: id,
          ...(forkCommand[1]?.trim() ? { title: forkCommand[1].trim() } : {}),
        });
        setContent("");
        setView({ type: "conversation", id: fork.id });
        void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        return null;
      }
      if (!selectedProvider || !selectedModel)
        throw new Error("Nenhum provedor compatível está pronto.");
      return api().sendMessage({
        conversationId: id,
        content: content.trim(),
        mode: awaitingClarification ? "maestro" : mode,
        sessionKind,
        providerId: selectedProvider.descriptor.id,
        ...(selectedConnection ? { providerConnectionId: selectedConnection.connection.id } : {}),
        modelId: selectedModel.id,
        effort,
        workspaceRootId: awaitingClarification
          ? runQuery.data!.run.spec.workspaceRootIds[0]!
          : workspaceRootId,
        contextItems: contextAssets.map((asset) => ({ type: "asset" as const, assetId: asset.id })),
        ...(mode === "maestro"
          ? {
              modelPreference: {
                mode: automaticRouting ? ("auto" as const) : ("manual" as const),
                profile: bootstrap.settings.defaultRoutingProfile,
                pin: automaticRouting
                  ? null
                  : {
                      providerId: selectedProvider.descriptor.id,
                      ...(selectedConnection
                        ? { connectionId: selectedConnection.connection.id }
                        : {}),
                      modelId: selectedModel.id,
                      effort,
                    },
                noFallback: bootstrap.settings.noFallback,
              },
            }
          : {}),
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
              runs: value.run
                ? [value.run, ...current.runs.filter((run) => run.id !== value.run?.id)]
                : current.runs,
            }
          : current,
      );
      setContent("");
      contextAssetsRef.current = [];
      setContextAssets([]);
      setContextProgress(new Map());
      setContextError(null);
      stickToBottom.current = true;
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
  });

  const answerQuestions = useMutation({
    mutationFn: (answers: StructuredQuestionAnswer[]) => {
      if (!runQuery.data) throw new Error("Execução não encontrada.");
      return api().answerQuestions({ runId: runQuery.data.run.id, answers });
    },
    onSuccess: (value) => {
      queryClient.setQueryData(["run", value.run.id], value);
      void queryClient.invalidateQueries({ queryKey: ["conversation", id] });
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      stickToBottom.current = true;
    },
  });

  const chooseAttachments = async (kind: "files" | "folder" | "clipboard") => {
    setAttachmentMenu(false);
    setContextError(null);
    setStagingCount((value) => value + 1);
    try {
      const values =
        kind === "files"
          ? await api().selectContextFiles(id)
          : kind === "folder"
            ? await api().selectContextFolder(id)
            : await api().stageClipboard(id);
      addContextAssets(values);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : String(error));
    } finally {
      setStagingCount((value) => Math.max(0, value - 1));
    }
  };

  const removeContextAsset = async (asset: ContextAssetSummary) => {
    setContextAssets((current) => {
      const next = current.filter((item) => item.id !== asset.id);
      contextAssetsRef.current = next;
      return next;
    });
    setContextProgress((current) => {
      const next = new Map(current);
      next.delete(asset.id);
      return next;
    });
    try {
      await api().removeContextAsset(id, asset.id);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : String(error));
    }
  };

  if (query.isError) return <ErrorPane error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !detail) return <LoadingPane />;
  const activeMode = modes.find((item) => item.id === mode)!;
  const emptyState = emptyStates[mode];
  const ActiveIcon = activeMode.icon;
  const contextReady = contextAssets.every((asset) => asset.status === "ready");
  const visionBlocked = Boolean(
    selectedModel &&
    !selectedModel.capabilities.vision &&
    contextAssets.some((asset) => asset.requiresVision),
  );
  const videoFramesOmitted = Boolean(
    selectedModel &&
    !selectedModel.capabilities.vision &&
    contextAssets.some((asset) => asset.kind === "video"),
  );
  const canSend = Boolean(
    (sessionKind === "pty" ? content.trim() : content.trim() || contextAssets.length > 0) &&
    workspaceRootId &&
    (sessionKind === "pty" || (contextReady && !visionBlocked)) &&
    stagingCount === 0 &&
    !recorderOpen &&
    (sessionKind === "pty" ||
      (selectedProvider &&
        selectedModel &&
        (selectedProvider.descriptor.kind !== "cli" || selectedConnection))),
  );
  const currentFastSelection: FastModelSelection | null =
    selectedProvider && selectedModel && (mode !== "maestro" || !automaticRouting)
      ? {
          providerId: selectedProvider.descriptor.id,
          modelId: selectedModel.id,
          ...(selectedConnection ? { connectionId: selectedConnection.connection.id } : {}),
        }
      : null;
  const modelContextWindow =
    selectedProvider && selectedModel
      ? (selectedModel.capabilities.contextWindow ?? fallbackContextWindow())
      : 128_000;
  const estimatedConversationTokens = Math.ceil(
    (detail.messages.reduce((total, message) => total + message.content.length, 0) +
      content.length +
      contextAssets.reduce((total, asset) => total + (asset.transcription?.length ?? 0), 0)) /
      4,
  );
  const contextReserve = Math.min(16_000, Math.max(256, Math.floor(modelContextWindow * 0.15)));
  const usableContextTokens = Math.max(1, modelContextWindow - contextReserve);
  const contextUsagePercent = Math.min(
    100,
    Math.round((estimatedConversationTokens / usableContextTokens) * 100),
  );
  const pendingModelSwitch = Boolean(
    detail.messages.some((message) => message.status === "completed") &&
    (mode !== "maestro" || !automaticRouting) &&
    selectedProvider &&
    selectedModel &&
    detail.conversation.providerId &&
    detail.conversation.modelId &&
    (detail.conversation.providerId !== selectedProvider.descriptor.id ||
      detail.conversation.providerConnectionId !== (selectedConnection?.connection.id ?? null) ||
      detail.conversation.modelId !== selectedModel.id),
  );
  const persistedProvider = bootstrap.providers.find(
    (provider) => provider.descriptor.id === detail.conversation.providerId,
  );
  const persistedModel = persistedProvider?.models.find(
    (model) => model.id === detail.conversation.modelId,
  );
  const optimizationLabel =
    bootstrap.settings.tokenOptimizationMode === "balanced"
      ? "balanceada"
      : bootstrap.settings.tokenOptimizationMode === "aggressive"
        ? "agressiva"
        : "desativada";

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
            onClick={() => {
              if (latestRun.state === "awaiting_clarification") {
                const element = scrollRef.current;
                if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
                window.requestAnimationFrame(() => composerRef.current?.focus());
                return;
              }
              setView({ type: "run", id: latestRun.id });
            }}
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
            <div className="conversation-empty my-auto flex flex-col items-center py-12 text-center">
              <div className="conversation-empty-mark relative grid size-16 place-items-center rounded-[20px] border border-primary/25 bg-primary/[0.09] text-primary-soft shadow-[0_18px_48px_-22px_rgb(251_65_55/0.58)]">
                <BrainCircuit size={27} />
                <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-bg bg-success" />
              </div>
              <div className="conversation-empty-mode mt-4 rounded-full border border-border bg-surface px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                Modo {activeMode.label}
              </div>
              <h2 className="conversation-empty-title mt-4 text-[21px] font-semibold tracking-[-0.025em]">
                {emptyState.title}
              </h2>
              <p className="mt-2 max-w-lg text-[13px] leading-5 text-text-muted">
                {emptyState.description}
              </p>
              <SuggestedActions
                className="conversation-suggestions mt-7 w-full max-w-2xl"
                suggestions={emptyState.suggestions}
                onSelect={(suggestion) => {
                  setContent(suggestion);
                  window.requestAnimationFrame(() => composerRef.current?.focus());
                }}
              />
            </div>
          ) : (
            <MessageList messages={detail.messages} />
          )}

          {runQuery.data?.run.mode === "maestro" ? (
            <MaestroProcess
              detail={runQuery.data}
              events={processEvents}
              onUseAnswer={(answer) => {
                setContent((current) =>
                  current.trim() ? `${current.trim()}\n\n${answer}` : answer,
                );
                window.requestAnimationFrame(() => composerRef.current?.focus());
              }}
              onAnswerQuestions={(answers) => answerQuestions.mutate(answers)}
            />
          ) : null}

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
                  setFastModelOpen(false);
                }}
                disabled={awaitingClarification}
                title={
                  awaitingClarification
                    ? "Responda às dúvidas antes de trocar o modo desta conversa."
                    : undefined
                }
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
                          if (item.id === "maestro" && mode !== "maestro")
                            setAutomaticRouting(true);
                          setSessionKind("structured");
                          setModeMenu(false);
                          setFastModelOpen(false);
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
                fastModelOpen ? "border-primary/40 bg-primary/[0.06]" : "border-border",
              )}
              onClick={() => {
                setFastModelOpen(true);
                setConfigurationOpen(false);
                setModeMenu(false);
              }}
              disabled={sessionKind !== "structured" || modelSelectionLocked}
              title="Troca rápida de modelo · Ctrl/Cmd + Shift + M"
              aria-label={`Troca rápida de modelo${selectedModel ? `: ${selectedModel.name}` : ""}`}
              aria-expanded={fastModelOpen}
            >
              <Zap size={12} className="text-primary-soft" />
              <span className="max-w-72 truncate">
                {sessionKind === "pty"
                  ? "Terminal interativo"
                  : selectedProvider && selectedModel
                    ? `${mode === "maestro" && automaticRouting ? "Auto · " : ""}${selectedProvider.descriptor.name} · ${selectedModel.name}`
                    : "Configurar execução"}
              </span>
              <ChevronDown
                size={11}
                className={cn(
                  "text-text-faint transition-transform",
                  fastModelOpen && "rotate-180",
                )}
              />
            </button>

            <div
              className="hidden h-9 items-center gap-2 rounded-[9px] border border-border/75 bg-bg-elevated/70 px-3 text-[9.5px] text-text-faint md:flex"
              title={`Estimativa local: ${estimatedConversationTokens.toLocaleString("pt-BR")} tokens de conversa, ${contextUsagePercent}% da janela útil. Otimização ${optimizationLabel}.`}
            >
              <Gauge size={11} />
              <span>~{compactTokenCount(estimatedConversationTokens)}</span>
              <span className="text-border-strong">·</span>
              <span>{optimizationLabel}</span>
            </div>

            <div className="ml-auto flex h-9 items-center gap-2 rounded-[9px] border border-border/75 bg-bg-elevated/70 px-3 text-[10px] text-text-faint">
              {mode === "chat" ? <LockKeyhole size={11} /> : <Shield size={11} />}
              <span className="hidden sm:inline">
                {mode === "maestro"
                  ? "Escrita só após aprovação"
                  : mode === "chat"
                    ? "Sem acesso ao workspace · somente contexto anexado"
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
                      Sem acesso ao workspace; somente anexos e menções @
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
                            if (mode === "maestro") setAutomaticRouting(false);
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
                            onChange={(event) => {
                              if (mode === "maestro") setAutomaticRouting(false);
                              setProviderConnectionId(event.target.value);
                            }}
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
                          onChange={(event) => {
                            if (mode === "maestro") setAutomaticRouting(false);
                            setModelId(event.target.value);
                          }}
                          aria-label="Modelo"
                        >
                          {selectableModels.map((model) => (
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
                            onChange={(event) => {
                              if (mode === "maestro") setAutomaticRouting(false);
                              setEffort(event.target.value as Effort);
                            }}
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
                          <Badge tone="warning">API · loop de ferramentas Maestro</Badge>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>

          {pendingModelSwitch && selectedProvider && selectedModel ? (
            <button
              type="button"
              className="mb-2 flex w-full items-center gap-2.5 rounded-[10px] border border-primary/20 bg-primary/[0.055] px-3 py-2 text-left"
              onClick={() => setFastModelOpen(true)}
              aria-label="Revisar troca de modelo preparada"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-primary/10 text-primary-soft">
                <Zap size={12} />
              </span>
              <span className="min-w-0 flex-1 text-[10px] leading-4 text-text-muted">
                <strong className="font-semibold text-text">Troca preparada:</strong>{" "}
                {persistedProvider?.descriptor.name ?? detail.conversation.providerId}/
                {persistedModel?.name ?? detail.conversation.modelId} →{" "}
                {selectedProvider.descriptor.name}/{selectedModel.name}. Na próxima mensagem,
                decisões, progresso e referências seguem em um handoff local.
              </span>
              <span className="hidden rounded-full border border-primary/20 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-primary-soft sm:inline">
                fast-switch
              </span>
            </button>
          ) : null}

          <div
            className={cn("composer-card relative p-2", dropActive && "is-drop-active")}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                setDropActive(true);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) event.preventDefault();
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDropActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropActive(false);
              void stageFiles(Array.from(event.dataTransfer.files));
            }}
          >
            {dropActive ? <div className="composer-drop-overlay">Solte para anexar</div> : null}
            <ContextAssetTray
              assets={contextAssets}
              progress={contextProgress}
              onRemove={(asset) => void removeContextAsset(asset)}
            />
            {recorderOpen ? (
              <AudioRecorder
                onClose={() => setRecorderOpen(false)}
                onSave={async (data, mimeType, durationMs) => {
                  addContextAssets([
                    await api().stageRecordedAudio({
                      conversationId: id,
                      data,
                      mimeType,
                      durationMs,
                    }),
                  ]);
                }}
              />
            ) : null}
            <ComposerEditor
              ref={composerRef}
              value={content}
              onChange={setContent}
              onSubmit={() => {
                if (canSend && !send.isPending) send.mutate();
              }}
              searchWorkspace={searchWorkspace}
              onMention={addWorkspaceMention}
              onPasteFiles={(files) => void stageFiles(files)}
              placeholder={
                sessionKind === "pty"
                  ? "Abra um terminal completo nesta raiz…"
                  : awaitingClarification
                    ? "Responda às dúvidas do Maestro…"
                    : mode === "maestro"
                      ? "Descreva o resultado que você quer…"
                      : mode === "agent"
                        ? "Peça uma alteração direta no workspace…"
                        : "Escreva uma mensagem… use @ para mencionar arquivos"
              }
            />
            <div className="flex items-center gap-1 px-1 pt-1">
              <div className="relative">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Adicionar contexto"
                  title="Adicionar contexto"
                  className={attachmentMenu ? "bg-primary/10 text-primary-soft" : undefined}
                  onClick={() => setAttachmentMenu((value) => !value)}
                >
                  {stagingCount > 0 ? (
                    <LoaderCircle className="animate-spin" size={14} />
                  ) : (
                    <Paperclip size={14} />
                  )}
                </Button>
                {attachmentMenu ? (
                  <div className="attachment-menu glass-popover">
                    <button type="button" onClick={() => void chooseAttachments("files")}>
                      <FileUp size={13} /> Escolher arquivos
                    </button>
                    <button type="button" onClick={() => void chooseAttachments("folder")}>
                      <FolderOpen size={13} /> Escolher pasta
                    </button>
                    <button type="button" onClick={() => void chooseAttachments("clipboard")}>
                      <Clipboard size={13} /> Colar conteúdo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecorderOpen(true);
                        setAttachmentMenu(false);
                      }}
                    >
                      <Mic size={13} /> Gravar áudio
                    </button>
                  </div>
                ) : null}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Configurações da execução"
                title="Configurações da execução"
                className={configurationOpen ? "bg-primary/10 text-primary-soft" : undefined}
                onClick={() => {
                  setConfigurationOpen((value) => !value);
                  setModeMenu(false);
                  setFastModelOpen(false);
                }}
              >
                <Settings2 size={14} />
              </Button>
              <span className="ml-1 hidden text-[10px] text-text-faint sm:inline">
                {mode === "maestro"
                  ? "/plan · /review · /compact · /model · /fork · /status"
                  : "Enter envia · Shift Enter quebra linha"}
              </span>
              <Button
                className="ml-auto"
                size="md"
                disabled={!canSend || send.isPending}
                onClick={() => send.mutate()}
              >
                {sessionKind === "pty" ? <SquareTerminal size={14} /> : <Send size={14} />}
                {send.isPending
                  ? "Enviando…"
                  : sessionKind === "pty"
                    ? "Abrir terminal"
                    : awaitingClarification
                      ? "Responder"
                      : "Enviar"}
              </Button>
            </div>
          </div>
          {contextAssets.some((asset) => asset.status === "needs_model") ? (
            <div className="mt-2 flex items-center gap-2 rounded-[9px] border border-warning/15 bg-warning/[0.045] px-3 py-2 text-[10px] text-warning">
              <Mic size={11} />
              <span className="min-w-0 flex-1">
                Áudio e vídeo são transcritos localmente. O pacote Whisper é necessário
                {localModel?.status === "downloading" && localModel.progress !== null
                  ? ` · ${Math.round(localModel.progress * 100)}%`
                  : "."}
              </span>
              <button
                type="button"
                className="font-semibold hover:text-text"
                disabled={localModel?.status === "downloading"}
                onClick={() => {
                  setContextError(null);
                  void api()
                    .downloadLocalModel()
                    .then(setLocalModel)
                    .catch((error: unknown) =>
                      setContextError(error instanceof Error ? error.message : String(error)),
                    );
                }}
              >
                {localModel?.status === "downloading" ? "Baixando…" : "Baixar pacote"}
              </button>
            </div>
          ) : null}
          {visionBlocked ? (
            <button
              type="button"
              className="mt-2 flex w-full items-center gap-2 rounded-[9px] border border-warning/15 bg-warning/[0.045] px-3 py-2 text-left text-[10px] text-warning"
              onClick={() => setConfigurationOpen(true)}
            >
              <AlertTriangle size={11} /> A imagem exige um modelo com visão. Escolha outro modelo.
            </button>
          ) : null}
          {videoFramesOmitted ? (
            <p className="mt-2 flex items-center gap-2 rounded-[9px] border border-info/15 bg-info/[0.035] px-3 py-2 text-[10px] text-info">
              <FileVideo size={11} /> O vídeo seguirá com a transcrição local; os quadros serão
              omitidos porque o modelo não possui visão.
            </p>
          ) : null}
          {send.error || contextError ? (
            <p
              className="mt-2 rounded-[9px] border border-danger/15 bg-danger/[0.045] px-3 py-2 text-[11px] text-danger"
              role="alert"
            >
              {contextError ??
                (send.error instanceof Error ? send.error.message : String(send.error))}
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
      <FastModelSwitcher
        open={fastModelOpen}
        mode={mode}
        providers={allowedProviders}
        connections={bootstrap.providerConnections}
        current={currentFastSelection}
        automatic={mode === "maestro" && automaticRouting}
        allowImmediate={Boolean(activeRunForSwitch)}
        onSelectAuto={() => {
          setAutomaticRouting(true);
          setFastModelOpen(false);
          setConfigurationOpen(false);
          setModeMenu(false);
        }}
        onClose={() => setFastModelOpen(false)}
        onSelect={(selection, timing) => {
          const provider = allowedProviders.find(
            (candidate) => candidate.descriptor.id === selection.providerId,
          );
          const account = selection.connectionId
            ? bootstrap.providerConnections.find(
                (candidate) => candidate.connection.id === selection.connectionId,
              )
            : null;
          const model = (account?.models.length ? account.models : provider?.models)?.find(
            (candidate) => candidate.id === selection.modelId,
          );
          setProviderId(selection.providerId);
          if (mode === "maestro") setAutomaticRouting(false);
          setProviderConnectionId(selection.connectionId ?? "");
          setModelId(selection.modelId);
          const efforts = model?.capabilities.reasoningEffort ?? [];
          if (efforts.length > 0 && !efforts.includes(effort))
            setEffort(efforts.includes("medium") ? "medium" : efforts[0]!);
          if (activeRunForSwitch && runQuery.data)
            void api()
              .switchModel({
                runId: runQuery.data.run.id,
                selection: {
                  providerId: selection.providerId,
                  modelId: selection.modelId,
                  ...(selection.connectionId ? { connectionId: selection.connectionId } : {}),
                  effort,
                },
                timing,
                noFallback: bootstrap.settings.noFallback,
              })
              .then(() =>
                queryClient.invalidateQueries({ queryKey: ["run", runQuery.data.run.id] }),
              );
          setFastModelOpen(false);
          setConfigurationOpen(false);
          setModeMenu(false);
        }}
      />
    </div>
  );
}
