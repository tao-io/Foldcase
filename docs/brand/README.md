# The mark

Six files, one drawing.

| File | Use it on |
|---|---|
| [`mark.svg`](mark.svg) | light backgrounds |
| [`mark-inverse.svg`](mark-inverse.svg) | dark backgrounds |
| [`lockup.svg`](lockup.svg) | light backgrounds, where the name is needed |
| [`lockup-inverse.svg`](lockup-inverse.svg) | dark backgrounds, where the name is needed |
| [`favicon.svg`](favicon.svg) | anywhere below 32 pixels — see below |
| [`avatar.svg`](avatar.svg) | a square that is cropped by someone else — see below |

## What it draws

A hexagon divides into exactly three rhombi meeting at its centre, so the triad inside the
case is not decoration added to a frame — it is the hexagon divided. The three are equal,
because Story, Scene and Showcase are peers, and none of them is the biggest.

Three numbers set the whole drawing, on a 256 grid: the **ring** is 24, the **gap** between
the ring and the triad is 14, and the **seam** parting the rhombi is 10. Line, then space,
then seam, each step smaller than the last — a hierarchy rather than an average, which is
what keeps the three reading as one shape divided rather than as three objects placed.

The lineage is deliberate: the isometric planes come from [Effect](https://effect.website),
which this tool is written in, and the blunt orthogonal weight from
[Foldkit](https://github.com/foldkit/foldkit), which it serves.

## Rules

- **One ink.** `#0B0C0E` on light, `#FAFAFA` on dark. No gradient, no shadow, no second
  colour. The reversed files are the same geometry with the fill swapped.
- **The word is outlines**, set in Outfit Bold and converted to paths, so no file here
  depends on a font being installed.
- **Clear space** is 16 units on the 256 grid — the width of the seam plus a little — on
  every side of the mark, and one stem width between the mark and the word.
- **Do not redraw it by hand.** Change the three numbers and regenerate; the geometry is
  arithmetic, and hand-nudged coordinates will not sit on the grid.

## Where a square is demanded

GitHub, npm and the rest crop an avatar to a square or a circle and will not take an SVG,
so `avatar.svg` is the mark on a filled `#0B0C0E` tile, inset to 78% so the crop never
bites the ring. It is the only file here that carries a background, and it carries one
because the caller supplies none.

`avatar.png` beside it is the render those sites accept. Regenerate it rather than editing
it:

```sh
rsvg-convert -w 512 -h 512 docs/brand/avatar.svg -o docs/brand/avatar.png
```

## Below 32 pixels

The triad fills in: the ring and the seams stop being told apart, and the mark reads as a
dark blob. So `favicon.svg` is the inverse cut — a solid hexagon with the three rhombi
knocked out of it — where the ink is the frame and the seams do the drawing. Same three
numbers, inverted, so it stays on the grid.

It is also the one file that carries **both** inks, in a `prefers-color-scheme` rule rather
than a second file. Everywhere else the caller knows its own background and picks the
right file; a favicon does not get that choice, because the browser decides what to draw
it on. One ink at a time is still the rule — this file just cannot know which one until it
is rendered.
