import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  modelSchemaToControls,
  type JsonSchemaNode,
  type SchemaControl,
} from "@/lib/model-schema-controls";
import type { ManifestStory } from "@/lib/types";

interface ControlsPanelProps {
  story: ManifestStory | undefined;
  args: Record<string, unknown>;
  modelSchema?: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onModelEdit?: (path: ReadonlyArray<string>, value: unknown) => void;
  onReset: () => void;
}

type ResolvedControl = "text" | "number" | "boolean" | "select" | "computed";

interface ResolvedArgType {
  name: string;
  control: ResolvedControl;
  options?: unknown[];
  initial?: unknown;
}

interface ArgTypeDefinition {
  control?: unknown;
  options?: unknown[];
}

interface ArgTypeControlConfig {
  type: unknown;
  options?: unknown[];
}

const readObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readArray = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

const readArgType = (raw: unknown): ArgTypeDefinition => {
  const definitionObject = readObject(raw);
  if (!definitionObject) return {};
  return {
    control: definitionObject["control"],
    options: readArray(definitionObject["options"]),
  };
};

const resolveControlType = (
  argName: string,
  definition: ArgTypeDefinition,
  initialArgs: Record<string, unknown>,
): { control: ResolvedControl; options?: unknown[] } => {
  const controlObject = readObject(definition.control) as ArgTypeControlConfig | undefined;
  const stringControl = typeof definition.control === "string" ? definition.control : undefined;
  const controlName = stringControl ?? (controlObject ? String(controlObject.type) : undefined);

  const options = controlObject?.options ?? definition.options;

  if (controlName === "boolean") return { control: "boolean" };
  if (controlName === "number") return { control: "number" };
  if (controlName === "text") return { control: "text" };
  if (controlName === "select" || controlName === "radio" || controlName === "check") {
    return { control: "select", options };
  }

  const inferredFromValue = initialArgs[argName];
  if (typeof inferredFromValue === "boolean") return { control: "boolean" };
  if (typeof inferredFromValue === "number") return { control: "number" };
  if (typeof inferredFromValue === "string") return { control: "text" };

  return { control: "computed" };
};

const schemaControlToArgType = (
  control: SchemaControl,
  initialArgs: Record<string, unknown>,
): ResolvedArgType => ({
  name: control.name,
  control: control.control === "unsupported" ? "computed" : control.control,
  options: control.options ? [...control.options] : undefined,
  initial: initialArgs[control.name],
});

const resolveSchemaArgTypes = (
  modelSchema: Record<string, unknown>,
  initialArgs: Record<string, unknown>,
): ResolvedArgType[] =>
  modelSchemaToControls(modelSchema as JsonSchemaNode).map((control) =>
    schemaControlToArgType(control, initialArgs),
  );

const resolveArgTypes = (story: ManifestStory): ResolvedArgType[] => {
  const argTypes = story.argTypes as Record<string, unknown>;
  const initialArgs = story.initialArgs;
  return Object.entries(argTypes).map(([argName, rawDefinition]) => {
    const definition = readArgType(rawDefinition);
    const { control, options } = resolveControlType(argName, definition, initialArgs);
    return {
      name: argName,
      control,
      options,
      initial: initialArgs[argName],
    };
  });
};

interface ControlInputProps {
  argType: ResolvedArgType;
  value: unknown;
  onChange: (next: unknown) => void;
}

const ControlInput = ({ argType, value, onChange }: ControlInputProps) => {
  if (argType.control === "boolean") {
    return <Switch checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked)} />;
  }
  if (argType.control === "number") {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    );
  }
  if (argType.control === "select" && argType.options) {
    return (
      <Select value={String(value ?? "")} onValueChange={(next) => onChange(next)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {argType.options.map((option) => (
            <SelectItem key={String(option)} value={String(option)}>
              {String(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (argType.control === "text") {
    return (
      <Input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return <span className="text-xs italic text-muted-foreground">computed at runtime</span>;
};

export const ControlsPanel = ({
  story,
  args,
  modelSchema,
  onChange,
  onModelEdit,
  onReset,
}: ControlsPanelProps) => {
  const isSchemaMode = modelSchema !== undefined && onModelEdit !== undefined;
  const argTypes = useMemo(() => {
    if (isSchemaMode) return resolveSchemaArgTypes(modelSchema, story?.initialArgs ?? {});
    return story ? resolveArgTypes(story) : [];
  }, [isSchemaMode, modelSchema, story]);

  if (argTypes.length === 0) return null;

  const handleChange = (name: string, nextValue: unknown): void => {
    onChange({ ...args, [name]: nextValue });
    if (isSchemaMode) onModelEdit([name], nextValue);
  };

  return (
    <ScrollArea className="h-full">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Controls
        </span>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      </div>
      <div className="divide-y divide-border">
        {argTypes.map((argType) => {
          const currentValue = args[argType.name] ?? argType.initial;
          return (
            <div
              key={argType.name}
              className="flex flex-col gap-1.5 px-3 py-2 sm:grid sm:grid-cols-[140px_1fr] sm:items-center sm:gap-3"
            >
              <Label
                htmlFor={`arg-${argType.name}`}
                className="truncate text-xs text-muted-foreground"
              >
                {argType.name}
              </Label>
              <div id={`arg-${argType.name}`} className="min-w-0">
                <ControlInput
                  argType={argType}
                  value={currentValue}
                  onChange={(nextValue) => handleChange(argType.name, nextValue)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};
