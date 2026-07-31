import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleStop,
  Clock3,
  FileCode2,
  GitBranch,
  ListTree,
  MessageCircleQuestion,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { BootstrapPayload, RunEvent } from "@maestro/contracts";
import { api, getAllRunEvents } from "@renderer/lib/api";
import { compactPath, relativeTime, RUN_LABELS, stateTone } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/app-store";
import { AgentPipeline } from "@renderer/components/operations/agent-pipeline";
import { EventFeed } from "@renderer/components/operations/event-feed";
import { ProgressTracker } from "@renderer/components/operations/progress-tracker";
import { SubagentRow } from "@renderer/components/operations/subagent-row";
import { PlanApprovalCard } from "@renderer/components/conversation/plan-approval";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { LoadingPane } from "@renderer/components/ui/skeleton";
import { ErrorPane } from "@renderer/components/ui/feedback";

type RunTab = "overview" | "plan" | "events";
const terminalStates = new Set(["completed", "failed", "canceled"]);

export function RunPage({ id, bootstrap }: { id: string; bootstrap: BootstrapPayload }) {
  const setView = useAppStore((state) => state.setView);
  const liveEvents = useAppStore((state) => state.recentEvents);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RunTab>("overview");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const query = useQuery({
    queryKey: ["run", id],
    queryFn: () => api().getRun(id),
    refetchInterval: (result) => {
      const state = result.state.data?.run.state;
      return state && !terminalStates.has(state) ? 2_000 : false;
    },
  });
  const eventsQuery = useQuery({
    queryKey: ["run-events", id],
    queryFn: () => getAllRunEvents(id),
    refetchInterval: query.data && !terminalStates.has(query.data.run.state) ? 4_000 : false,
  });
  const events = useMemo(() => {
    const byId = new Map<string, RunEvent>();
    for (const event of eventsQuery.data?.events ?? []) byId.set(event.id, event);
    for (const event of liveEvents) if (event.runId === id) byId.set(event.id, event);
    return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
  }, [eventsQuery.data?.events, id, liveEvents]);
  const cancel = useMutation({
    mutationFn: () => api().cancelRun(id),
    onSuccess: (detail) => {
      queryClient.setQueryData(["run", id], detail);
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    },
  });

  if (query.isError) return <ErrorPane error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <LoadingPane />;
  const detail = query.data;
  const { run, tasks } = detail;
  const plan = detail.plans.at(-1);
  const running = !terminalStates.has(run.state);
  const completed = tasks.filter((task) => task.state === "completed").length;
  const failed = tasks.filter((task) => task.state === "failed").length;
  const active = tasks.filter((task) => task.state === "running" || task.state === "validating");

  return (
    <div className="page-enter flex h-full min-w-0 flex-col bg-bg/45">
      <header className="flex min-h-[70px] shrink-0 items-center gap-3 border-b border-border bg-bg/75 px-4 py-2.5 md:px-5">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Voltar à conversa"
          onClick={() => setView({ type: "conversation", id: run.conversationId })}
        >
          <ArrowLeft size={15} />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-faint">
              Execução {run.id.slice(0, 8)}
            </span>
            <Badge tone={stateTone(run.state)}>{RUN_LABELS[run.state]}</Badge>
          </div>
          <h1 className="truncate text-[14px] font-semibold text-text" title={run.spec.prompt}>
            {run.spec.prompt}
          </h1>
        </div>
        <div className="hidden items-center gap-4 text-[10px] text-text-faint xl:flex">
          <span className="flex items-center gap-1.5">
            <Clock3 size={11} />
            {relativeTime(run.updatedAt)}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={11} />
            {run.spec.workspaceRootIds.length} raiz autorizada
          </span>
        </div>
        {running ? (
          <Button
            variant="danger"
            size="sm"
            disabled={cancel.isPending}
            onBlur={() => setConfirmCancel(false)}
            onClick={() => {
              if (confirmCancel) cancel.mutate();
              else setConfirmCancel(true);
            }}
          >
            <CircleStop size={13} />{" "}
            {cancel.isPending
              ? "Cancelando…"
              : confirmCancel
                ? "Confirmar cancelamento"
                : "Cancelar"}
          </Button>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border bg-surface/30 px-5 py-4 md:px-6">
        <AgentPipeline state={run.state} />
      </div>

      {run.state === "awaiting_clarification" ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-warning/20 bg-warning/[0.05] px-5 py-3 md:px-6">
          <MessageCircleQuestion size={15} className="shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-text">
              O Maestro pausou para decidir com você
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              As perguntas e o entendimento estão no chat. Nenhum plano ou arquivo foi criado.
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setView({ type: "conversation", id: run.conversationId })}
          >
            Responder no chat
          </Button>
        </div>
      ) : null}

      {cancel.error ? (
        <div
          className="border-b border-danger/20 bg-danger/[0.05] px-5 py-2 text-[11px] text-danger"
          role="alert"
        >
          {cancel.error instanceof Error ? cancel.error.message : String(cancel.error)}
        </div>
      ) : null}

      <nav
        className="flex h-12 shrink-0 items-end gap-1 border-b border-border px-4 md:px-6"
        aria-label="Detalhes da execução"
      >
        {(
          [
            ["overview", "Visão geral", ListTree],
            ["plan", `Plano${plan ? ` v${plan.version}` : ""}`, FileCode2],
            ["events", `Eventos ${events.length}`, ScrollText],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            className={`flex h-11 items-center gap-2 border-b-2 px-3 text-[12px] font-semibold ${tab === value ? "border-primary text-text" : "border-transparent text-text-faint hover:text-text-muted"}`}
            onClick={() => setTab(value)}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {run.state === "awaiting_approval" ? (
          <div className="mx-auto max-w-[1100px] p-6">
            <PlanApprovalCard detail={detail} providers={bootstrap.providers} />
          </div>
        ) : tab === "overview" ? (
          <div className="mx-auto grid max-w-[1280px] gap-5 p-5 md:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <section className="panel overflow-hidden">
                <div className="panel-header">
                  <div>
                    <h2 className="text-[14px] font-semibold">Progresso</h2>
                    <p className="mt-0.5 text-[10px] text-text-faint">
                      DAG persistido e recuperável
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="success">{completed} concluídas</Badge>
                    {failed ? <Badge tone="danger">{failed} falharam</Badge> : null}
                  </div>
                </div>
                <ProgressTracker tasks={tasks} />
              </section>

              {run.integrationBranch || run.integrationPath || run.error ? (
                <section
                  className={`rounded-[12px] border p-4 ${run.error ? "border-danger/20 bg-danger/[0.035]" : "border-success/20 bg-success/[0.035]"}`}
                >
                  <div className="flex items-start gap-3">
                    {run.error ? (
                      <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={16} />
                    ) : (
                      <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={16} />
                    )}
                    <div className="min-w-0">
                      <h3 className="text-[12px] font-medium text-text">
                        {run.error ? "Execução interrompida" : "Resultado de integração"}
                      </h3>
                      {run.error ? (
                        <p className="mt-1 text-[11px] leading-4 text-danger">{run.error}</p>
                      ) : null}
                      {run.integrationBranch ? (
                        <p className="mt-2 flex items-center gap-2 font-mono text-[10px] text-text-muted">
                          <GitBranch size={11} />
                          {run.integrationBranch}
                        </p>
                      ) : null}
                      {run.integrationPath ? (
                        <p
                          className="mt-1 truncate font-mono text-[9px] text-text-faint"
                          title={run.integrationPath}
                        >
                          {compactPath(run.integrationPath, 90)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="space-y-5">
              <section className="panel overflow-hidden">
                <div className="panel-header">
                  <div>
                    <h2 className="text-[14px] font-semibold">Subagentes</h2>
                    <p className="mt-0.5 text-[10px] text-text-faint">
                      {active.length} trabalhando agora
                    </p>
                  </div>
                  <Users size={14} className="text-text-faint" />
                </div>
                <div className="space-y-2 p-3">
                  {tasks.length ? (
                    tasks.map((task) => <SubagentRow key={task.id} task={task} />)
                  ) : (
                    <p className="p-5 text-center text-[10px] text-text-faint">
                      Agentes serão criados após a aprovação.
                    </p>
                  )}
                </div>
              </section>
              <section className="panel overflow-hidden">
                <div className="panel-header">
                  <div>
                    <h2 className="text-[14px] font-semibold">Atividade recente</h2>
                    <p className="mt-0.5 text-[10px] text-text-faint">
                      Comandos, ferramentas e diffs
                    </p>
                  </div>
                </div>
                <div className="max-h-[420px] overflow-y-auto">
                  <EventFeed events={events.slice(-14).reverse()} />
                </div>
              </section>
            </aside>
          </div>
        ) : tab === "plan" ? (
          <div className="mx-auto max-w-[1000px] p-6">
            {plan ? (
              <article className="panel overflow-hidden">
                <div className="panel-header">
                  <div>
                    <h2 className="text-[14px] font-semibold">Plano v{plan.version}</h2>
                    <p className="mt-0.5 text-[10px] text-text-faint">{plan.summary}</p>
                  </div>
                  <Badge tone="primary">{plan.tasks.length} tarefas</Badge>
                </div>
                <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-3">
                    {plan.tasks.map((task, index) => (
                      <div
                        key={task.id}
                        className="rounded-[10px] border border-border bg-bg-elevated p-4"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid size-6 place-items-center rounded-full bg-primary/10 font-mono text-[9px] text-primary-soft">
                            {index + 1}
                          </span>
                          <h3 className="text-[13px] font-semibold">{task.title}</h3>
                          <Badge className="ml-auto" tone="neutral">
                            {task.role}
                          </Badge>
                        </div>
                        <p className="mt-2 text-[11px] leading-5 text-text-muted">
                          {task.description}
                        </p>
                        <div className="mt-3 flex items-center gap-2 font-mono text-[9px] text-text-faint">
                          <GitBranch size={10} />
                          {task.dependencies.length
                            ? `depende de ${task.dependencies.join(", ")}`
                            : "sem dependências"}
                          <span className="ml-auto">
                            {task.model.providerId}/{task.model.modelId}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <aside className="space-y-4">
                    <PlanList
                      title="Critérios de sucesso"
                      items={plan.successCriteria}
                      tone="success"
                    />
                    <PlanList title="Pressupostos" items={plan.assumptions} tone="info" />
                    <PlanList title="Riscos" items={plan.risks} tone="warning" />
                  </aside>
                </div>
              </article>
            ) : (
              <div className="panel p-12 text-center text-[11px] text-text-faint">
                O plano ainda está sendo gerado.
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-[1100px] p-6">
            <section className="panel overflow-hidden">
              <EventFeed
                events={[...events].reverse()}
                empty="A execução ainda não emitiu eventos."
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "success" | "info" | "warning";
}) {
  const color = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-info";
  return (
    <section className="rounded-[10px] border border-border bg-bg-elevated p-3.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {title}
      </h3>
      {items.length ? (
        <ul className="mt-2.5 space-y-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-[10px] leading-4 text-text-faint">
              <span className={`mt-1.5 size-1 shrink-0 rounded-full ${color}`} />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[9px] text-text-faint">Nenhum item registrado.</p>
      )}
    </section>
  );
}
