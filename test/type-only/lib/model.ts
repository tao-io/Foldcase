// A module whose `Count` is a *type*. Node strips types, so the module Node
// evaluates exports `zero` and nothing else — which is what makes the sibling
// module's value import of `Count` ask for an export that is not there.
export type Count = number

export const zero: Count = 0
