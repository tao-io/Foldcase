---
"foldcase": minor
---

Foldkit adapter: preserve the accumulated TEA Model across arg changes and add
schema-driven controls with live Model editing.

- Fix the remount-discards-Model bug: `update()` now re-starts the Foldkit runtime
  seeded with the encoded live Model (`makeApplication().start(hmrModel)`) instead of
  cold-remounting, so arg/view changes keep accumulated state.
- Derive controls from the Model's Effect Schema (`Schema.toJsonSchemaDocument`) and
  post a new `model-schema` message; the shell renders typed controls from it.
- A control edit posts a new `set-model {path,value}` message that edits the live Model
  at that path and re-renders in place, with no host dispatch handle.
