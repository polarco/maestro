import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RunState, TaskState } from "@maestro/contracts";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function compactPath(value: string, max = 42): string {
  if (value.length <= max) return value;
  const pieces = value.split(/[\\/]/).filter(Boolean);
  if (pieces.length < 3) return `…${value.slice(-(max - 1))}`;
  return `${pieces[0]}/…/${pieces.slice(-2).join("/")}`;
}

export function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (Math.abs(elapsed) < minute) return "agora";
  if (Math.abs(elapsed) < hour) return formatter.format(-Math.round(elapsed / minute), "minute");
  if (Math.abs(elapsed) < day) return formatter.format(-Math.round(elapsed / hour), "hour");
  return formatter.format(-Math.round(elapsed / day), "day");
}

export function durationLabel(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export const RUN_LABELS: Record<RunState, string> = {
  analyzing: "Analisando",
  planning: "Planejando",
  awaiting_approval: "Aguardando aprovação",
  queued: "Na fila",
  running: "Executando",
  validating: "Validando",
  integrating: "Integrando",
  completed: "Concluída",
  failed: "Falhou",
  canceled: "Cancelada",
};

export const TASK_LABELS: Record<TaskState, string> = {
  pending: "Pendente",
  blocked: "Bloqueada",
  queued: "Na fila",
  running: "Executando",
  validating: "Validando",
  completed: "Concluída",
  failed: "Falhou",
  canceled: "Cancelada",
  skipped: "Ignorada",
};

export function stateTone(
  state: RunState | TaskState,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (state === "completed") return "success";
  if (state === "failed" || state === "canceled") return "danger";
  if (state === "awaiting_approval" || state === "blocked") return "warning";
  if (["analyzing", "planning", "queued", "running", "validating", "integrating"].includes(state))
    return "info";
  return "neutral";
}

export function providerInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
