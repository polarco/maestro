import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock3, MessageSquare, Search, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { Project } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { relativeTime } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/app-store";
import { Badge } from "@renderer/components/ui/badge";
import { ErrorPane } from "@renderer/components/ui/feedback";
import { Input } from "@renderer/components/ui/form";
import { LoadingPane } from "@renderer/components/ui/skeleton";

const modeLabels = { maestro: "Maestro", agent: "Agente", chat: "Chat" } as const;

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function HistoryPage({ project }: { project: Project }) {
  const setView = useAppStore((state) => state.setView);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(normalizeSearch(search));
  const query = useQuery({
    queryKey: ["conversations", project.id],
    queryFn: () => api().listConversations(project.id, 500),
  });
  if (query.isError) return <ErrorPane error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading) return <LoadingPane />;
  const conversations = (query.data ?? []).filter((conversation) =>
    normalizeSearch(
      [conversation.title, conversation.mode, conversation.providerId, conversation.modelId]
        .filter(Boolean)
        .join(" "),
    ).includes(deferredSearch),
  );
  return (
    <div className="page-enter h-full overflow-y-auto p-5 md:p-6 xl:p-8">
      <div className="mx-auto max-w-[1040px]">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-soft">
              {project.name}
            </div>
            <h1 className="mt-1.5 text-[27px] font-semibold tracking-[-0.035em]">Histórico</h1>
            <p className="mt-1.5 text-[13px] text-text-muted">
              Encontre e retome conversas salvas neste dispositivo.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-3 text-text-faint" size={14} />
            <Input
              className="pl-10 pr-9"
              placeholder="Buscar conversas…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar no histórico"
            />
            {search ? (
              <button
                className="absolute right-2.5 top-2 grid size-6 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
              >
                <X size={13} />
              </button>
            ) : null}
          </div>
        </header>
        <div className="mt-6 flex items-center justify-between px-1 text-[11px] text-text-faint">
          <span>
            {conversations.length} conversa{conversations.length === 1 ? "" : "s"}
            {search ? " encontrada" : " salva"}
            {conversations.length === 1 ? "" : "s"}
          </span>
          <span>Mais recentes primeiro</span>
        </div>
        <div className="panel mt-3 overflow-hidden">
          {conversations.length > 0 ? (
            <div className="divide-y divide-border/70">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-hover/40"
                  onClick={() => setView({ type: "conversation", id: conversation.id })}
                >
                  <div className="grid size-10 place-items-center rounded-[11px] border border-border bg-bg-elevated text-text-muted transition-colors group-hover:border-primary/25 group-hover:text-primary-soft">
                    <MessageSquare size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-text">
                      {conversation.title}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-text-faint">
                      <Clock3 size={10} />
                      <span>{relativeTime(conversation.updatedAt)}</span>
                      {conversation.providerId ? (
                        <>
                          <span>·</span>
                          <span className="truncate">
                            {conversation.providerId}/{conversation.modelId}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Badge
                    tone={
                      conversation.mode === "maestro"
                        ? "primary"
                        : conversation.mode === "agent"
                          ? "info"
                          : "success"
                    }
                  >
                    {modeLabels[conversation.mode]}
                  </Badge>
                  <ArrowRight
                    size={15}
                    className="text-text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="px-6 py-20 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-[14px] border border-border bg-bg-elevated text-text-faint">
                <MessageSquare size={21} />
              </div>
              <p className="mt-4 text-[13px] font-medium text-text-muted">
                {search ? "Nenhuma conversa corresponde à busca." : "Nenhuma conversa registrada."}
              </p>
              {search ? (
                <button
                  className="mt-2 text-[11px] font-semibold text-primary-soft hover:text-text"
                  onClick={() => setSearch("")}
                >
                  Limpar busca
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
