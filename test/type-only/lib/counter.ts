// The module the showcase reaches. It imports a type as a value — the same
// shape as `import { Document, Html } from 'foldkit/html'`, which is what
// `create-foldkit-app` scaffolds. Bun erases it; Node emits a real ESM import
// and throws, because type stripping already removed the export.
// @ts-expect-error -- `Count` is a type, and importing it as a value is the point.
// oxlint-disable-next-line typescript/consistent-type-imports -- so is the lint this trips.
import { Count, zero } from "./model.ts"

export const start = (): Count => zero

export const increment = (count: Count): Count => count + 1
