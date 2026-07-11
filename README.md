# Foldcase

**Foldcase** — a Foldkit-native component explorer. The component performing outside the app.

Foldcase is [`tao-io`](https://github.com/tao-io)'s fork of
[millionco/openstory](https://github.com/millionco/openstory) (MIT), maintained to make it a
first-class **[Foldkit](https://github.com/binarytide/foldkit)** component lab: it renders
Foldkit programs as **Showcases** with a live TEA `Model` inspector + message log +
time-travel, and an MCP relay so an agent can drive a Showcase directly.

> **The name.** Foldcase = **fold** (Foldkit) + (show)**case**. It extends Foldkit's testing
> family **Story · Scene** with the isolation layer **Showcase** (Story · Showcase · Scene).

> Foldcase is in alpha (`0.1.x`). Any patch may break the public API. The installable
> package name and import path stay lowercase (`foldcase`, `foldcase/foldkit`) — npm forbids
> capitals; the tool's name is **Foldcase**.

## Install

```bash
pnpm add -D foldcase vite foldkit @foldkit/devtools @foldkit/vite-plugin
```

Then start the dev server:

```bash
pnpm exec foldcase dev --framework foldkit
```

No `vite.config.ts` is required for basic use — Foldcase configures Vite in-memory and picks
up `tsconfig.json` path aliases automatically. To wire the Foldkit **DevTools → MCP relay**,
drop a `vite.config.ts`; Foldcase's dev server auto-loads it and concatenates its plugins:

```ts
import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [foldkit({ devToolsMcpPort: 9989 })],
});
```

## Write a Showcase

A Foldkit Showcase is a CSF 3 story whose `render` returns a Foldkit program config
(`{ Model, init, update, view, devTools }`). Set `devTools` to mount the overlay in the
Showcase canvas — `show: 'Always'` is required because Foldcase renders every Showcase inside
an iframe, where the default `'Development'` gate is false:

```ts
import { overlay } from "@foldkit/devtools";
import type { Meta, StoryObj } from "foldcase/foldkit";

const program = {
  Model,
  init,
  update,
  view,
  devTools: { overlay, Message, show: "Always" as const },
};

const meta: Meta = { title: "Grid/Button", render: () => program };
export default meta;

export const Variants: StoryObj = { /* play: async ({ canvasElement }) => { … } */ };
```

## CLI

```
foldcase dev        start the dev server (--framework foldkit)
foldcase build      write a static deployable site to dist/
foldcase preview    serve the built site
foldcase generate   generate CSF 3 stories for components
foldcase list       print manifest (--json for raw)
foldcase inspect    print details for one Showcase (--json for raw)
```

## Heritage & other frameworks

Foldcase inherits Openstory's framework-agnostic core — React / Solid / Vue / Svelte renderers
still ship (`foldcase/react`, `foldcase/solid`, …) and standard CSF 3 stories work as-is. See
[Openstory](https://github.com/millionco/openstory) for the multi-framework story shape;
Foldcase's focus is the Foldkit adapter and its dev instruments.

## License & attribution

Foldcase is MIT-licensed open-source software. It is a fork of Openstory (Copyright © millionco)
and incorporates the Foldkit adapter contributed by binarytide in
[millionco/openstory#4](https://github.com/millionco/openstory/pull/4). See `LICENSE` and
`NOTICE` for the full attribution, which must be retained.
