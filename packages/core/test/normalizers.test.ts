import { describe, expect, it } from "vitest";
import { normalizeClaudeEvent, normalizeCodexEvent } from "../src/normalizers.js";

const context = {
  runId: "run",
  taskId: "task",
  agentId: "agent",
  providerId: "provider",
  modelId: "model",
  cwd: "/workspace",
};

describe("native event normalizers", () => {
  it("maps Codex JSONL and tolerates unknown events", () => {
    expect(normalizeCodexEvent({ type: "thread.started", thread_id: "t" }, context)[0]?.type).toBe(
      "agent.started",
    );
    expect(
      normalizeCodexEvent(
        {
          type: "item.started",
          item: { id: "1", type: "command_execution", command: "pnpm test" },
        },
        context,
      )[0]?.type,
    ).toBe("command.started");
    expect(normalizeCodexEvent({ method: "future/event", params: {} }, context)[0]?.type).toBe(
      "log",
    );
    expect(
      normalizeCodexEvent(
        {
          type: "item.completed",
          item: { id: "answer", type: "agent_message", text: "Resposta pública" },
        },
        context,
      )[0],
    ).toMatchObject({
      type: "message.completed",
      data: { taskId: "task", content: "Resposta pública" },
    });
  });

  it("drops Claude thinking while preserving text and tool calls", () => {
    const events = normalizeClaudeEvent(
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "Resposta" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a.ts" } },
          ],
        },
      },
      context,
    );
    expect(events.map((event) => event.type)).toEqual(["message.delta", "tool.started"]);
    expect(events[0]).toMatchObject({ type: "message.delta", data: { taskId: "task" } });
    expect(events[1]).toMatchObject({ type: "tool.started", data: { taskId: "task" } });
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });
});
