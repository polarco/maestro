import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Renderer error", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-screen place-items-center bg-bg p-8 text-text">
        <div className="w-full max-w-md rounded-[14px] border border-danger/25 bg-surface p-6">
          <div className="mb-4 grid size-10 place-items-center rounded-[10px] bg-danger/10 text-danger">
            <AlertTriangle size={19} />
          </div>
          <h1 className="text-lg font-semibold">A interface encontrou um erro</h1>
          <p className="mt-2 text-sm leading-6 text-text-muted">{this.state.error.message}</p>
          <Button className="mt-5" variant="secondary" onClick={() => window.location.reload()}>
            <RotateCcw size={14} /> Recarregar interface
          </Button>
        </div>
      </div>
    );
  }
}
