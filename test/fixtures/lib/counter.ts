// A tiny module a Showcase's play exercises across a file boundary — the stand-in
// for a component's `update`. `increment` gets called; `decrement` does not, so
// coverage over it is genuinely partial.

export const increment = (n: number): number => n + 1

export const decrement = (n: number): number => n - 1
