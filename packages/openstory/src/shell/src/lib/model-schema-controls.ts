export type SchemaControlKind = "boolean" | "number" | "text" | "select" | "unsupported";

export interface SchemaControl {
  name: string;
  control: SchemaControlKind;
  options?: ReadonlyArray<string>;
}

export interface JsonSchemaNode {
  type?: string | ReadonlyArray<string>;
  properties?: Record<string, JsonSchemaNode>;
  required?: ReadonlyArray<string>;
  enum?: ReadonlyArray<unknown>;
  const?: unknown;
  anyOf?: ReadonlyArray<JsonSchemaNode>;
  oneOf?: ReadonlyArray<JsonSchemaNode>;
}

const toStringOptions = (values: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  values.map((value) => String(value));

const resolveUnion = (branches: ReadonlyArray<JsonSchemaNode>): Omit<SchemaControl, "name"> => {
  const primitiveBranch = branches.find(
    (branch) => branch.type === "number" || branch.type === "integer" || branch.type === "boolean",
  );
  if (primitiveBranch) return resolveControl(primitiveBranch);

  const literalOptions = branches
    .filter((branch) => branch.const !== undefined)
    .map((branch) => String(branch.const));
  if (literalOptions.length > 0) return { control: "select", options: literalOptions };

  return { control: "unsupported" };
};

const resolveControl = (node: JsonSchemaNode): Omit<SchemaControl, "name"> => {
  if (node.type === "boolean") return { control: "boolean" };
  if (node.type === "number" || node.type === "integer") return { control: "number" };
  if (node.enum) return { control: "select", options: toStringOptions(node.enum) };
  if (node.type === "string") return { control: "text" };
  const branches = node.anyOf ?? node.oneOf;
  if (branches) return resolveUnion(branches);
  return { control: "unsupported" };
};

export const modelSchemaToControls = (modelSchema: JsonSchemaNode): SchemaControl[] => {
  const properties = modelSchema.properties;
  if (!properties) return [];
  return Object.entries(properties).map(([name, node]) => ({
    name,
    ...resolveControl(node),
  }));
};
