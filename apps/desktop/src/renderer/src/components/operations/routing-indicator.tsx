import { ArrowRight, BrainCircuit, Route } from "lucide-react";
import type { ModelSelection, ProviderSummary } from "@maestro/contracts";
import { Badge } from "../ui/badge";
import { providerInitials } from "@renderer/lib/utils";

export function RoutingIndicator({
  role,
  selection,
  providers,
  rationale,
}: {
  role: string;
  selection: ModelSelection;
  providers: ProviderSummary[];
  rationale?: string;
}) {
  const provider = providers.find((item) => item.descriptor.id === selection.providerId);
  return (
    <div className="flex items-center gap-3 rounded-[11px] border border-border bg-bg-elevated px-3 py-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-primary/10 text-primary-soft">
        <Route size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-semibold text-text">{role}</span>
          <ArrowRight size={11} className="text-text-faint" />
          <span className="truncate text-text-muted">
            {provider?.descriptor.name ?? selection.providerId}
          </span>
          <span className="truncate font-mono text-[11px] text-text-faint">
            {selection.modelId}
          </span>
        </div>
        {rationale ? (
          <p className="mt-1 truncate text-[10px] text-text-faint" title={rationale}>
            {rationale}
          </p>
        ) : null}
      </div>
      <div className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-[10px] font-semibold text-text-muted">
        {provider ? providerInitials(provider.descriptor.name) : <BrainCircuit size={12} />}
      </div>
      {selection.effort && selection.effort !== "none" ? <Badge>{selection.effort}</Badge> : null}
    </div>
  );
}
