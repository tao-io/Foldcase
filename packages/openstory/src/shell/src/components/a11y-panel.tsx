import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { A11yViolation } from "@/lib/types";

interface A11yPanelProps {
  violations: A11yViolation[];
}

const impactVariant = (impact: A11yViolation["impact"]): "default" | "destructive" | "outline" => {
  if (impact === "critical" || impact === "serious") return "destructive";
  if (impact === "moderate" || impact === "minor") return "outline";
  return "default";
};

export const A11yPanel = ({ violations }: A11yPanelProps) => {
  if (violations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        No accessibility violations.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul className="flex flex-col gap-3 p-4">
        {violations.map((violation) => (
          <li key={violation.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Badge variant={impactVariant(violation.impact)}>
                {violation.impact ?? "unknown"}
              </Badge>
              <a
                href={violation.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-foreground underline-offset-2 hover:underline"
              >
                {violation.id}
              </a>
            </div>
            <p className="text-xs text-muted-foreground">{violation.help}</p>
            {violation.targets.length > 0 ? (
              <code className="truncate text-[11px] text-muted-foreground/80">
                {violation.targets.join(", ")}
              </code>
            ) : null}
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
};
