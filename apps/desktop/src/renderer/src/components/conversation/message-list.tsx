import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  File,
  FileAudio,
  FileText,
  FileVideo,
  Folder,
  Image as ImageIcon,
  Paperclip,
  User,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContextAssetSummary, Message } from "@maestro/contracts";
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

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MiB`;
  return `${(value / 1_073_741_824).toFixed(1)} GiB`;
}

function KindIcon({ asset }: { asset: ContextAssetSummary }) {
  if (asset.kind === "image") return <ImageIcon size={15} />;
  if (asset.kind === "audio") return <FileAudio size={15} />;
  if (asset.kind === "video") return <FileVideo size={15} />;
  if (asset.kind === "folder") return <Folder size={15} />;
  if (asset.kind === "document" || asset.kind === "text") return <FileText size={15} />;
  return <File size={15} />;
}

function ContextAssetCard({
  asset,
  onOpenImage,
}: {
  asset: ContextAssetSummary;
  onOpenImage: (asset: ContextAssetSummary) => void;
}) {
  const stateLabel =
    asset.changeState === "changed"
      ? "alterado desde o envio"
      : asset.changeState === "missing" || asset.status === "missing"
        ? "arquivo ausente"
        : null;
  const details = [
    asset.source === "workspace" ? asset.relativePath : null,
    formatBytes(asset.size),
    asset.pageCount ? `${asset.pageCount} pág.` : null,
  ].filter(Boolean);

  return (
    <div className={cn("message-asset", stateLabel && "is-stale")}>
      {asset.kind === "image" && asset.previewUrl ? (
        <button
          type="button"
          className="message-asset-image"
          onClick={() => onOpenImage(asset)}
          aria-label={`Abrir ${asset.name}`}
        >
          <img src={asset.thumbnailUrl ?? asset.previewUrl} alt={asset.name} loading="lazy" />
        </button>
      ) : asset.kind === "video" && asset.previewUrl ? (
        <video
          className="message-asset-video"
          controls
          preload="metadata"
          poster={asset.thumbnailUrl ?? undefined}
          src={asset.previewUrl}
        />
      ) : asset.kind === "audio" && asset.previewUrl ? (
        <div className="message-asset-player">
          <FileAudio size={15} />
          <audio controls preload="metadata" src={asset.previewUrl} />
        </div>
      ) : (
        <div className="message-asset-document">
          <span className="message-asset-icon">
            <KindIcon asset={asset} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold text-text">{asset.name}</div>
            <div className="mt-0.5 truncate text-[9px] text-text-faint">{details.join(" · ")}</div>
          </div>
        </div>
      )}
      {(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio") && (
        <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
          <span className="truncate text-[10px] font-medium text-text">{asset.name}</span>
          <span className="ml-auto shrink-0 text-[9px] text-text-faint">
            {formatBytes(asset.size)}
          </span>
        </div>
      )}
      {stateLabel ? (
        <div className="flex items-center gap-1 border-t border-warning/15 px-2.5 py-1.5 text-[9px] text-warning">
          <AlertTriangle size={9} /> {stateLabel}
        </div>
      ) : null}
      {asset.warning ? (
        <div className="border-t border-border/70 px-2.5 py-1.5 text-[9px] text-warning">
          {asset.warning}
        </div>
      ) : null}
      {asset.transcription ? (
        <details className="border-t border-border/70 px-2.5 py-2 text-[10px] text-text-muted">
          <summary className="cursor-pointer select-none font-medium text-text-faint">
            Transcrição local
          </summary>
          <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap leading-4">
            {asset.transcription}
          </p>
        </details>
      ) : null}
    </div>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  const [lightbox, setLightbox] = useState<ContextAssetSummary | null>(null);
  if (messages.length === 0) return null;
  return (
    <>
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
                    message.content ? (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-text">
                        {message.content}
                      </p>
                    ) : null
                  ) : message.content ? (
                    <div className="markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <TypingIndicator />
                  )}
                  {message.contextAssets.length > 0 ? (
                    <div className="message-assets">
                      {message.contextAssets.map((asset) => (
                        <ContextAssetCard key={asset.id} asset={asset} onOpenImage={setLightbox} />
                      ))}
                    </div>
                  ) : null}
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
      {lightbox?.previewUrl ? (
        <div
          className="attachment-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.name}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="attachment-lightbox-close"
            onClick={() => setLightbox(null)}
            aria-label="Fechar imagem"
          >
            <X size={18} />
          </button>
          <img
            src={lightbox.previewUrl}
            alt={lightbox.name}
            onClick={(event) => event.stopPropagation()}
          />
          <span>{lightbox.name}</span>
        </div>
      ) : null}
    </>
  );
}
