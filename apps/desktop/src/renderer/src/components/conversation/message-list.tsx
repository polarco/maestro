import { AlertTriangle, Bot, Paperclip, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@maestro/contracts";
import { cn } from "@renderer/lib/utils";

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Gerando resposta">
      {[0, 1, 2].map((item) => (
        <span
          key={item}
          className="size-1 animate-pulse rounded-full bg-text-faint"
          style={{ animationDelay: `${item * 140}ms` }}
        />
      ))}
    </span>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="space-y-7">
      {messages.map((message) => {
        const user = message.role === "user";
        const time = new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(message.createdAt));
        return (
          <article key={message.id} className={cn("flex gap-3.5", user && "flex-row-reverse")}>
            <div
              className={cn(
                "mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] border shadow-sm",
                user
                  ? "border-primary/20 bg-primary/10 text-primary-soft"
                  : "border-border bg-surface-raised text-text-muted",
              )}
            >
              {user ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={cn("min-w-0 max-w-[86%]", user && "max-w-[78%] text-right")}>
              <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium text-text-faint">
                {user ? (
                  <span className="ml-auto text-text-muted">Você</span>
                ) : (
                  <span className="text-text-muted">Maestro</span>
                )}
                {message.status === "failed" ? <span className="text-danger">falhou</span> : null}
                <span>·</span>
                <time dateTime={message.createdAt}>{time}</time>
              </div>
              <div
                className={cn(
                  "rounded-[15px] border px-4 py-3.5 text-left shadow-[0_6px_24px_rgb(0_0_0/0.055)]",
                  user
                    ? "rounded-tr-[5px] border-primary/18 bg-primary/[0.085]"
                    : "rounded-tl-[5px] border-border bg-surface",
                )}
              >
                {message.status === "failed" ? (
                  <div className="flex gap-2 text-[12px] leading-5 text-danger">
                    <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                    {message.content}
                  </div>
                ) : user ? (
                  <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-text">
                    {message.content}
                  </p>
                ) : message.content ? (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <TypingIndicator />
                )}
                {message.attachments.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border/70 pt-3">
                    {message.attachments.map((attachment) => (
                      <span
                        key={attachment.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2 py-1 text-[10px] text-text-muted"
                      >
                        <Paperclip size={10} />
                        {attachment.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
