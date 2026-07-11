export interface ViewportOption {
  /** Stable key used as the select value and default lookup. */
  name: string;
  /** Human label shown in the toolbar. */
  label: string;
  /** CSS width applied to the canvas iframe (e.g. "375px" or "100%"). */
  width: string;
  /** CSS height applied to the canvas iframe. */
  height: string;
}

export interface BackgroundOption {
  /** Stable key used as the select value and default lookup. */
  name: string;
  /** Human label shown in the toolbar. */
  label: string;
  /** CSS color applied behind the canvas iframe ("transparent" clears it). */
  value: string;
}

/** The always-present "no constraint" viewport: fills the canvas. */
export const RESET_VIEWPORT: ViewportOption = {
  name: "reset",
  label: "Responsive",
  width: "100%",
  height: "100%",
};

/** The always-present "no override" background: inherits the shell surface. */
export const RESET_BACKGROUND: BackgroundOption = {
  name: "reset",
  label: "Default",
  value: "transparent",
};

/** Built-in device presets, offered when a Showcase declares none. */
export const BUILTIN_VIEWPORTS: ReadonlyArray<ViewportOption> = [
  { name: "mobile", label: "Mobile", width: "375px", height: "667px" },
  { name: "tablet", label: "Tablet", width: "768px", height: "1024px" },
  { name: "desktop", label: "Desktop", width: "1280px", height: "800px" },
];

/** Built-in color presets, offered when a Showcase declares none. */
export const BUILTIN_BACKGROUNDS: ReadonlyArray<BackgroundOption> = [
  { name: "light", label: "Light", value: "#ffffff" },
  { name: "dark", label: "Dark", value: "#1a1a1a" },
];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Resolve the viewport selector options for a set of merged parameters.
 * A Showcase's declared `viewport.viewports` (Storybook shape: `{ name, styles: {
 * width, height } }`) win; otherwise the built-in device presets are offered. The
 * reset option is always first.
 */
export const resolveViewportOptions = (
  parameters: Record<string, unknown>,
): ReadonlyArray<ViewportOption> => {
  const viewport = asRecord(parameters.viewport);
  const declared = viewport ? asRecord(viewport.viewports) : undefined;
  if (declared && Object.keys(declared).length > 0) {
    const options = Object.entries(declared).map(([key, raw]): ViewportOption => {
      const entry = asRecord(raw) ?? {};
      const styles = asRecord(entry.styles) ?? {};
      return {
        name: key,
        label: asString(entry.name) ?? key,
        width: asString(styles.width) ?? "100%",
        height: asString(styles.height) ?? "100%",
      };
    });
    return [RESET_VIEWPORT, ...options];
  }
  return [RESET_VIEWPORT, ...BUILTIN_VIEWPORTS];
};

/** The initially-selected viewport name (a declared `defaultViewport`, else reset). */
export const resolveDefaultViewportName = (parameters: Record<string, unknown>): string => {
  const viewport = asRecord(parameters.viewport);
  return asString(viewport?.defaultViewport) ?? RESET_VIEWPORT.name;
};

/**
 * Resolve the background selector options for a set of merged parameters.
 * A Showcase's declared `backgrounds.values` (`{ name, value }`) win; otherwise the
 * built-in color presets are offered. `backgrounds.disable` hides the selector
 * (returns no options). The reset option is always first.
 */
export const resolveBackgroundOptions = (
  parameters: Record<string, unknown>,
): ReadonlyArray<BackgroundOption> => {
  const backgrounds = asRecord(parameters.backgrounds);
  if (backgrounds?.disable === true) return [];
  const values = Array.isArray(backgrounds?.values) ? backgrounds.values : undefined;
  if (values && values.length > 0) {
    const options = values.flatMap((raw): ReadonlyArray<BackgroundOption> => {
      const entry = asRecord(raw);
      const name = asString(entry?.name);
      const value = asString(entry?.value);
      if (name === undefined || value === undefined) return [];
      return [{ name, label: name, value }];
    });
    return [RESET_BACKGROUND, ...options];
  }
  return [RESET_BACKGROUND, ...BUILTIN_BACKGROUNDS];
};

/** The initially-selected background name (a declared `default`, else reset). */
export const resolveDefaultBackgroundName = (parameters: Record<string, unknown>): string => {
  const backgrounds = asRecord(parameters.backgrounds);
  return asString(backgrounds?.default) ?? RESET_BACKGROUND.name;
};
