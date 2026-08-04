import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Bot,
  CircleDollarSign,
  Clock3,
  Gauge,
  GitBranch,
  Pause,
  Play,
  RotateCcw,
  Square,
  Zap,
} from "lucide-react";
import type { BackgroundJob, Project } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { cn, relativeTime } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/app-store";

function JobCard({
  job,
  selected,
  onSelect,
}: {
  job: BackgroundJob;
  selected: boolean;
  onSelect: () => void;
}) {
  const setView = useAppStore((state) => state.setView);
  return (
    <article className={cn("mission-job", selected && "is-active")}>
      <div className="flex items-start gap-3">
        <button className="flex min-w-0 flex-1 items-start gap-3" onClick={onSelect}>
          <span
            className={cn(
              "mission-job-icon",
              job.state === "running" && "is-running",
              job.state === "blocked" && "is-blocked",
            )}
          >
            {job.kind === "agent" ? <Bot size={14} /> : <Activity size={14} />}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[12px] font-medium text-text">{job.title}</span>
            <span className="mt-1 flex items-center gap-2 text-[9px] text-text-faint">
              <span className="uppercase">{job.state}</span>
              <span>·</span>
              <span>{relativeTime(job.updatedAt)}</span>
            </span>
          </span>
        </button>
        {job.sessionId ? (
          <button
            aria-label={`Abrir conversa de ${job.title}`}
            className="grid size-7 place-items-center rounded-[7px] text-text-faint hover:bg-surface-hover hover:text-text"
            onClick={() => setView({ type: "conversation", id: job.sessionId! })}
          >
            <GitBranch size={12} />
          </button>
        ) : null}
      </div>
      {job.progress !== null ? (
        <button
          className="mt-3 block h-1 w-full overflow-hidden rounded-full bg-bg-elevated"
          aria-label={`Selecionar ${job.title}, ${Math.round(job.progress * 100)}% concluído`}
          onClick={onSelect}
        >
          <span
            className="block h-full bg-primary transition-[width]"
            style={{ width: `${job.progress * 100}%` }}
          />
        </button>
      ) : null}
    </article>
  );
}

export function MissionControlPage({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: ["jobs", project.id],
    queryFn: () => api().listJobs(project.id),
    refetchInterval: 2_000,
  });
  const selected = jobs.data?.find((job) => job.id === selectedId) ?? jobs.data?.[0] ?? null;
  const steer = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel" | "prioritize") => {
      if (!selected) throw new Error("Selecione um trabalho.");
      return api().steerJob({ jobId: selected.id, action });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs", project.id] }),
  });
  const active = (jobs.data ?? []).filter((job) =>
    ["queued", "running", "blocked"].includes(job.state),
  );
  const tokenTotal = active.reduce((total, job) => total + job.inputTokens + job.outputTokens, 0);
  const costTotal = active.reduce((total, job) => total + job.costUsd, 0);

  return (
    <div className="page-enter flex h-full min-w-0 flex-col bg-bg/45">
      <header className="flex min-h-[66px] items-center gap-3 border-b border-border px-5">
        <div className="grid size-9 place-items-center rounded-[10px] bg-primary/10 text-primary-soft">
          <Activity size={16} />
        </div>
        <div>
          <h1 className="text-[14px] font-semibold text-text">Mission Control</h1>
          <p className="mt-0.5 text-[9.5px] text-text-faint">
            Agentes, dependências, limites e critérios de conclusão
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <span className="mission-metric">
            <Zap size={11} /> {active.length} ativos
          </span>
          <span className="mission-metric">
            <Gauge size={11} /> {tokenTotal.toLocaleString("pt-BR")} tokens
          </span>
          <span className="mission-metric">
            <CircleDollarSign size={11} /> {costTotal.toFixed(3)}
          </span>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-border p-3">
          <div className="mb-2 flex items-center justify-between px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">
            <span>Trabalhos</span>
            <span>{jobs.data?.length ?? 0}</span>
          </div>
          <div className="space-y-2">
            {(jobs.data ?? []).map((job) => (
              <JobCard
                key={job.id}
                job={job}
                selected={selected?.id === job.id}
                onSelect={() => setSelectedId(job.id)}
              />
            ))}
          </div>
          {!jobs.isLoading && !(jobs.data ?? []).length ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center text-text-faint">
              <Clock3 size={22} />
              <p className="mt-3 text-[11px]">Nenhum trabalho registrado.</p>
            </div>
          ) : null}
        </aside>
        <main className="overflow-y-auto p-5">
          {selected ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <section className="panel p-5">
                <div className="flex items-start gap-4">
                  <div className="grid size-11 place-items-center rounded-[12px] bg-info/10 text-info">
                    <Bot size={19} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[16px] font-semibold text-text">{selected.title}</h2>
                    <p className="mt-1 text-[10px] text-text-faint">
                      {selected.kind} · {selected.state} · criado {relativeTime(selected.createdAt)}
                    </p>
                  </div>
                  <span className="rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-[9px] uppercase text-text-muted">
                    {selected.state}
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <div className="mission-detail-metric">
                    <strong>{selected.inputTokens.toLocaleString("pt-BR")}</strong>
                    <span>entrada</span>
                  </div>
                  <div className="mission-detail-metric">
                    <strong>{selected.outputTokens.toLocaleString("pt-BR")}</strong>
                    <span>saída</span>
                  </div>
                  <div className="mission-detail-metric">
                    <strong>US$ {selected.costUsd.toFixed(3)}</strong>
                    <span>custo</span>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {selected.state === "running" ? (
                    <button className="mission-action" onClick={() => steer.mutate("pause")}>
                      <Pause size={12} /> Pausar
                    </button>
                  ) : (
                    <button className="mission-action" onClick={() => steer.mutate("resume")}>
                      <Play size={12} /> Retomar
                    </button>
                  )}
                  <button className="mission-action" onClick={() => steer.mutate("prioritize")}>
                    <Zap size={12} /> Priorizar
                  </button>
                  {!(["completed", "failed", "canceled"] as const).includes(
                    selected.state as never,
                  ) ? (
                    <button
                      className="mission-action is-danger"
                      onClick={() => steer.mutate("cancel")}
                    >
                      <Square size={11} /> Cancelar
                    </button>
                  ) : null}
                </div>
              </section>
              <section className="panel p-5">
                <h3 className="flex items-center gap-2 text-[11px] font-semibold text-text">
                  <GitBranch size={13} /> Dependências e escopo
                </h3>
                <pre className="mt-3 max-h-80 overflow-auto rounded-[10px] bg-bg-elevated p-3 font-mono text-[9.5px] leading-5 text-text-muted">
                  {JSON.stringify(selected.detail, null, 2)}
                </pre>
              </section>
              {selected.state === "blocked" ? (
                <section className="flex gap-3 rounded-[14px] border border-warning/20 bg-warning/[0.04] p-4">
                  <AlertCircle size={16} className="shrink-0 text-warning" />
                  <div>
                    <h3 className="text-[11px] font-semibold text-warning">Aguardando direção</h3>
                    <p className="mt-1 text-[10px] leading-4 text-text-muted">
                      Abra a conversa vinculada para revisar a pergunta, o plano ou o limite
                      solicitado.
                    </p>
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-text-faint">
              <RotateCcw size={14} className="mr-2" /> Aguardando trabalhos
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
