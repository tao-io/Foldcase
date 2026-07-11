import { type RefObject } from "react";
import { AlertCircle, Accessibility, Activity, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StoryStatus } from "@/lib/types";
import { RESET_BACKGROUND, RESET_VIEWPORT } from "@/lib/viewport-backgrounds";
import type { BackgroundOption, ViewportOption } from "@/lib/viewport-backgrounds";

interface CanvasProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeSrc: string;
  status: StoryStatus;
  storyId: string | undefined;
  viewport?: ViewportOption;
  background?: BackgroundOption;
  a11yViolationCount?: number;
  messageCount?: number;
  stepCount?: number;
}

const hasFailure = (status: StoryStatus): boolean =>
  Boolean(status.error) || status.playStatus === "failed";

export const Canvas = ({
  iframeRef,
  iframeSrc,
  status,
  storyId,
  viewport = RESET_VIEWPORT,
  background = RESET_BACKGROUND,
  a11yViolationCount = 0,
  messageCount = 0,
  stepCount = 0,
}: CanvasProps) => {
  if (!storyId) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        Select a story from the sidebar.
      </div>
    );
  }

  const isReset = viewport.name === RESET_VIEWPORT.name;
  const surfaceColor = background.value === "transparent" ? undefined : background.value;

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div
        data-testid="canvas-surface"
        style={{ backgroundColor: surfaceColor }}
        className={cn(
          "flex flex-1 overflow-auto bg-muted/30",
          isReset ? "" : "items-center justify-center p-4",
        )}
      >
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title={storyId}
          data-testid="canvas-iframe"
          style={{ width: viewport.width, height: viewport.height }}
          className={cn("border-0", isReset ? "" : "max-h-full shrink-0 bg-background shadow-lg")}
        />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex gap-2">
        {stepCount > 0 ? (
          <Badge variant="secondary" className="pointer-events-auto">
            <ListChecks className="h-3 w-3" />
            {`steps: ${stepCount}`}
          </Badge>
        ) : null}
        {messageCount > 0 ? (
          <Badge variant="secondary" className="pointer-events-auto">
            <Activity className="h-3 w-3" />
            {`msgs: ${messageCount}`}
          </Badge>
        ) : null}
        {a11yViolationCount > 0 ? (
          <Badge variant="destructive" className="pointer-events-auto">
            <Accessibility className="h-3 w-3" />
            {`a11y: ${a11yViolationCount}`}
          </Badge>
        ) : null}
        {hasFailure(status) ? (
          <Badge variant="destructive" className="pointer-events-auto">
            <AlertCircle className="h-3 w-3" />
            {status.error ? "Error" : "Play failed"}
          </Badge>
        ) : null}
      </div>
    </div>
  );
};
