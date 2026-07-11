---
"foldcase": minor
---

Actions panel: the dispatched-message log

Every message a Foldkit Showcase dispatches now streams to the shell. The Foldkit
renderer's `toParentMessage` tap (already seeing each dispatched Message) shapes it
into a new append-only `StoryToShell` `message` variant (tag + payload + ts) and posts
it to the parent — a nearly-free win over the existing TEA message bus.

The shell collects the stream per Showcase (bounded, resets on story change) and renders
it in a new Actions panel in the bottom panel region, alongside Controls and a11y, plus
a Canvas badge showing the message count. Because it reads the typed `_tag`/fields of the
message union, entries carry the exact tag and a JSON payload — no untyped-callback
guessing.

Tests: a unit spec for the pure message shaper (`describeDispatchedMessage`) and a
Chromium integration test driving a counter fixture's `play`, asserting the ordered
`message` stream (mixed tags + payload) reaches the shell.
