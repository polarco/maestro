import { useQueries } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock3,
  MessageSquare,
  Plus,
  ServerCog,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import type { BootstrapPayload, Project, Run, RunDetail } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { RUN_LABELS, relativeTime, stateTone } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/app-store";
import { Button } from "@renderer/components/ui/button";
import { Badge } from "@renderer/components/ui/badge";
import { AgentPipeline } from "@renderer/components/operations/agent-pipeline";
import { EventFeed } from "@renderer/components/operations/event-feed";

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone = "primary",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  tone?: "primary" | "info" | "success" | "warning";
}) {
  const colors = {
    primary: "bg-primary/10 text-primary-soft",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <div className="panel group relative flex min-h-[124px] items-start gap-4 overflow-hidden p-5 transition-colors hover:border-border-strong">
      <div
        className={`grid size-10 shrink-0 place-items-center rounded-[11px] transition-transform group-hover:scale-105 ${colors[tone]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-text-muted">{label}</div>
        <div className="mt-1 text-[28px] font-semibold tracking-[-0.04em] text-text tabular-nums">
          {value}
        </div>
        <div className="mt-1 truncate text-[11px] text-text-faint">{detail}</div>
      </div>
    </div>
  );
}

function RunCard({ run, detail }: { run: Run; detail?: RunDetail }) {
  const setView = useAppStore((state) => state.setView);
  const completed = detail?.tasks.filter((task) => task.state === "completed").length ?? 0;
  const total = detail?.tasks.length ?? 0;
  return (
    <button
      className="group w-full rounded-[13px] border border-border bg-bg-elevated p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover/45"
      onClick={() => setView({ type: "run", id: run.id })}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-primary/10 text-primary-soft">
          <Bot size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-text">{run.spec.prompt}</span>
            <Badge tone={stateTone(run.state)} className="ml-auto shrink-0">
              {RUN_LABELS[run.state]}
            </Badge>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-text-faint">
            <span className="uppercase tracking-wide">{run.mode}</span>
            <span>·</span>
            <span>{relativeTime(run.updatedAt)}</span>
            {total > 0 ? (
              <>
                <span>·</span>
                <span>
                  {completed}/{total} tarefas
                </span>
              </>
            ) : null}
          </div>
        </div>
        <ArrowRight
          size={14}
          className="mt-2 text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text-muted"
        />
      </div>
      <div className="mt-4 px-1">
        <AgentPipeline state={run.state} />
      </div>
    </button>
  );
}

export function Dashboard({
  bootstrap,
  project,
  onNewConversation,
}: {
  bootstrap: BootstrapPayload;
  project: Project;
  onNewConversation: () => void;
}) {
  const recentEvents = useAppStore((state) => state.recentEvents);
  const setView = useAppStore((state) => state.setView);
  const runQueries = useQueries({
    queries: bootstrap.activeRuns.map((run) => ({
      queryKey: ["run", run.id],
      queryFn: () => api().getRun(run.id),
      staleTime: 2_000,
    })),
  });
  const details = new Map(
    runQueries.flatMap((query) => (query.data ? [[query.data.run.id, query.data] as const] : [])),
  );
  const readyProviders = bootstrap.providers.filter(
    (provider) => provider.health.status === "ready",
  ).length;
  const awaiting = bootstrap.activeRuns.filter((run) => run.state === "awaiting_approval").length;
  const activeAgents = [...details.values()]
    .flatMap((detail) => detail.tasks)
    .filter((task) => task.state === "running").length;
  const queuedTasks = [...details.values()]
    .flatMap((detail) => detail.tasks)
    .filter((task) => task.state === "queued" || task.state === "pending").length;

  return (
    <div className="page-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1320px] p-5 md:p-6 xl:p-8">
        <header className="relative mb-5 overflow-hidden rounded-[18px] border border-border bg-surface px-5 py-5 shadow-[var(--panel-shadow)] md:px-6">
          <div className="hero-dot-field pointer-events-none absolute inset-y-0 right-0 w-[38%] opacity-70" />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
                <span className="size-1.5 rounded-full bg-success shadow-[0_0_8px_rgb(105_201_167/0.6)]" />
                Workspace ativo
              </div>
              <h1 className="truncate text-[27px] font-semibold tracking-[-0.035em] text-text">
                {project.name}
              </h1>
              <p className="mt-1.5 text-[13px] text-text-muted">
                {bootstrap.activeRuns.length > 0
                  ? `${bootstrap.activeRuns.length} execução${bootstrap.activeRuns.length === 1 ? "" : "ões"} em andamento agora.`
                  : "Tudo em ordem. Comece uma conversa quando estiver pronto."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-text-faint">
                <span>
                  {project.roots.length} pasta{project.roots.length === 1 ? "" : "s"} autorizada
                  {project.roots.length === 1 ? "" : "s"}
                </span>
                <span className="size-1 rounded-full bg-border-strong" />
                <span>Dados locais</span>
                <span className="size-1 rounded-full bg-border-strong" />
                <span>
                  {readyProviders} provedor{readyProviders === 1 ? "" : "es"} pronto
                  {readyProviders === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setView({ type: "terminal" })}>
                <SquareTerminal size={15} /> Terminal
              </Button>
              <Button onClick={onNewConversation}>
                <Plus size={15} /> Nova conversa
              </Button>
            </div>
          </div>
        </header>

        {awaiting > 0 ? (
          <button
            className="mb-5 flex w-full items-center gap-3 rounded-[13px] border border-warning/25 bg-warning/[0.055] px-4 py-3 text-left transition-colors hover:border-warning/40 hover:bg-warning/[0.08]"
            onClick={() => {
              const run = bootstrap.activeRuns.find((item) => item.state === "awaiting_approval");
              if (run) setView({ type: "run", id: run.id });
            }}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-warning/12 text-warning">
              <ShieldCheck size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-text">
                {awaiting} plano{awaiting === 1 ? " precisa" : "s precisam"} da sua revisão
              </span>
              <span className="mt-0.5 block text-[10px] text-text-muted">
                Nenhuma alteração será feita até você aprovar.
              </span>
            </span>
            <span className="text-[11px] font-semibold text-warning">Revisar agora</span>
            <ArrowRight size={14} className="text-warning" />
          </button>
        ) : null}

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Resumo">
          <MetricCard
            icon={<Activity size={15} />}
            label="Execuções ativas"
            value={bootstrap.activeRuns.length}
            detail={awaiting ? `${awaiting} aguardando sua aprovação` : "Nenhuma ação pendente"}
          />
          <MetricCard
            icon={<Bot size={15} />}
            label="Agentes trabalhando"
            value={activeAgents}
            detail={`${queuedTasks} tarefas na fila`}
            tone="info"
          />
          <MetricCard
            icon={<ServerCog size={15} />}
            label="Provedores prontos"
            value={readyProviders}
            detail={`${bootstrap.providerConnections.length} contas por assinatura`}
            tone="success"
          />
          <MetricCard
            icon={<ShieldCheck size={15} />}
            label="Aprovações"
            value={awaiting}
            detail={awaiting ? "Planos aguardam revisão" : "Sem bloqueios"}
            tone={awaiting ? "warning" : "success"}
          />
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.75fr)]">
          <section className="panel min-w-0 overflow-hidden">
            <div className="panel-header">
              <div>
                <h2 className="text-[14px] font-semibold text-text">Execuções</h2>
                <p className="mt-0.5 text-[11px] text-text-faint">Pipeline em tempo real</p>
              </div>
              {bootstrap.activeRuns.length > 0 ? (
                <Badge tone="info">{bootstrap.activeRuns.length} ativas</Badge>
              ) : null}
            </div>
            <div className="space-y-3 p-4">
              {bootstrap.activeRuns.length > 0 ? (
                bootstrap.activeRuns.map((run) => {
                  const detail = details.get(run.id);
                  return <RunCard key={run.id} run={run} {...(detail ? { detail } : {})} />;
                })
              ) : (
                <div className="flex min-h-[255px] flex-col items-center justify-center text-center">
                  <div className="grid size-11 place-items-center rounded-[12px] border border-border bg-bg-elevated text-text-faint">
                    <CircleDashed size={20} />
                  </div>
                  <h3 className="mt-4 text-[14px] font-semibold text-text">
                    Nenhuma execução ativa
                  </h3>
                  <p className="mt-1.5 max-w-sm text-[12px] leading-5 text-text-faint">
                    O Maestro organiza análise, plano, implementação, testes e integração em um
                    fluxo auditável.
                  </p>
                  <Button
                    className="mt-4"
                    size="sm"
                    variant="secondary"
                    onClick={onNewConversation}
                  >
                    <Sparkles size={13} /> Começar com Maestro
                  </Button>
                </div>
              )}
            </div>
          </section>

          <section className="panel min-w-0 overflow-hidden">
            <div className="panel-header">
              <div>
                <h2 className="text-[14px] font-semibold text-text">Atividade</h2>
                <p className="mt-0.5 text-[11px] text-text-faint">Eventos desta sessão</p>
              </div>
              <Activity size={14} className="text-text-faint" />
            </div>
            <div className="max-h-[405px] overflow-y-auto">
              <EventFeed
                events={recentEvents.slice(0, 16)}
                empty="A atividade aparecerá aqui em tempo real."
              />
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div>
                <h2 className="text-[14px] font-semibold text-text">Conversas recentes</h2>
                <p className="mt-0.5 text-[11px] text-text-faint">Continue de onde parou</p>
              </div>
              <button
                className="text-[11px] font-semibold text-primary-soft hover:text-text"
                onClick={() => setView({ type: "history" })}
              >
                Ver histórico
              </button>
            </div>
            <div className="divide-y divide-border/70">
              {bootstrap.recentConversations.length > 0 ? (
                bootstrap.recentConversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover/40"
                    onClick={() => setView({ type: "conversation", id: conversation.id })}
                  >
                    <div className="grid size-8 place-items-center rounded-[8px] bg-bg-elevated text-text-muted">
                      <MessageSquare size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-text">
                        {conversation.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-faint">
                        <span className="uppercase">{conversation.mode}</span>
                        <span>·</span>
                        <Clock3 size={9} />
                        <span>{relativeTime(conversation.updatedAt)}</span>
                      </div>
                    </div>
                    <ArrowRight size={13} className="text-text-faint" />
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-[11px] text-text-faint">
                  Nenhuma conversa ainda.
                </div>
              )}
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div>
                <h2 className="text-[14px] font-semibold text-text">Saúde dos provedores</h2>
                <p className="mt-0.5 text-[11px] text-text-faint">Detecção local e autenticação</p>
              </div>
              <CheckCircle2
                size={14}
                className={readyProviders ? "text-success" : "text-text-faint"}
              />
            </div>
            <div className="divide-y divide-border/70">
              {bootstrap.providers.map((provider) => (
                <div key={provider.descriptor.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span
                    className={`size-2 rounded-full ${provider.health.status === "ready" ? "bg-success" : provider.health.status === "checking" ? "bg-info" : provider.health.status === "unauthenticated" ? "bg-warning" : "bg-danger"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-text">
                      {provider.descriptor.name}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-text-faint">
                      {provider.descriptor.kind.toUpperCase()} · {provider.health.message}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-text-faint">
                    {provider.health.version?.split(" ").at(-1) ?? provider.models.length}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
