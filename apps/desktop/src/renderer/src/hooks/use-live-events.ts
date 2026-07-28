import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationDetail, RunEvent } from "@maestro/contracts";
import { api } from "@renderer/lib/api";
import { useAppStore } from "@renderer/store/app-store";

export function useLiveEvents(): void {
  const queryClient = useQueryClient();
  const pushEvent = useAppStore((state) => state.pushEvent);

  useEffect(() => {
    return api().onRunEvent((event: RunEvent) => {
      pushEvent(event);
      if (event.type === "message.delta" || event.type === "message.completed") {
        queryClient.setQueriesData<ConversationDetail>(
          { queryKey: ["conversation"] },
          (current) => {
            if (!current) return current;
            const index = current.messages.findIndex(
              (message) => message.id === event.data.messageId,
            );
            if (index < 0) return current;
            const messages = [...current.messages];
            const message = messages[index]!;
            messages[index] = {
              ...message,
              content:
                event.type === "message.delta"
                  ? `${message.content}${event.data.delta}`
                  : event.data.content,
              status: event.type === "message.completed" ? "completed" : "streaming",
              updatedAt: event.occurredAt,
            };
            return { ...current, messages };
          },
        );
      }

      if (
        event.type === "run.state" ||
        event.type === "plan.created" ||
        event.type === "plan.approved" ||
        event.type === "task.state" ||
        event.type === "error"
      ) {
        void queryClient.invalidateQueries({ queryKey: ["run", event.runId] });
        void queryClient.invalidateQueries({ queryKey: ["conversation"] });
        void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      }
    });
  }, [pushEvent, queryClient]);
}
