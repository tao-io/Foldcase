export type OpenstoryErrorCategory = "config" | "csf" | "render" | "adapter" | "build" | "plugin";

export interface OpenstoryErrorData {
  [key: string]: unknown;
}

export abstract class OpenstoryError extends Error {
  abstract readonly code: string;
  abstract readonly category: OpenstoryErrorCategory;
  abstract readonly exitCode: number;

  readonly data: OpenstoryErrorData;
  readonly docsUrl: string;

  constructor(message: string, data: OpenstoryErrorData = {}) {
    super(message);
    this.name = this.constructor.name;
    this.data = data;
    this.docsUrl = `https://openstory.dev/errors/${this.constructor.name}`;
  }

  override toString(): string {
    return `${this.code}: ${this.message}\n  → ${this.docsUrl}`;
  }
}

export class OpenstoryConfigError extends OpenstoryError {
  readonly category = "config" as const;
  readonly exitCode = 1;
  readonly code: string = "OpenstoryConfigError";
}

export class OpenstoryConfigMissingFrameworkError extends OpenstoryConfigError {
  override readonly code = "OpenstoryConfigMissingFrameworkError";
  constructor(detected: string[]) {
    super(
      `Could not detect a framework. Found in package.json: ${
        detected.length > 0 ? detected.join(", ") : "none"
      }. Install one of: react, solid-js, or set \`framework\` in openstory() options.`,
      { detected },
    );
  }
}

export class OpenstoryConfigAmbiguousFrameworkError extends OpenstoryConfigError {
  override readonly code = "OpenstoryConfigAmbiguousFrameworkError";
  constructor(candidates: string[]) {
    super(
      `Multiple frameworks detected: ${candidates.join(
        ", ",
      )}. Set \`framework\` in openstory() options to disambiguate.`,
      { candidates },
    );
  }
}

export class OpenstoryConfigMultiplePreviewsError extends OpenstoryConfigError {
  override readonly code = "OpenstoryConfigMultiplePreviewsError";
  constructor(found: string[]) {
    super(
      `Multiple preview files found: ${found.join(
        ", ",
      )}. Keep one and delete the others, or set \`preview\` in openstory() options.`,
      { found },
    );
  }
}

export class OpenstoryConfigInvalidOptionsError extends OpenstoryConfigError {
  override readonly code = "OpenstoryConfigInvalidOptionsError";
  constructor(field: string, reason: string) {
    super(`Invalid openstory() option \`${field}\`: ${reason}.`, { field, reason });
  }
}

export class OpenstoryCsfError extends OpenstoryError {
  readonly category = "csf" as const;
  readonly exitCode = 2;
  readonly code: string = "OpenstoryCsfError";
}

export class OpenstoryCsfMissingDefaultExportError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfMissingDefaultExportError";
  constructor(filename: string) {
    super(
      `${filename}: CSF requires a default export with story metadata. Add: \`export default { title: '...' }\`.`,
      { filename },
    );
  }
}

export class OpenstoryCsfBadMetaError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfBadMetaError";
  constructor(filename: string, hint: string) {
    super(`${filename}: default export must be an object literal. ${hint}`, { filename, hint });
  }
}

export class OpenstoryCsfDynamicTitleError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfDynamicTitleError";
  constructor(filename: string, line: number) {
    super(
      `${filename}:${line}: \`title\` must be a string literal. Dynamic titles (expressions, template literals, function calls) are not supported by the static parser.`,
      { filename, line },
    );
  }
}

export class OpenstoryCsfDuplicateStoryIdError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfDuplicateStoryIdError";
  constructor(id: string, files: string[]) {
    super(
      `Duplicate story id "${id}" across files: ${files.join(
        ", ",
      )}. Disambiguate via meta.id or meta.title.`,
      { id, files },
    );
  }
}

export class OpenstoryCsfInvalidTitleError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfInvalidTitleError";
  constructor(filename: string, title: string) {
    super(`${filename}: Invalid title "${title}". Must include alphanumeric characters.`, {
      filename,
      title,
    });
  }
}

export class OpenstoryCsfInvalidStoryNameError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfInvalidStoryNameError";
  constructor(name: string) {
    super(`Invalid story name "${name}". Must include alphanumeric characters.`, { name });
  }
}

export class OpenstoryCsfInvalidTagError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfInvalidTagError";
  constructor(filename: string, hint: string) {
    super(`${filename}: ${hint}`, { filename });
  }
}

export class OpenstoryCsfStoriesOfError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfStoriesOfError";
  constructor(filename: string) {
    super(
      `${filename}: \`storiesOf\` is not supported. Use CSF 3 (default export with object literal + named story exports).`,
      { filename },
    );
  }
}

export class OpenstoryCsfParseError extends OpenstoryCsfError {
  override readonly code = "OpenstoryCsfParseError";
  constructor(filename: string, message: string) {
    super(`${filename}: failed to parse. ${message}`, { filename, parseMessage: message });
  }
}

export class OpenstoryAdapterError extends OpenstoryError {
  readonly category = "adapter" as const;
  readonly exitCode = 3;
  readonly code: string = "OpenstoryAdapterError";
}

export class OpenstoryAdapterMissingFrameworkError extends OpenstoryAdapterError {
  override readonly code = "OpenstoryAdapterMissingFrameworkError";
  constructor(framework: string, install: string) {
    super(
      `foldcase/${framework} requires ${install} to be installed. Run \`pnpm add ${install}\`.`,
      { framework, install },
    );
  }
}

export class OpenstoryRenderError extends OpenstoryError {
  readonly category = "render" as const;
  readonly exitCode = 4;
  readonly code: string = "OpenstoryRenderError";
}

const KNOWN_IDS_PREVIEW_LIMIT = 5;

export class OpenstoryStoryNotFoundError extends OpenstoryRenderError {
  override readonly code = "OpenstoryStoryNotFoundError";
  constructor(id: string, knownIds: string[]) {
    const shownIds = knownIds.slice(0, KNOWN_IDS_PREVIEW_LIMIT).join(", ");
    const overflow =
      knownIds.length > KNOWN_IDS_PREVIEW_LIMIT
        ? ` (+${knownIds.length - KNOWN_IDS_PREVIEW_LIMIT} more)`
        : "";
    super(`Story "${id}" not found. Available: ${shownIds}${overflow}.`, {
      id,
      knownIds,
    });
  }
}

export class OpenstoryBeforeEachError extends OpenstoryRenderError {
  override readonly code = "OpenstoryBeforeEachError";
  constructor(storyId: string, cause: unknown) {
    super(
      `${storyId}: beforeEach hook threw. ${cause instanceof Error ? cause.message : String(cause)}`,
      { storyId },
    );
    if (cause instanceof Error) this.cause = cause;
  }
}

export class OpenstoryPlayError extends OpenstoryRenderError {
  override readonly code = "OpenstoryPlayError";
  constructor(storyId: string, cause: unknown) {
    super(
      `${storyId}: play function threw. ${cause instanceof Error ? cause.message : String(cause)}`,
      { storyId },
    );
    if (cause instanceof Error) this.cause = cause;
  }
}

export class OpenstoryMountError extends OpenstoryRenderError {
  override readonly code = "OpenstoryMountError";
  constructor(storyId: string, cause: unknown) {
    super(`${storyId}: mount threw. ${cause instanceof Error ? cause.message : String(cause)}`, {
      storyId,
    });
    if (cause instanceof Error) this.cause = cause;
  }
}

export class OpenstoryPluginError extends OpenstoryError {
  readonly category = "plugin" as const;
  readonly exitCode = 1;
  readonly code: string = "OpenstoryPluginError";
}

export class OpenstoryPluginManifestSchemaError extends OpenstoryPluginError {
  override readonly code = "OpenstoryPluginManifestSchemaError";
  constructor(reason: string) {
    super(`Manifest schema validation failed: ${reason}.`, { reason });
  }
}

export class OpenstoryBuildError extends OpenstoryError {
  readonly category = "build" as const;
  readonly exitCode = 4;
  readonly code: string = "OpenstoryBuildError";
}

export class OpenstoryBuildFailedError extends OpenstoryBuildError {
  override readonly code = "OpenstoryBuildFailedError";
  constructor(reason: string) {
    super(`Build failed: ${reason}.`, { reason });
  }
}
