export const DEFAULT_DEV_PORT = 6006;

export const DEFAULT_STORY_GLOBS = ["**/*.stories.{ts,tsx,js,jsx}"];

export const DEFAULT_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/test-results/**",
  "**/storybook-static/**",
  "**/openstory-static/**",
];

export const DEFAULT_COMPONENT_GLOBS_BY_FRAMEWORK: Record<string, string[]> = {
  react: ["**/*.{tsx,jsx}"],
  foldkit: ["**/main.ts"],
  solid: ["**/*.{tsx,jsx}"],
  vue: ["**/*.vue"],
  svelte: ["**/*.svelte"],
};

export const COMPONENT_IGNORE_GLOBS = [
  "**/*.stories.{ts,tsx,js,jsx}",
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/preview.{ts,tsx,js,jsx}",
  "**/vite.config.{ts,js,mts,mjs}",
  "**/vitest.config.{ts,js,mts,mjs}",
];

export const PREVIEW_FILE_LOCATIONS = ["preview", "src/preview"];
export const PREVIEW_FILE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

export const STORY_PATH_PREFIX = "/__story/";
export const MANIFEST_PATH = "/__openstory/manifest.json";

export const VIRTUAL_STORY_ENTRY_ID = "virtual:openstory-story-entry";
export const VIRTUAL_NULL_PREFIX = "\0";

export const VITE_INTERNAL_QUERY_RE =
  /[?&](?:html-proxy|import|t=|raw|url|inline|worker|sharedworker)/;

export const OPENSTORY_ROOT_ELEMENT_ID = "openstory-root";
export const OPENSTORY_LAYOUT_CLASSES: Record<string, string> = {
  centered: "openstory-layout-centered",
  fullscreen: "openstory-layout-fullscreen",
  padded: "openstory-layout-padded",
};
export const OPENSTORY_DEFAULT_LAYOUT = "padded";

export const URL_KV_PAIR_SEPARATOR = ";";
export const URL_KV_KEY_VALUE_SEPARATOR = ":";

export const OPENSTORY_FRAMEWORK_TO_ADAPTER: Record<string, string> = {
  react: "foldcase/react",
  foldkit: "foldcase/foldkit",
  solid: "foldcase/solid",
  vue: "foldcase/vue",
  svelte: "foldcase/svelte",
};

export const PARENT_MESSAGE_SOURCE = "openstory";
export const SHELL_MESSAGE_SOURCE = "openstory-shell";

export const PROPS_TYPE_RESOLUTION_MAX_HOPS = 8;
export const PROPS_CROSS_FILE_RESOLUTION_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".d.ts",
  "/index.ts",
  "/index.tsx",
  "/index.d.ts",
];
export const PROPS_FC_TYPE_NAMES = new Set([
  "FC",
  "FunctionComponent",
  "VoidFunctionComponent",
  "VFC",
  "Component",
]);
export const PROPS_FORWARD_REF_NAMES = new Set(["forwardRef", "memo"]);
export const PROPS_UTILITY_TYPE_NAMES = new Set([
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Record",
  "NonNullable",
]);
export const PROPS_NODE_TYPE_REFERENCE_NAMES = new Set([
  "ReactNode",
  "ReactElement",
  "ReactChild",
  "ReactChildren",
  "ReactPortal",
  "ReactFragment",
  "Element",
  "VNode",
  "Snippet",
  "ComponentChildren",
  "JSXElement",
]);
export const PROPS_DOM_PROPS_TYPE_NAMES = new Set([
  "HTMLAttributes",
  "AllHTMLAttributes",
  "ButtonHTMLAttributes",
  "AnchorHTMLAttributes",
  "InputHTMLAttributes",
  "TextareaHTMLAttributes",
  "SelectHTMLAttributes",
  "FormHTMLAttributes",
  "ImgHTMLAttributes",
  "DetailedHTMLProps",
  "ComponentProps",
  "ComponentPropsWithRef",
  "ComponentPropsWithoutRef",
  "HTMLProps",
  "SVGAttributes",
  "SVGProps",
  "AriaAttributes",
  "DOMAttributes",
]);
export const PROPS_NODE_NAME_HINTS = new Set([
  "children",
  "icon",
  "leadingIcon",
  "trailingIcon",
  "startContent",
  "endContent",
  "leftSlot",
  "rightSlot",
  "header",
  "footer",
]);
export const PROPS_DATE_NAME_HINTS = new Set([
  "date",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "startedAt",
  "endedAt",
  "expiresAt",
  "completedAt",
  "timestamp",
  "time",
]);
export const PROPS_DATE_PLACEHOLDER_ISO = "2026-01-01T00:00:00.000Z";
export const PROPS_EVENT_HANDLER_PREFIX = "on";
export const PROPS_VARIANT_NAME_PRIORITY = [
  "variant",
  "intent",
  "kind",
  "appearance",
  "tone",
  "color",
  "type",
  "size",
];
export const PROPS_ARG_NOISE = new Set([
  "ref",
  "key",
  "className",
  "style",
  "id",
  "testId",
  "data-testid",
  "data-test-id",
  "as",
  "asChild",
  "render",
  "slot",
]);
export const PROPS_REF_TYPE_NAMES = new Set([
  "RefObject",
  "MutableRefObject",
  "Ref",
  "ForwardedRef",
  "LegacyRef",
  "RefCallback",
]);
export const PROPS_ARRAY_TYPE_NAMES = new Set([
  "Array",
  "ReadonlyArray",
  "Iterable",
  "ArrayLike",
  "Set",
  "ReadonlySet",
]);
export const PROPS_OBJECT_TYPE_NAMES = new Set([
  "Record",
  "Map",
  "ReadonlyMap",
  "WeakMap",
  "WeakSet",
  "Object",
]);
export const PROPS_LOADING_NAMES = new Set(["isLoading", "loading", "pending", "isPending"]);
export const PROPS_DISABLED_NAMES = new Set(["disabled", "isDisabled"]);
export const PROPS_ERROR_NAMES = new Set(["error", "hasError", "isError"]);
export const PROPS_OPEN_NAMES = new Set(["open", "defaultOpen", "isOpen"]);
export const PROPS_PRESSED_NAMES = new Set(["pressed", "defaultPressed", "isPressed", "active"]);
export const PROPS_SELECTED_NAMES = new Set([
  "selected",
  "defaultSelected",
  "isSelected",
  "checked",
  "defaultChecked",
  "isChecked",
  "expanded",
  "defaultExpanded",
]);
export const PROPS_PLACEHOLDER_STRING_VALUE = "Hello world";
export const STORY_DEFAULT_EXPORT_NAME = "Default";
export const STORY_FILE_HEADER = "Generated by openstory.";
export const STORY_MAX_VARIANT_STORIES = 12;
export const TSCONFIG_MAX_EXTENDS_HOPS = 5;
