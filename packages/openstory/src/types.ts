export type Framework = "react" | "foldkit" | "solid" | "vue" | "svelte";

export interface Manifest {
  v: 1;
  generatedAt: string;
  framework: Framework;
  projectName: string;
  projectRoot: string;
  openstoryVersion: string;
  stories: ManifestStory[];
  globalTypes: Record<string, GlobalType>;
  initialGlobals: Record<string, unknown>;
  parameters: Record<string, unknown>;
}

export interface ManifestStory {
  id: string;
  name: string;
  title: string;
  importPath: string;
  exportName: string;
  componentPath?: string;
  argTypes: Record<string, unknown>;
  initialArgs: Record<string, unknown>;
  parameters: StoryParameters;
  tags: string[];
  hasPlay: boolean;
  hasBeforeEach: boolean;
  hasRender: boolean;
  synthesized?: ManifestStorySynthesized;
}

export interface ManifestStorySynthesized {
  componentExport: string;
}

export interface ArgTypes {
  [argName: string]: ArgType;
}

export interface ArgType {
  name?: string;
  description?: string;
  type?: ArgTypeInfo;
  control?: ControlType;
  options?: unknown[];
  table?: ArgTypeTable;
  if?: ConditionalArg;
}

export interface ArgTypeTable {
  defaultValue?: { summary: string };
  category?: string;
}

export interface ArgTypeInfo {
  name: "string" | "number" | "boolean" | "array" | "object" | "function" | "enum";
  required?: boolean;
}

export interface ControlOptions {
  type: "select" | "radio" | "check";
  options: unknown[];
}

export type ControlType =
  | "boolean"
  | "text"
  | "number"
  | "select"
  | "radio"
  | "check"
  | ControlOptions;

export interface ConditionalArg {
  arg?: string;
  global?: string;
  truthy?: boolean;
  exists?: boolean;
  eq?: unknown;
  neq?: unknown;
}

export interface GlobalType {
  name?: string;
  description?: string;
  defaultValue?: unknown;
  toolbar?: ToolbarOptions;
}

export interface ToolbarOptions {
  title?: string;
  icon?: string;
  items: unknown[];
  dynamicTitle?: boolean;
}

export interface ToolbarItem {
  value: unknown;
  title: string;
  icon?: string;
}

export interface BackgroundsParameter {
  default?: string;
  disable?: boolean;
  values?: Array<{ name: string; value: string }>;
}

export interface ViewportParameter {
  defaultViewport?: string;
  viewports?: Record<string, unknown>;
}

export interface StoryParameters {
  layout?: "centered" | "fullscreen" | "padded";
  backgrounds?: BackgroundsParameter;
  viewport?: ViewportParameter;
  [key: string]: unknown;
}

export interface OpenstoryRenderer<TArgs = unknown, TMounted = unknown> {
  mount: (opts: RendererMountOpts<TArgs>) => TMounted;
  update: (mounted: TMounted, opts: RendererUpdateOpts<TArgs>) => void;
  unmount: (mounted: TMounted) => void;
  defaultRender?: (component: unknown) => (args: TArgs, context: StoryContext<TArgs>) => unknown;
  describeModel?: (mounted: TMounted) => Record<string, unknown> | undefined;
  setModel?: (mounted: TMounted, edit: ModelEdit) => void;
}

export interface ModelEdit {
  path: ReadonlyArray<string>;
  value: unknown;
}

export interface RendererMountOpts<TArgs> {
  container: HTMLElement;
  render: (args: TArgs, context: StoryContext<TArgs>) => unknown;
  args: TArgs;
  context: StoryContext<TArgs>;
}

export interface RendererUpdateOpts<TArgs> {
  render: (args: TArgs, context: StoryContext<TArgs>) => unknown;
  args: TArgs;
  context: StoryContext<TArgs>;
}

export interface Decorator<TArgs = unknown> {
  (storyFn: () => unknown, context: StoryContext<TArgs>): unknown;
}

export interface PlayFunction<TArgs = unknown> {
  (context: PlayContext<TArgs>): void | Promise<void>;
}

export interface BeforeEachCleanup {
  (): void | Promise<void>;
}

export interface BeforeEachFunction<TArgs = unknown> {
  (context: StoryContext<TArgs>): void | BeforeEachCleanup | Promise<void | BeforeEachCleanup>;
}

export interface StepFunction {
  (name: string, body: () => void | Promise<void>): Promise<void>;
}

export interface HooksContext {
  [key: string]: unknown;
}

export interface StoryContext<TArgs = unknown> {
  id: string;
  name: string;
  title: string;
  args: TArgs;
  argTypes: ArgTypes;
  globals: Record<string, unknown>;
  parameters: StoryParameters;
  canvasElement: HTMLElement;
  abortSignal: AbortSignal;
  step: StepFunction;
  hooks: HooksContext;
}

export type PlayContext<TArgs = unknown> = StoryContext<TArgs>;

export interface Meta<TArgs = unknown> {
  title?: string;
  id?: string;
  component?: unknown;
  render?: (args: TArgs, context: StoryContext<TArgs>) => unknown;
  args?: Partial<TArgs>;
  argTypes?: { [Key in keyof TArgs]?: ArgType } | ArgTypes;
  parameters?: StoryParameters;
  decorators?: Decorator<TArgs>[];
  play?: PlayFunction<TArgs>;
  beforeEach?: BeforeEachFunction<TArgs>;
  tags?: string[];
  includeStories?: string[] | RegExp;
  excludeStories?: string[] | RegExp;
}

export interface StoryObj<TMetaOrArgs = unknown> {
  name?: string;
  args?: TMetaOrArgs extends Meta<infer InferredArgs>
    ? Partial<InferredArgs>
    : Partial<TMetaOrArgs>;
  argTypes?: ArgTypes;
  parameters?: StoryParameters;
  decorators?: Decorator<unknown>[];
  render?: (args: unknown, context: StoryContext<unknown>) => unknown;
  play?: PlayFunction<unknown>;
  beforeEach?: BeforeEachFunction<unknown>;
  tags?: string[];
}

export interface Preview {
  decorators?: Decorator<unknown>[];
  parameters?: StoryParameters;
  globalTypes?: Record<string, GlobalType>;
  initialGlobals?: Record<string, unknown>;
  tags?: string[];
}
