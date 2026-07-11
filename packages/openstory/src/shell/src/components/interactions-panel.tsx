import { CheckCircle2, ListChecks, Loader2, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { PlayStep } from "@/lib/types";

interface InteractionsPanelProps {
  steps: PlayStep[];
}

const StepIcon = ({ status }: { status: PlayStep["status"] }) => {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
};

export const InteractionsPanel = ({ steps }: InteractionsPanelProps) => {
  if (steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <ListChecks className="h-4 w-4" />
        No interaction steps yet.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ol className="flex flex-col gap-2 p-4">
        {steps.map((step) => (
          <li key={step.index} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <StepIcon status={step.status} />
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                {step.index + 1}
              </span>
              <span
                className={cn(
                  "min-w-0 truncate text-sm",
                  step.status === "failed" ? "text-destructive" : "text-foreground",
                )}
              >
                {step.name}
              </span>
            </div>
            {step.status === "failed" && step.error ? (
              <code className="block truncate pl-6 text-[11px] text-destructive/80">
                {step.error}
              </code>
            ) : null}
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
};
