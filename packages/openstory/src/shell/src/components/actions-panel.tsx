import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MessageLogEntry } from "@/lib/types";

interface ActionsPanelProps {
  messages: MessageLogEntry[];
}

const hasPayload = (payload: Record<string, unknown>): boolean => Object.keys(payload).length > 0;

export const ActionsPanel = ({ messages }: ActionsPanelProps) => {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <Activity className="h-4 w-4" />
        No messages dispatched yet.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul className="flex flex-col gap-2 p-4">
        {messages.map((message, index) => (
          <li key={`${message.ts}-${index}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {message.tag}
              </Badge>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                {new Date(message.ts).toLocaleTimeString()}
              </span>
            </div>
            {hasPayload(message.payload) ? (
              <code className="block truncate text-[11px] text-muted-foreground/80">
                {JSON.stringify(message.payload)}
              </code>
            ) : null}
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
};
