export class MaestroError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly detail?: unknown;

  constructor(
    code: string,
    message: string,
    options?: { recoverable?: boolean; detail?: unknown },
  ) {
    super(message);
    this.name = "MaestroError";
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.detail = options?.detail;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro desconhecido";
}
