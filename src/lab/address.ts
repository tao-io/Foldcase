/**
 * The lab's URL grammar: `?showcase=<id>`, the id percent-encoded.
 *
 * This is what makes the lab addressable, and addressable is the point. Every
 * affordance a reader has here is one an agent has too, and the id is the
 * handle for both: a reader clicks an entry and copies the address out of the
 * bar; an agent builds the same address from an id `foldcase_list_showcases`
 * already served, opens it in whatever browser it can already drive, and
 * screenshots the drawn state. That is the "an agent can fetch a state's PNG by
 * id" requirement met — with no new tool, no new dependency, and nothing added
 * to the tarball, because the id *is* the address.
 *
 * Both rules below are pure functions over a `Url`, so the grammar is pinned by
 * unit tests and no browser is needed to know what an address means.
 */

import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import type { Url } from "foldkit/url"

/**
 * The query parameter the lab addresses a showcase by.
 *
 * A query parameter, and not a path segment, because the lab does not own the
 * path: it is a library the consumer mounts wherever their own dev server puts
 * it (ADR-0004), so the only part of the address it may claim is one it can add
 * to whatever path it finds itself at.
 */
export const ADDRESS_PARAMETER = "showcase"

/**
 * The id an address names, if it names one.
 *
 * Pure — it reads a `Url`, which is data, and touches no `location`, no
 * `history` and no DOM — so the whole rule is unit-tested with no browser
 * under it.
 */
export const addressedId = (url: Url): Option.Option<string> =>
  pipe(
    url.search,
    Option.flatMap((search) =>
      Option.fromNullishOr(new URLSearchParams(search).get(ADDRESS_PARAMETER)),
    ),
    // `?showcase=` is the parameter written and left blank. No catalog declares
    // the empty id, so reporting it as an id nobody declares would be a notice
    // about a typo; reading it as no address at all opens the default.
    Option.filter((id) => id.length > 0),
  )

/**
 * The address that names an id, written against the address the lab is at.
 *
 * Pure for the same reason and to the same end: a string in, a string out, so
 * the grammar an agent constructs by hand is the grammar the tests pin. The
 * path, the hash and every parameter that is not {@link ADDRESS_PARAMETER}
 * survive untouched, because they are the page's and not the lab's.
 */
export const addressOf = (url: Url, id: string): string => {
  const query = new URLSearchParams(Option.getOrElse(url.search, () => ""))
  query.set(ADDRESS_PARAMETER, id)
  const hash = Option.match(url.hash, { onNone: () => "", onSome: (fragment) => `#${fragment}` })
  return `${url.pathname}?${query.toString()}${hash}`
}
