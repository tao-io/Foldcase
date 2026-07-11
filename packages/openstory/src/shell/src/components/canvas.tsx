import { type RefObject } from "react";
import { AlertCircle, Accessibility, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StoryStatus } from "@/lib/types";

interface CanvasProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeSrc: string;
  status: StoryStatus;
  storyId: string | undefined;
  a11yViolationCount?: number;
  messageCount?: number;
}

const hasFailure = (status: StoryStatus): boolean =>
  Boolean(status.error) || status.playStatus === "failed";

export const Canvas = ({
  iframeRef,
  iframeSrc,
  status,
  storyId,
  a11yViolationCount = 0,
  messageCount = 0,
}: CanvasProps) => {
  if (!storyId) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        Select a story from the sidebar.
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div className="flex-1 overflow-hidden bg-muted/30">
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title={storyId}
          className={cn("h-full w-full border-0")}
        />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 flex gap-2">
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
