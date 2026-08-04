# The mark

Four files, one drawing.

| File | Use it on |
|---|---|
| [`mark.svg`](mark.svg) | light backgrounds |
| [`mark-inverse.svg`](mark-inverse.svg) | dark backgrounds |
| [`lockup.svg`](lockup.svg) | light backgrounds, where the name is needed |
| [`lockup-inverse.svg`](lockup-inverse.svg) | dark backgrounds, where the name is needed |

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

## Below 32 pixels

The triad fills in: the ring and the seams stop being told apart, and the mark reads as a
dark blob. A favicon wants the inverse cut — a solid hexagon with the three rhombi knocked
out of it — where the ink is the frame and the seams do the drawing. That file is not here
yet; it is the same three numbers, inverted.
