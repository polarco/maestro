import { randomUUID } from "node:crypto";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderConfigSchema,
  ProviderDescriptor,
  ProviderEventSink,
  ProviderHealth,
  ProviderModel,
  ProviderInput,
  ProviderSession,
  ProviderSessionSpec,
} from "@maestro/contracts";
import { MaestroError } from "@maestro/core";
import type { ProviderDependencies } from "./types.js";

export abstract class ApiProviderAdapter implements ProviderAdapter {
  abstract readonly descriptor: ProviderDescriptor;
  abstract readonly configSchema: ProviderConfigSchema;
  protected readonly dependencies: ProviderDependencies;

  constructor(dependencies: ProviderDependencies) {
    this.dependencies = dependencies;
  }

  abstract detect(signal?: AbortSignal): Promise<ProviderHealth>;
  abstract listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
  abstract chat(
    request: ProviderChatRequest,
    onDelta?: (delta: string) => void,
  ): Promise<ProviderChatResult>;

  createSession(_spec: ProviderSessionSpec, _onEvent: ProviderEventSink): Promise<ProviderSession> {
    return Promise.reject(
      new MaestroError(
        "STRUCTURED_SESSION_UNSUPPORTED",
        `${this.descriptor.name} oferece chat por API, não sessões de coding.`,
      ),
    );
  }

  async resumeSession(
    spec: ProviderSessionSpec,
    onEvent: ProviderEventSink,
  ): Promise<ProviderSession> {
    return this.createSession(spec, onEvent);
  }

  send(_sessionId: string, _prompt: ProviderInput): Promise<ProviderSession> {
    return Promise.reject(
      new MaestroError(
        "STRUCTURED_SESSION_UNSUPPORTED",
        `${this.descriptor.name} não oferece envio por sessão.`,
      ),
    );
  }

  steer(_sessionId: string, _prompt: ProviderInput): Promise<void> {
    return Promise.reject(
      new MaestroError(
        "STEERING_UNSUPPORTED",
        `${this.descriptor.name} não oferece steering de sessão.`,
      ),
    );
  }

  async cancel(_sessionId: string): Promise<void> {
    // API requests are canceled through the AbortSignal supplied to chat().
  }

  async dispose(): Promise<void> {}

  protected logicalSession(): ProviderSession {
    return {
      id: randomUUID(),
      providerId: this.descriptor.id,
      nativeSessionId: null,
      state: "idle",
    };
  }
}
