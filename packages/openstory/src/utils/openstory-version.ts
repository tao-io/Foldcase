import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJsonShape {
  name?: unknown;
  version?: unknown;
}

const FALLBACK_VERSION = "0.0.0";
const OPENSTORY_PACKAGE_NAME = "foldcase";

const findOpenstoryPackageJson = (startDirectory: string): string | undefined => {
  let currentDirectory = startDirectory;
  for (;;) {
    const candidate = resolve(currentDirectory, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed: PackageJsonShape = JSON.parse(readFileSync(candidate, "utf8"));
        if (parsed.name === OPENSTORY_PACKAGE_NAME) return candidate;
      } catch {}
    }
    const parent = dirname(currentDirectory);
    if (parent === currentDirectory) return undefined;
    currentDirectory = parent;
  }
};

const readVersionFromPackageJson = (): string => {
  const startDirectory = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = findOpenstoryPackageJson(startDirectory);
  if (!packageJsonPath) return FALLBACK_VERSION;
  try {
    const parsed: PackageJsonShape = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
};

export const OPENSTORY_VERSION: string = readVersionFromPackageJson();
