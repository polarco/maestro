import {
  AlertTriangle,
  File,
  FileAudio,
  FileText,
  FileVideo,
  Folder,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  X,
} from "lucide-react";
import type { ContextAssetSummary, ContextProcessingEvent } from "@maestro/contracts";
import { cn } from "@renderer/lib/utils";

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MiB`;
  return `${(value / 1_073_741_824).toFixed(1)} GiB`;
}

function KindIcon({ kind }: Pick<ContextAssetSummary, "kind">) {
  if (kind === "image") return <ImageIcon size={15} />;
  if (kind === "audio") return <FileAudio size={15} />;
  if (kind === "video") return <FileVideo size={15} />;
  if (kind === "folder") return <Folder size={15} />;
  if (kind === "text" || kind === "document") return <FileText size={15} />;
  return <File size={15} />;
}

export function ContextAssetTray({
  assets,
  progress,
  onRemove,
}: {
  assets: ContextAssetSummary[];
  progress: ReadonlyMap<string, ContextProcessingEvent>;
  onRemove: (asset: ContextAssetSummary) => void;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="context-asset-tray" aria-label="Itens anexados">
      {assets.map((asset) => {
        const processing = progress.get(asset.id);
        const busy = asset.status === "staging" || asset.status === "processing";
        const failed = asset.status === "error" || asset.status === "missing";
        return (
          <div
            key={asset.id}
            className={cn("context-asset-chip", failed && "is-error")}
            title={asset.relativePath ?? asset.name}
          >
            <div className="context-asset-thumb">
              {asset.thumbnailUrl ? (
                <img src={asset.thumbnailUrl} alt="" />
              ) : asset.source === "recording" ? (
                <Mic size={15} />
              ) : (
                <KindIcon kind={asset.kind} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10.5px] font-semibold text-text">{asset.name}</div>
              <div
                className={cn(
                  "mt-0.5 flex items-center gap-1 truncate text-[9px] text-text-faint",
                  failed && "text-danger",
                  asset.status === "needs_model" && "text-warning",
                )}
              >
                {busy ? <LoaderCircle className="animate-spin" size={9} /> : null}
                {failed ? <AlertTriangle size={9} /> : null}
                <span className="truncate">
                  {processing?.message ??
                    asset.error ??
                    asset.warning ??
                    `${asset.kind} · ${formatBytes(asset.size)}`}
                </span>
              </div>
              {busy && processing?.progress !== null && processing?.progress !== undefined ? (
                <div className="context-asset-progress">
                  <span style={{ width: `${Math.round(processing.progress * 100)}%` }} />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="context-asset-remove"
              aria-label={`Remover ${asset.name}`}
              title={busy ? "Cancelar e remover" : "Remover"}
              onClick={() => onRemove(asset)}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
