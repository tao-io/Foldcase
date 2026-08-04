// A catalog whose `dispatches` is not a list of Message tags. The field is
// read as one by every surface that reports a coverage gap, so a module
// declaring something else is malformed — rejected at the loader, like a
// `message` that is not an Effect Schema, rather than defecting later.
export const showcases = [
  { id: "malformed/bad-dispatches", play: () => {}, dispatches: "Increment" },
]
