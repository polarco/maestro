import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  FileDiff,
  GitBranch,
  Hammer,
  History,
  LoaderCircle,
  MemoryStick,
  Pencil,
  Pin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Project, TimelineItem } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { cn } from "@renderer/lib/utils";

function time(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function OperationalItem({
  item,
  onOpenStudio,
}: {
  item: Exclude<TimelineItem, { kind: "message" }>;
  onOpenStudio: () => void;
}) {
  if (item.kind === "question")
    return (
      <section className="timeline-operation border-warning/20 bg-warning/[0.035]">
        <div className="timeline-operation-title text-warning">
          <Sparkles size={13} /> Decisão necessária
        </div>
        <div className="mt-2 space-y-2">
          {item.questions.map((question) => (
            <div key={question.id} className="rounded-[9px] bg-bg-elevated/70 p-2.5">
              <p className="text-[11px] font-medium text-text">{question.question}</p>
              <p className="mt-1 text-[9.5px] text-text-faint">{question.reason}</p>
            </div>
          ))}
        </div>
      </section>
    );
  if (item.kind === "research")
    return (
      <details className="timeline-operation" open={item.status === "running"}>
        <summary className="timeline-operation-title cursor-pointer">
          <Search size={13} className="text-info" /> <span className="flex-1">{item.title}</span>
          {item.status === "running" ? (
            <LoaderCircle size={12} className="animate-spin text-info" />
          ) : (
            <ChevronDown size={12} />
          )}
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-[10.5px] leading-5 text-text-muted">
          {item.summary}
        </p>
      </details>
    );
  if (item.kind === "plan")
    return (
      <details className="timeline-operation" open>
        <summary className="timeline-operation-title cursor-pointer">
          <Clipboard size={13} className="text-primary-soft" />
          <span className="flex-1">
            Plano v{item.plan.version} · {item.plan.summary}
          </span>
          <ChevronDown size={12} />
        </summary>
        <ol className="mt-3 space-y-1.5">
          {item.plan.tasks.map((task, index) => (
            <li
              key={task.id}
              className="flex gap-2 rounded-[8px] bg-bg-elevated/65 px-2.5 py-2 text-[10px] text-text-muted"
            >
              <span className="text-text-faint">{index + 1}.</span>
              <span>{task.title}</span>
            </li>
          ))}
        </ol>
      </details>
    );
  if (item.kind === "agent")
    return (
      <section className="timeline-operation">
        <div className="timeline-operation-title">
          <Bot size={13} className="text-info" />
          <span className="flex-1">{item.label}</span>
          <span className="timeline-status">{item.status}</span>
        </div>
        {item.detail ? <p className="mt-1.5 text-[9.5px] text-text-faint">{item.detail}</p> : null}
      </section>
    );
  if (item.kind === "tool")
    return (
      <section className="timeline-operation">
        <div className="timeline-operation-title">
          <Hammer size={13} className="text-text-faint" />
          <code className="flex-1 text-[10px]">{item.name}</code>
          <span className="timeline-status">{item.status}</span>
        </div>
        <p className="mt-1.5 text-[9.5px] text-text-faint">{item.summary}</p>
      </section>
    );
  if (item.kind === "approval")
    return (
      <section className="timeline-operation border-warning/20">
        <div className="timeline-operation-title">
          <ShieldCheck size={13} className="text-warning" />
          <span className="flex-1">{item.summary}</span>
          <span className="timeline-status">{item.status}</span>
        </div>
      </section>
    );
  if (item.kind === "diff")
    return (
      <details className="timeline-operation">
        <summary className="timeline-operation-title cursor-pointer">
          <FileDiff size={13} className="text-success" />
          <code className="min-w-0 flex-1 truncate text-[10px]">{item.path}</code>
          <span className="text-success">+{item.additions ?? 0}</span>
          <span className="text-danger">−{item.deletions ?? 0}</span>
          <ChevronRight size={12} />
        </summary>
        <pre className="timeline-diff">{item.patch}</pre>
      </details>
    );
  if (item.kind === "validation")
    return (
      <section className="timeline-operation">
        <div className="timeline-operation-title">
          <CheckCircle2
            size={13}
            className={
              item.status === "passed"
                ? "text-success"
                : item.status === "failed"
                  ? "text-danger"
                  : "text-info"
            }
          />
          <span className="flex-1">{item.label}</span>
          <span className="timeline-status">{item.status}</span>
        </div>
        {item.detail ? <p className="mt-1 text-[9px] text-text-faint">{item.detail}</p> : null}
      </section>
    );
  if (item.kind === "artifact")
    return (
      <button
        className="timeline-operation w-full text-left hover:border-primary/30"
        onClick={onOpenStudio}
      >
        <div className="timeline-operation-title">
          <Box size={13} className="text-primary-soft" />
          <span className="min-w-0 flex-1 truncate">{item.artifact.title}</span>
          <span className="timeline-status">
            {item.artifact.kind} · v{item.artifact.currentVersion}
          </span>
          <ChevronRight size={12} />
        </div>
      </button>
    );
  if (item.kind === "checkpoint")
    return (
      <details className="timeline-operation opacity-85">
        <summary className="timeline-operation-title cursor-pointer">
          <Pin size={12} className="text-text-faint" />
          <span className="flex-1">Checkpoint v{item.checkpoint.version}</span>
          <span className="timeline-status">
            {item.checkpoint.safeToResume ? "seguro" : "pendente"}
          </span>
        </summary>
        <p className="mt-2 text-[9.5px] leading-4 text-text-faint">{item.checkpoint.objective}</p>
      </details>
    );
  if (item.kind === "source")
    return (
      <button
        className="timeline-operation block w-full text-left hover:border-info/30"
        onClick={() => void api().openExternalUrl(item.source.url)}
        aria-label={`Abrir fonte ${item.source.title}`}
      >
        <div className="timeline-operation-title">
          <Search size={12} className="text-info" />
          <span className="min-w-0 flex-1 truncate">{item.source.title}</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[9.5px] leading-4 text-text-faint">
          {item.source.excerpt}
        </p>
      </button>
    );
  return (
    <section className="timeline-operation border-danger/20 bg-danger/[0.035]">
      <div className="timeline-operation-title text-danger">
        <AlertTriangle size={13} />
        <span>{item.message}</span>
      </div>
      {item.recoverable ? (
        <span className="mt-2 inline-block text-[9px] text-text-faint">
          É possível tentar novamente a partir do último checkpoint.
        </span>
      ) : null}
    </section>
  );
}

export function SessionTimeline({
  sessionId,
  project,
  streaming,
  onEdit,
  onContinue,
  onOpenStudio,
}: {
  sessionId: string;
  project: Project;
  streaming: boolean;
  onEdit: (turnId: string, content: string) => void;
  onContinue: (content: string) => void;
  onOpenStudio: () => void;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const historySentinelRef = useRef<HTMLButtonElement>(null);
  const timeline = useInfiniteQuery({
    queryKey: ["timeline", sessionId],
    queryFn: ({ pageParam }) => api().getSessionTimeline(sessionId, pageParam, 500),
    initialPageParam: undefined as number | undefined,
    getPreviousPageParam: (page) => page.previousCursor ?? undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: streaming ? 1_500 : false,
  });
  const timelineItems = useMemo(() => {
    const byId = new Map<string, TimelineItem>();
    for (const page of timeline.data?.pages ?? [])
      for (const item of page.items) byId.set(item.id, item);
    return [...byId.values()].sort(
      (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
    );
  }, [timeline.data?.pages]);
  const turnForMessage = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of timelineItems)
      if (item.kind === "message" && item.turnId) map.set(item.message.id, item.turnId);
    return map;
  }, [timelineItems]);

  useEffect(() => {
    const sentinel = historySentinelRef.current;
    if (!sentinel || !timeline.hasPreviousPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !timeline.isFetchingPreviousPage)
          void timeline.fetchPreviousPage();
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [timeline.fetchPreviousPage, timeline.hasPreviousPage, timeline.isFetchingPreviousPage]);

  if (timeline.isLoading)
    return (
      <div className="flex min-h-36 items-center justify-center text-text-faint">
        <LoaderCircle size={17} className="animate-spin" />
      </div>
    );
  if (timeline.isError)
    return (
      <button
        className="timeline-operation mx-auto text-danger"
        onClick={() => void timeline.refetch()}
      >
        Não foi possível montar a timeline. Tentar novamente.
      </button>
    );

  return (
    <div className="session-timeline" aria-live={streaming ? "polite" : "off"}>
      {timeline.hasPreviousPage ? (
        <button
          ref={historySentinelRef}
          className="timeline-history-loader"
          disabled={timeline.isFetchingPreviousPage}
          onClick={() => void timeline.fetchPreviousPage()}
        >
          {timeline.isFetchingPreviousPage ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <History size={12} />
          )}
          {timeline.isFetchingPreviousPage ? "Carregando histórico…" : "Carregar itens anteriores"}
        </button>
      ) : null}
      {timelineItems.map((item) => {
        if (item.kind !== "message")
          return (
            <div key={item.id} className="timeline-virtual-item">
              <OperationalItem item={item} onOpenStudio={onOpenStudio} />
            </div>
          );
        const message = item.message;
        const user = message.role === "user";
        const turnId = turnForMessage.get(message.id) ?? item.turnId;
        return (
          <article key={item.id} className={cn("timeline-message group", user && "is-user")}>
            <div className={cn("timeline-avatar", user ? "is-user" : "is-maestro")}>
              {user ? <User size={14} /> : <Sparkles size={14} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center gap-2 text-[9.5px] text-text-faint">
                <span className="font-medium text-text-muted">{user ? "Você" : "Maestro"}</span>
                <span>·</span>
                <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
                {message.status === "streaming" ? (
                  <span className="flex items-center gap-1 text-info">
                    <LoaderCircle size={9} className="animate-spin" /> pensando
                  </span>
                ) : null}
              </div>
              <div className={cn("timeline-message-body", user && "is-user")}>
                {message.content ? (
                  user ? (
                    <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-text">
                      {message.content}
                    </p>
                  ) : (
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                  )
                ) : (
                  <span className="inline-flex gap-1 py-1">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="size-1 animate-pulse rounded-full bg-text-faint"
                        style={{ animationDelay: `${dot * 140}ms` }}
                      />
                    ))}
                  </span>
                )}
                {message.contextAssets.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
                    {message.contextAssets.map((asset) => (
                      <span
                        key={asset.id}
                        className="rounded-[7px] border border-border bg-bg-elevated px-2 py-1 text-[9px] text-text-muted"
                      >
                        {asset.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {message.status === "completed" && message.content ? (
                <div className={cn("timeline-actions", user && "justify-end")}>
                  <button
                    onClick={() => void navigator.clipboard.writeText(message.content)}
                    title="Copiar"
                  >
                    <Copy size={11} /> Copiar
                  </button>
                  {!user ? (
                    <button
                      onClick={() =>
                        void api()
                          .saveMemory({
                            projectId: project.id,
                            sessionId,
                            ...(item.turnId ? { turnId: item.turnId } : {}),
                            messageId: message.id,
                            kind: "fact",
                            content: message.content,
                          })
                          .then(() =>
                            queryClient.invalidateQueries({ queryKey: ["memories", project.id] }),
                          )
                          .catch((error: unknown) =>
                            setActionError(error instanceof Error ? error.message : String(error)),
                          )
                      }
                      title="Salvar como memória do projeto"
                    >
                      <MemoryStick size={11} /> Memória
                    </button>
                  ) : null}
                  {!user ? (
                    <button
                      onClick={() =>
                        void api()
                          .createArtifact({
                            projectId: project.id,
                            sessionId,
                            ...(item.branchId ? { branchId: item.branchId } : {}),
                            ...(item.turnId ? { turnId: item.turnId } : {}),
                            title: `Tarefa · ${time(message.createdAt)}`,
                            kind: "markdown",
                            content: `# Tarefa\n\n${message.content}`,
                            createdBy: "user",
                          })
                          .then(() => {
                            void queryClient.invalidateQueries({
                              queryKey: ["artifacts", project.id, sessionId],
                            });
                            onOpenStudio();
                          })
                          .catch((error: unknown) =>
                            setActionError(error instanceof Error ? error.message : String(error)),
                          )
                      }
                      title="Transformar em tarefa"
                    >
                      <CheckCircle2 size={11} /> Tarefa
                    </button>
                  ) : null}
                  {!user ? (
                    <button
                      onClick={() => onContinue(message.content)}
                      title="Continuar a partir desta resposta"
                    >
                      <ChevronRight size={11} /> Continuar
                    </button>
                  ) : null}
                  {user && turnId ? (
                    <button
                      onClick={() => onEdit(turnId, message.content)}
                      title="Editar em uma nova branch"
                    >
                      <Pencil size={11} /> Editar
                    </button>
                  ) : null}
                  {turnId ? (
                    <button
                      onClick={() =>
                        void api()
                          .forkAtTurn({ sessionId, turnId })
                          .then(() =>
                            Promise.all([
                              queryClient.invalidateQueries({
                                queryKey: ["timeline", sessionId],
                              }),
                              queryClient.invalidateQueries({
                                queryKey: ["conversation", sessionId],
                              }),
                            ]),
                          )
                          .catch((error: unknown) =>
                            setActionError(error instanceof Error ? error.message : String(error)),
                          )
                      }
                      title="Ramificar aqui"
                    >
                      <GitBranch size={11} /> Ramificar
                    </button>
                  ) : null}
                  {!user && turnId ? (
                    <button
                      onClick={() =>
                        void api()
                          .retryTurn({ turnId })
                          .then(() =>
                            Promise.all([
                              queryClient.invalidateQueries({
                                queryKey: ["timeline", sessionId],
                              }),
                              queryClient.invalidateQueries({
                                queryKey: ["conversation", sessionId],
                              }),
                            ]),
                          )
                          .catch((error: unknown) =>
                            setActionError(error instanceof Error ? error.message : String(error)),
                          )
                      }
                      title="Tentar novamente"
                    >
                      <RefreshCw size={11} /> Repetir
                    </button>
                  ) : null}
                  {!user ? (
                    <button
                      onClick={() =>
                        void api()
                          .createArtifact({
                            projectId: project.id,
                            sessionId,
                            ...(item.branchId ? { branchId: item.branchId } : {}),
                            ...(item.turnId ? { turnId: item.turnId } : {}),
                            title: `Resposta · ${time(message.createdAt)}`,
                            kind: "markdown",
                            content: message.content,
                            pinned: true,
                            createdBy: "assistant",
                          })
                          .then(() => {
                            void queryClient.invalidateQueries({
                              queryKey: ["artifacts", project.id, sessionId],
                            });
                            onOpenStudio();
                          })
                          .catch((error: unknown) =>
                            setActionError(error instanceof Error ? error.message : String(error)),
                          )
                      }
                      title="Fixar no Studio"
                    >
                      <Pin size={11} /> Fixar
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
      {actionError ? (
        <div className="timeline-operation border-danger/20 text-[10px] text-danger">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
