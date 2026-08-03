import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  GitBranch,
  LockKeyhole,
  MessageSquareText,
  Play,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import type { ProviderSummary, RunDetail } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { cn } from "@renderer/lib/utils";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Textarea } from "../ui/form";
import { RoutingIndicator } from "../operations/routing-indicator";

export function PlanApprovalCard({
  detail,
  providers,
}: {
  detail: RunDetail;
  providers: ProviderSummary[];
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [revising, setRevising] = useState(false);
  const [comment, setComment] = useState("");
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [allowCommands, setAllowCommands] = useState(true);
  const plan = detail.plans.at(-1);
  const approve = useMutation({
    mutationFn: () => {
      if (!plan) throw new Error("Plano não encontrado");
      if (!plan.executionPolicy) return api().approveRun(detail.run.id, plan.version);
      return api().approveRunGranular({
        runId: detail.run.id,
        planVersion: plan.version,
        allowedTools: plan.executionPolicy.allowedTools.filter(
          (tool) => !disabledTools.includes(tool),
        ),
        allowedCommands: allowCommands
          ? plan.executionPolicy.allowedExecutables.map((command) =>
              [command.executable, ...command.argsPrefix].join(" "),
            )
          : [],
        writablePaths: plan.executionPolicy.writableRoots,
        network: plan.executionPolicy.network,
      });
    },
    onSuccess: (value) => {
      queryClient.setQueryData(["run", detail.run.id], value);
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      void queryClient.invalidateQueries({ queryKey: ["conversation"] });
    },
  });
  const revise = useMutation({
    mutationFn: () => {
      if (!plan) throw new Error("Plano não encontrado");
      return api().reviseRun(detail.run.id, plan.version, comment);
    },
    onSuccess: () => {
      setComment("");
      setRevising(false);
      void queryClient.invalidateQueries({ queryKey: ["run", detail.run.id] });
    },
  });
  if (!plan) return null;
  const error = approve.error ?? revise.error;

  return (
    <section className="overflow-hidden rounded-[16px] border border-warning/25 bg-surface shadow-[0_18px_50px_rgb(0_0_0/0.16)]">
      <div className="flex items-start gap-3.5 border-b border-border bg-warning/[0.045] px-4 py-4 md:px-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-warning/20 bg-warning/10 text-warning">
          <ShieldCheck size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-text">
              Plano v{plan.version} pronto para revisão
            </h3>
            <Badge tone="warning">Aprovação necessária</Badge>
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-text-muted">{plan.summary}</p>
        </div>
        <button
          className="grid size-8 place-items-center rounded-[7px] text-text-faint hover:bg-surface-hover hover:text-text"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Recolher plano" : "Expandir plano"}
        >
          <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      {expanded ? (
        <div className="p-4 md:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-2">
              {plan.tasks.map((task, index) => (
                <div
                  key={task.id}
                  className="relative flex gap-3 rounded-[11px] border border-border bg-bg-elevated px-3.5 py-3.5"
                >
                  <div className="grid size-6 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 font-mono text-[9px] font-semibold text-primary-soft">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-semibold text-text">
                        {task.title}
                      </span>
                      <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-text-faint">
                        {task.role}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-text-faint">
                      {task.description}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-text-faint">
                      <GitBranch size={9} />
                      <span>
                        {task.dependencies.length > 0
                          ? `depende de ${task.dependencies.join(", ")}`
                          : "sem dependências"}
                      </span>
                      <span className="ml-auto font-mono">
                        {task.model.providerId}/{task.model.modelId}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <aside className="space-y-3">
              <div className="rounded-[11px] border border-border bg-bg-elevated p-3.5">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-text-muted">
                  <Check size={12} className="text-success" /> Critérios de sucesso
                </div>
                <ul className="space-y-1.5">
                  {plan.successCriteria.map((criterion) => (
                    <li
                      key={criterion}
                      className="flex gap-2 text-[10px] leading-4 text-text-faint"
                    >
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-success" />
                      {criterion}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[11px] border border-border bg-bg-elevated p-3.5">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-text-muted">
                  <LockKeyhole size={12} className="text-warning" /> Limite desta aprovação
                </div>
                <p className="text-[10px] leading-4 text-text-faint">
                  Edições e testes apenas nas raízes selecionadas. Push, deploy, publicação,
                  segredos e elevação continuam bloqueados.
                </p>
                {plan.executionPolicy ? (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {plan.executionPolicy.allowedTools.map((tool) => (
                      <label
                        key={tool}
                        className="flex cursor-pointer items-center gap-2 text-[9px] text-text-muted"
                      >
                        <input
                          type="checkbox"
                          checked={!disabledTools.includes(tool)}
                          onChange={(event) =>
                            setDisabledTools((current) =>
                              event.target.checked
                                ? current.filter((item) => item !== tool)
                                : [...current, tool],
                            )
                          }
                        />
                        <span className="font-mono">{tool}</span>
                      </label>
                    ))}
                    {plan.executionPolicy.allowedExecutables.length > 0 ? (
                      <label className="flex cursor-pointer items-center gap-2 text-[9px] text-text-muted">
                        <input
                          type="checkbox"
                          checked={allowCommands}
                          onChange={(event) => setAllowCommands(event.target.checked)}
                        />
                        <span>Executar os comandos de validação listados</span>
                      </label>
                    ) : null}
                    <p className="text-[8.5px] leading-4 text-text-faint">
                      Rede: {plan.executionPolicy.network} · Mutações externas: bloqueadas
                    </p>
                  </div>
                ) : null}
              </div>
            </aside>
          </div>

          <div className="mt-4 grid gap-2">
            {[...new Map(plan.tasks.map((task) => [task.role, task.model])).entries()]
              .slice(0, 3)
              .map(([role, selection]) => (
                <RoutingIndicator
                  key={role}
                  role={role}
                  selection={selection}
                  providers={providers}
                />
              ))}
          </div>

          {revising ? (
            <div className="mt-4 rounded-[10px] border border-primary/20 bg-primary/[0.035] p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-text">
                <MessageSquareText size={13} /> O que deve mudar?
              </div>
              <Textarea
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Ex.: separe a migração do banco e rode os testes de integração depois…"
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setRevising(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!comment.trim() || revise.isPending}
                  onClick={() => revise.mutate()}
                >
                  <RefreshCcw size={12} /> {revise.isPending ? "Gerando v…" : "Gerar nova versão"}
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-md bg-danger/8 px-3 py-2 text-[10px] text-danger">
              {error instanceof Error ? error.message : String(error)}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-[10px] text-text-faint">
              <LockKeyhole size={11} /> Nenhum arquivo foi alterado até aqui
            </div>
            <div className="ml-auto flex gap-2">
              {!revising ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={approve.isPending}
                  onClick={() => setRevising(true)}
                >
                  <MessageSquareText size={12} /> Solicitar ajuste
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={approve.isPending || revise.isPending}
                onClick={() => approve.mutate()}
              >
                <Play size={12} fill="currentColor" />{" "}
                {approve.isPending ? "Liberando…" : "Aprovar e executar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
