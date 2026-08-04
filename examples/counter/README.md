# Example — a Foldkit app, showcased

This is the demo Foldcase is tested against, and it is an ordinary Foldkit app: two
components, their `*.showcase.ts` catalogs, and the Markdown that `foldcase docs` writes
from them. Nothing here is a fixture written to flatter the tool — it installs `foldkit`
and `effect` from npm, with its own `package.json`, the way your project does.

| File | What it is |
|---|---|
| [`src/counter.ts`](src/counter.ts) | The counter: Model, Message union, pure `update`, and a `view` |
| [`src/counter.showcase.ts`](src/counter.showcase.ts) | Six Showcases — four Stories driving that `update`, two Scenes clicking the rendered buttons |
| [`src/tasks.ts`](src/tasks.ts) | A richer Model — an array of nested records, an `Option`, a `Duration`, a literal union |
| [`src/tasks.showcase.ts`](src/tasks.showcase.ts) | Four more Showcases, including one asserting on `Option` |
| [`docs/counter.md`](docs/counter.md), [`docs/tasks.md`](docs/tasks.md) | Written by `foldcase docs` — committed so you can read the output without running anything |

## Run it

From the repository root, after `mise run build`:

```bash
mise run dogfood
```

Or drive the built CLI yourself:

```bash
node dist/main.js test examples/counter/src              # 10 total · 10 passed · 0 failed
node dist/main.js test examples/counter/src --coverage   # which lines each Showcase reached
node dist/main.js docs examples/counter/src /tmp/docs    # one Markdown file per component

FOLDCASE_SHOWCASE_DIR=examples/counter/src node dist/main.js mcp   # serve it to an agent
```

## What it demonstrates

- **The Model and the markup, from one catalog.** A `Story` play drives the `update` and
  asserts on the Model it returns; a `Scene` play mounts `{ update, view }`, finds the
  buttons by role and accessible name, clicks them, and reads the count back out of the
  rendered tree. Neither needs a DOM — a Scene renders to Foldkit's virtual tree — so
  `--coverage` reports `counter.ts` at 100% under both bins.
- **Each Showcase says what it sends.** `dispatches` lists the Message tags a play
  dispatches, and Foldcase holds that against the union: a tag no play sends is named under
  the Messages table, and a tag the union does not carry fails `foldcase docs`.
- **The Model tables are read off the Schemas.** `docs/tasks.md` reports `Option<string>`
  as optional, `Duration` as `Duration` rather than the number it serializes to, and
  `Task[]` by the class name — because the generator reads the declared Schema, not the
  source text.
- **Assertions come from `node:assert` and from Foldkit.** A Showcase is loaded by whichever
  bin you run, so `bun:test` in a catalog would tie it to one runtime. `node:assert` and the
  `Scene` matchers both run under either.
- **The catalog is the array.** No `Meta`, no default export, no story parser.

## In your own project

Two differences from what you see here. Install the tool:

```bash
bun add -d foldcase       # or npm install -D foldcase
```

and drop the `paths` entry from [`tsconfig.json`](tsconfig.json) — it exists only because
this example lives inside the repository it demonstrates, so `import type { Showcase }`
resolves to the build next door rather than to an installed package.

That nesting is only safe while the two installs agree. This example pins
`effect@4.0.0-beta.102`, the version Foldkit pins, and the repository develops against the
same one; let them drift and `tsc` inside this directory sees **two** copies of Effect and
reports every Schema as incompatible with itself. Your project has one install and one
copy, so it never happens there. Running the Showcases is unaffected either way, which is
what `mise run dogfood` checks under both runtimes.
