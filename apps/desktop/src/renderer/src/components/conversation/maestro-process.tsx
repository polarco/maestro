import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardCheck,
  Files,
  FileCode2,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  MessageCircleQuestion,
  Search,
  Send,
  TerminalSquare,
  Users,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  MaestroBrief,
  MaestroDiscovery,
  MaestroQuestion,
  RunDetail,
  RunEvent,
  StructuredQuestionAnswer,
  TaskRun,
} from "@maestro/contracts";
import { RUN_LABELS, TASK_LABELS, cn, stateTone } from "@renderer/lib/utils";
import { Badge } from "../ui/badge";

interface ProcessData {
  discovery?: MaestroDiscovery;
  questions: MaestroQuestion[];
  clarificationRound?: number;
  workspace?: {
    files: number;
    directories: number;
    sources: string[];
    observations: string[];
    truncated: boolean;
  };
  brief?: MaestroBrief;
  dispatch?: Extract<RunEvent, { type: "agents.dispatched" }>["data"];
  execution?: Extract<RunEvent, { type: "execution.summary" }>["data"];
  agentChats: Map<string, AgentChat>;
}

interface AgentChatMessage {
  id: string;
  messageId: string;
  content: string;
  completed: boolean;
}

interface AgentChatActivity {
  id: string;
  kind: "command" | "tool" | "file";
  label: string;
}

interface AgentChat {
  messages: AgentChatMessage[];
  activity: AgentChatActivity[];
}

type DispatchedAgent = Extract<RunEvent, { type: "agents.dispatched" }>["data"]["agents"][number];

function agentChat(result: ProcessData, taskId: string): AgentChat {
  const current = result.agentChats.get(taskId);
  if (current) return current;
  const created: AgentChat = { messages: [], activity: [] };
  result.agentChats.set(taskId, created);
  return created;
}

function addActivity(chat: AgentChat, activity: AgentChatActivity): void {
  if (!chat.activity.some((item) => item.id === activity.id)) chat.activity.push(activity);
}

function processData(events: RunEvent[]): ProcessData {
  const result: ProcessData = { questions: [], agentChats: new Map() };
  for (const event of events) {
    if (event.type === "workspace.inspected") result.workspace = event.data;
    if (event.type === "discovery.completed") result.discovery = event.data.discovery;
    if (event.type === "clarification.requested") {
      result.questions = event.data.questions;
      result.clarificationRound = event.data.round;
    }
    if (event.type === "clarification.answered") result.questions = [];
    if (event.type === "brief.created") result.brief = event.data.brief;
    if (event.type === "agents.dispatched") result.dispatch = event.data;
    if (event.type === "execution.summary") result.execution = event.data;
    if (event.type === "message.delta" && event.data.taskId) {
      const chat = agentChat(result, event.data.taskId);
      const current = chat.messages.at(-1);
      if (current && !current.completed && current.messageId === event.data.messageId) {
        current.content += event.data.delta;
      } else {
        chat.messages.push({
          id: event.id,
          messageId: event.data.messageId,
          content: event.data.delta,
          completed: false,
        });
      }
    }
    if (event.type === "message.completed" && event.data.taskId) {
      const chat = agentChat(result, event.data.taskId);
      const current = chat.messages.at(-1);
      if (current && !current.completed && current.messageId === event.data.messageId) {
        current.content = event.data.content || current.content;
        current.completed = true;
      } else if (
        event.data.content &&
        !(current?.completed && current.content === event.data.content)
      ) {
        chat.messages.push({
          id: event.id,
          messageId: event.data.messageId,
          content: event.data.content,
          completed: true,
        });
      }
    }
    if (event.type === "command.started" && event.data.taskId) {
      addActivity(agentChat(result, event.data.taskId), {
        id: event.id,
        kind: "command",
        label: [event.data.executable, ...event.data.args].join(" "),
      });
    }
    if (event.type === "tool.started" && event.data.taskId) {
      addActivity(agentChat(result, event.data.taskId), {
        id: event.id,
        kind: "tool",
        label: event.data.name,
      });
    }
    if (event.type === "file.diff" && event.data.taskId) {
      addActivity(agentChat(result, event.data.taskId), {
        id: event.id,
        kind: "file",
        label: event.data.path,
      });
    }
  }
  return result;
}

function BulletList({ items, empty }: { items: string[]; empty?: string }) {
  if (items.length === 0)
    return empty ? <p className="text-[10px] leading-4 text-text-faint">{empty}</p> : null;
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${index}:${item}`} className="flex gap-2 text-[10px] leading-4 text-text-muted">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary-soft/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Stage({ label, complete, active }: { label: string; complete: boolean; active: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-semibold",
        complete
          ? "border-success/20 bg-success/[0.07] text-success"
          : active
            ? "border-info/25 bg-info/[0.08] text-info"
            : "border-border bg-bg-elevated text-text-faint",
      )}
    >
      {complete ? (
        <Check size={10} />
      ) : active ? (
        <LoaderCircle className="animate-spin" size={10} />
      ) : (
        <CircleDashed size={10} />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

function activityIcon(kind: AgentChatActivity["kind"]) {
  if (kind === "command") return <TerminalSquare size={11} />;
  if (kind === "file") return <FileCode2 size={11} />;
  return <Wrench size={11} />;
}

function AgentChatCard({
  agent,
  task,
  chat,
}: {
  agent: DispatchedAgent;
  task: TaskRun | undefined;
  chat: AgentChat | undefined;
}) {
  const active = task?.state === "running" || task?.state === "validating";
  const [open, setOpen] = useState(active);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const latestContent = chat?.messages.at(-1)?.content;

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  useEffect(() => {
    if (!open || !transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [latestContent, open, chat?.messages.length, chat?.activity.length]);

  const stateLabel = task ? TASK_LABELS[task.state] : "Na fila";
  const hasTranscript = Boolean(chat?.messages.some((message) => message.content.trim()));

  return (
    <article className="overflow-hidden rounded-[11px] border border-border bg-surface">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-bg-elevated/70"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${open ? "Recolher" : "Abrir"} chat do agente ${agent.title}`}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[9px] border",
            active
              ? "border-info/25 bg-info/10 text-info"
              : task?.state === "completed"
                ? "border-success/20 bg-success/[0.08] text-success"
                : task?.state === "failed"
                  ? "border-danger/20 bg-danger/[0.08] text-danger"
                  : "border-border bg-bg-elevated text-text-faint",
          )}
        >
          <Bot className={cn(active && "animate-pulse")} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold text-text">{agent.title}</span>
          <span className="mt-0.5 block truncate font-mono text-[8px] text-text-faint">
            {agent.role} · {agent.providerId}/{agent.modelId}
          </span>
        </span>
        <Badge tone={task ? stateTone(task.state) : "neutral"} className="h-5 text-[9px]">
          {stateLabel}
        </Badge>
        <ChevronDown
          size={13}
          className={cn("shrink-0 text-text-faint transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="border-t border-border bg-bg-elevated/45 p-3">
          <div
            ref={transcriptRef}
            className="max-h-[360px] space-y-3 overflow-y-auto overscroll-contain pr-1"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary-soft">
                <Send size={10} />
              </span>
              <div className="min-w-0 flex-1 rounded-[10px] rounded-tl-[3px] border border-primary/15 bg-primary/[0.055] px-3 py-2.5">
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-primary-soft">
                  Atribuição do Maestro
                </div>
                <p className="text-[10px] font-semibold leading-4 text-text">
                  {task?.spec.title ?? agent.title}
                </p>
                {task?.spec.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-text-muted">
                    {task.spec.description}
                  </p>
                ) : null}
                {task?.spec.successCriteria.length ? (
                  <div className="mt-2 border-t border-primary/10 pt-2">
                    <div className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-text-faint">
                      Critérios de sucesso
                    </div>
                    <BulletList items={task.spec.successCriteria} />
                  </div>
                ) : null}
              </div>
            </div>

            {chat?.messages.map((message) =>
              message.content.trim() ? (
                <div key={message.id} className="flex items-start gap-2.5">
                  <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-info/10 text-info">
                    <Bot size={11} />
                  </span>
                  <div className="min-w-0 flex-1 rounded-[10px] rounded-tl-[3px] border border-border bg-surface px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-wide text-text-faint">
                      <span>
                        {agent.providerId}/{agent.modelId}
                      </span>
                      {!message.completed ? (
                        <>
                          <span>·</span>
                          <span className="text-info">respondendo</span>
                        </>
                      ) : null}
                    </div>
                    <div className="markdown text-[11px] leading-5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : null,
            )}

            {!hasTranscript ? (
              <div className="flex items-center gap-2 pl-8 text-[10px] text-text-faint">
                {active ? (
                  <>
                    <LoaderCircle className="animate-spin text-info" size={11} /> Agente
                    trabalhando…
                  </>
                ) : task?.state === "completed" ? (
                  "O agente concluiu sem uma resposta textual pública."
                ) : task?.state === "failed" ? (
                  <span className="text-danger">{task.error ?? "O agente falhou."}</span>
                ) : (
                  "Aguardando o agente iniciar."
                )}
              </div>
            ) : null}
          </div>

          {chat?.activity.length ? (
            <details className="mt-3 border-t border-border pt-2.5">
              <summary className="cursor-pointer text-[9px] font-semibold text-text-muted">
                Ações registradas ({chat.activity.length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {chat.activity.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex min-w-0 items-center gap-2 rounded-[7px] border border-border/70 bg-surface px-2.5 py-2 text-[9px] text-text-faint"
                  >
                    <span className="shrink-0 text-info">{activityIcon(activity.kind)}</span>
                    <span className="truncate font-mono" title={activity.label}>
                      {activity.label}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function MaestroProcess({
  detail,
  events,
  onUseAnswer,
  onAnswerQuestions,
}: {
  detail: RunDetail;
  events: RunEvent[];
  onUseAnswer: (answer: string) => void;
  onAnswerQuestions?: (answers: StructuredQuestionAnswer[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [questionAnswers, setQuestionAnswers] = useState<
    Record<string, { selectedOption?: string; freeText?: string }>
  >({});
  const data = processData(events);
  const { run } = detail;
  const plan = detail.plans.at(-1);
  const state = run.state;
  const activeDiscovery = state === "discovering" || state === "analyzing";
  const activeClarification = state === "awaiting_clarification";
  const activeResearch = state === "researching";
  const activePlan = state === "planning" || state === "awaiting_approval";
  const activeAgents = ["queued", "running", "validating", "integrating"].includes(state);
  const terminal = ["completed", "failed", "canceled"].includes(state);
  const allQuestionsAnswered = data.questions.every((question) => {
    const answer = questionAnswers[question.id];
    return Boolean(answer?.selectedOption || answer?.freeText?.trim());
  });

  return (
    <section className="mt-6 overflow-hidden rounded-[16px] border border-info/20 bg-surface shadow-[0_18px_50px_rgb(0_0_0/0.13)]">
      <button
        type="button"
        className="flex w-full items-start gap-3.5 border-b border-border bg-info/[0.035] px-4 py-4 text-left md:px-5"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] border border-info/20 bg-info/10 text-info">
          {state === "failed" || state === "canceled" ? (
            <AlertTriangle size={18} />
          ) : terminal ? (
            <ClipboardCheck size={18} />
          ) : (
            <LoaderCircle className="animate-spin" size={18} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-text">Processo do Maestro</span>
            <Badge tone={stateTone(state)}>{RUN_LABELS[state]}</Badge>
          </span>
          <span className="mt-1.5 block text-[11px] leading-4 text-text-muted">
            Entendimento, decisões, pesquisa e execução visíveis na conversa.
          </span>
        </span>
        <ChevronDown
          size={14}
          className={cn("mt-2 text-text-faint transition-transform", expanded && "rotate-180")}
        />
      </button>

      {expanded ? (
        <div className="space-y-5 p-4 md:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stage
              label="Entender"
              complete={Boolean(data.discovery) && !activeDiscovery}
              active={activeDiscovery}
            />
            <Stage
              label="Alinhar"
              complete={Boolean(data.discovery && !activeClarification)}
              active={activeClarification}
            />
            <Stage label="Pesquisar" complete={Boolean(data.brief)} active={activeResearch} />
            <Stage label="Resumir" complete={Boolean(data.brief)} active={activeResearch} />
            <Stage label="Planejar" complete={Boolean(plan)} active={activePlan} />
            <Stage
              label="Coordenar"
              complete={data.execution?.outcome === "completed"}
              active={activeAgents}
            />
          </div>

          {data.discovery ? (
            <section className="rounded-[12px] border border-border bg-bg-elevated p-4">
              <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold text-text">
                <Lightbulb size={13} className="text-primary-soft" /> O que eu entendi
              </div>
              <p className="text-[11px] leading-5 text-text-muted">
                {data.discovery.understanding}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-[9px] border border-border/70 bg-surface px-3 py-2.5">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-text-faint">
                    Resultado esperado
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-text-muted">
                    {data.discovery.desiredOutcome}
                  </p>
                </div>
                <div className="rounded-[9px] border border-border/70 bg-surface px-3 py-2.5">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-text-faint">
                    Entrega real
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-text-muted">
                    {data.discovery.deliverable}
                  </p>
                </div>
              </div>
            </section>
          ) : activeDiscovery ? (
            <div className="flex items-center gap-3 rounded-[11px] border border-info/15 bg-info/[0.035] px-4 py-3 text-[11px] text-text-muted">
              <Search className="animate-pulse text-info" size={14} />
              Lendo o pedido e reconhecendo a estrutura do projeto antes de decidir o formato.
            </div>
          ) : null}

          {activeClarification && data.questions.length > 0 ? (
            <section className="rounded-[12px] border border-warning/25 bg-warning/[0.045] p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-warning/10 text-warning">
                  <MessageCircleQuestion size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[12px] font-semibold text-text">
                      Preciso alinhar com você
                    </h3>
                    {data.clarificationRound ? (
                      <Badge tone="warning" className="h-5 text-[9px]">
                        Rodada {data.clarificationRound} · conforme necessário
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-text-muted">
                    Estas respostas mudam a solução. O Maestro continuará perguntando enquanto
                    houver decisões materiais em aberto; nada foi planejado ou editado ainda.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {data.questions.map((question, index) => (
                  <div
                    key={question.id}
                    className="rounded-[10px] border border-border bg-surface p-3"
                  >
                    <div className="text-[11px] font-semibold leading-5 text-text">
                      {index + 1}. {question.question}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-text-faint">{question.reason}</p>
                    {question.options.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {question.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[10px] font-medium hover:border-primary/35 hover:bg-primary/[0.06] hover:text-text",
                              questionAnswers[question.id]?.selectedOption === option
                                ? "border-primary/40 bg-primary/[0.08] text-text"
                                : "border-border bg-bg-elevated text-text-muted",
                            )}
                            onClick={() => {
                              if (!onAnswerQuestions) {
                                onUseAnswer(`${index + 1}. ${question.question}\n${option}`);
                                return;
                              }
                              setQuestionAnswers((current) => ({
                                ...current,
                                [question.id]: { ...current[question.id], selectedOption: option },
                              }));
                            }}
                          >
                            <Send size={9} /> {option}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {onAnswerQuestions ? (
                      <input
                        className="mt-2.5 h-9 w-full rounded-[7px] border border-border bg-bg-elevated px-3 text-[10px] text-text outline-none placeholder:text-text-faint focus:border-primary/35"
                        value={questionAnswers[question.id]?.freeText ?? ""}
                        onChange={(event) =>
                          setQuestionAnswers((current) => ({
                            ...current,
                            [question.id]: {
                              ...current[question.id],
                              freeText: event.target.value,
                            },
                          }))
                        }
                        placeholder="Resposta livre ou complemento…"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              {onAnswerQuestions ? (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-primary px-3.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!allQuestionsAnswered}
                    onClick={() =>
                      onAnswerQuestions(
                        data.questions.map((question) => {
                          const answer = questionAnswers[question.id] ?? {};
                          return {
                            questionId: question.id,
                            ...(answer.selectedOption
                              ? { selectedOption: answer.selectedOption }
                              : {}),
                            ...(answer.freeText?.trim()
                              ? { freeText: answer.freeText.trim() }
                              : {}),
                          };
                        }),
                      )
                    }
                  >
                    <Send size={10} /> Enviar respostas e continuar
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          {data.workspace ? (
            <section className="rounded-[12px] border border-border bg-bg-elevated p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-text">
                  <Files size={13} className="text-info" /> Workspace estudado
                </div>
                <Badge tone="neutral">
                  {data.workspace.files} arquivos · {data.workspace.directories} pastas
                </Badge>
                {data.workspace.truncated ? <Badge tone="warning">amostra limitada</Badge> : null}
              </div>
              <BulletList items={data.workspace.observations} />
              {data.workspace.sources.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {data.workspace.sources.map((source) => (
                    <span
                      key={source}
                      className="max-w-full truncate rounded-[6px] border border-border bg-surface px-2 py-1 font-mono text-[9px] text-text-faint"
                      title={source}
                    >
                      {source}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {activeResearch && !data.brief ? (
            <div className="flex items-center gap-3 rounded-[11px] border border-info/15 bg-info/[0.035] px-4 py-3 text-[11px] text-text-muted">
              <BookOpenText className="animate-pulse text-info" size={14} />
              Cruzando suas decisões com os arquivos, anexos e padrões encontrados.
            </div>
          ) : null}

          {data.brief ? (
            <section className="rounded-[12px] border border-success/20 bg-success/[0.035] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-text">
                <ClipboardCheck size={13} className="text-success" /> Brief consolidado
              </div>
              <p className="text-[11px] leading-5 text-text-muted">{data.brief.summary}</p>
              <div className="mt-3 rounded-[9px] border border-success/15 bg-surface px-3 py-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-text-faint">
                  Entrega combinada
                </div>
                <p className="mt-1 text-[10px] font-medium leading-4 text-text">
                  {data.brief.deliverable}
                </p>
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
                    <ListChecks size={11} /> Escopo
                  </div>
                  <BulletList items={data.brief.scope} />
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-text-muted">
                    <CheckCircle2 size={11} /> Critérios de sucesso
                  </div>
                  <BulletList items={data.brief.successCriteria} />
                </div>
              </div>
              {data.brief.findings.length > 0 ? (
                <details className="mt-3 border-t border-border/70 pt-3">
                  <summary className="cursor-pointer text-[10px] font-semibold text-text-muted">
                    Achados e fontes ({data.brief.findings.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {data.brief.findings.map((finding, index) => (
                      <div key={`${index}:${finding.title}`} className="text-[10px] leading-4">
                        <span className="font-semibold text-text-muted">{finding.title}:</span>{" "}
                        <span className="text-text-faint">{finding.detail}</span>{" "}
                        <span className="text-info">({finding.source})</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {data.brief.researchLimits.length > 0 ? (
                <div className="mt-3 flex gap-2 rounded-[8px] border border-warning/15 bg-warning/[0.04] px-3 py-2 text-[9px] leading-4 text-warning">
                  <AlertTriangle className="mt-0.5 shrink-0" size={10} />
                  {data.brief.researchLimits.join(" ")}
                </div>
              ) : null}
            </section>
          ) : null}

          {data.dispatch ? (
            <section className="rounded-[12px] border border-border bg-bg-elevated p-4">
              <div className="mb-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-text">
                  <Users size={13} className="text-info" /> Chats dos agentes
                </div>
                <p className="mt-1 text-[9px] leading-4 text-text-faint">
                  Veja atribuições, respostas públicas e ações de cada agente em tempo real.
                  Raciocínio privado não é registrado.
                </p>
              </div>
              <div className="space-y-2">
                {data.dispatch.agents.map((agent) => {
                  const task = detail.tasks.find((candidate) => candidate.taskId === agent.taskId);
                  return (
                    <AgentChatCard
                      key={agent.taskId}
                      agent={agent}
                      task={task}
                      chat={data.agentChats.get(agent.taskId)}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          {data.execution ? (
            <section
              className={cn(
                "rounded-[12px] border p-4",
                data.execution.outcome === "completed"
                  ? "border-success/20 bg-success/[0.04]"
                  : "border-warning/20 bg-warning/[0.04]",
              )}
            >
              <div className="flex items-start gap-3">
                {data.execution.outcome === "completed" ? (
                  <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={15} />
                ) : (
                  <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={15} />
                )}
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-text">Resumo da execução</div>
                  <p className="mt-1 text-[10px] leading-4 text-text-muted">
                    {data.execution.summary}
                  </p>
                  <p className="mt-2 text-[9px] text-text-faint">
                    {data.execution.completedTasks}/{data.execution.totalTasks} tarefas ·{" "}
                    {data.execution.changedFiles.length} arquivos registrados
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {!data.dispatch ? (
            <div className="flex items-center gap-2 border-t border-border pt-3 text-[9px] text-text-faint">
              <LockKeyhole size={10} className="text-warning" /> Nenhuma edição antes da sua
              aprovação explícita do plano.
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
