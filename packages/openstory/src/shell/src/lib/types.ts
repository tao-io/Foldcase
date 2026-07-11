export interface ManifestStory {
  id: string;
  name: string;
  title: string;
  importPath: string;
  exportName: string;
  componentPath?: string;
  argTypes: Record<string, unknown>;
  initialArgs: Record<string, unknown>;
  parameters: Record<string, unknown>;
  tags: string[];
  hasPlay: boolean;
  hasBeforeEach: boolean;
  hasRender: boolean;
}

export interface ToolbarItem {
  value: unknown;
  title: string;
  icon?: string;
}

export interface ToolbarOptions {
  title?: string;
  icon?: string;
  items: Array<ToolbarItem | unknown>;
  dynamicTitle?: boolean;
}

export interface GlobalType {
  name?: string;
  description?: string;
  defaultValue?: unknown;
  toolbar?: ToolbarOptions;
}

export interface Manifest {
  v: 1;
  generatedAt: string;
  framework: "react" | "solid";
  projectName: string;
  projectRoot: string;
  openstoryVersion: string;
  stories: ManifestStory[];
  globalTypes: Record<string, GlobalType>;
  initialGlobals: Record<string, unknown>;
  parameters: Record<string, unknown>;
}

export interface TreeNode {
  segment: string;
  fullPath: string;
  children: TreeNode[];
  story?: ManifestStory;
}

export type PlayStatus = "running" | "passed" | "failed";

export interface StoryStatus {
  rendered: boolean;
  playStatus?: PlayStatus;
  error?: string;
}

export interface A11yViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  help: string;
  helpUrl: string;
  targets: string[];
}

export interface MessageLogEntry {
  tag: string;
  payload: Record<string, unknown>;
  ts: number;
}

export interface PlayStep {
  name: string;
  index: number;
  status: PlayStatus;
  error?: string;
}
