import { describe, expect, test } from "bun:test"
import * as Option from "effect/Option"
import { fromString } from "foldkit/url"

import { addressedId, addressOf } from "./address.js"

/** The `Url` a browser at this address hands `init` and `onUrlChange`. */
const urlOf = (address: string) => Option.getOrThrow(fromString(address))

describe("addressedId", () => {
  test("reads the id out of the query parameter, percent-decoded", () => {
    expect(addressedId(urlOf("http://localhost:5198/?showcase=counter%2Fstep-of-ten"))).toEqual(
      Option.some("counter/step-of-ten"),
    )
  })

  test("reads an id a human typed with the slash left plain, because a slash is legal there", () => {
    expect(addressedId(urlOf("http://localhost:5198/?showcase=counter/step-of-ten"))).toEqual(
      Option.some("counter/step-of-ten"),
    )
  })

  test("names nothing when the address carries no query at all", () => {
    expect(addressedId(urlOf("http://localhost:5198/"))).toEqual(Option.none())
  })

  test("names nothing when the query is about something else, so a consumer's parameters are not ids", () => {
    expect(addressedId(urlOf("http://localhost:5198/?theme=dark"))).toEqual(Option.none())
  })

  test("names nothing when the parameter is there and empty, rather than an id no catalog declares", () => {
    expect(addressedId(urlOf("http://localhost:5198/?showcase="))).toEqual(Option.none())
  })
})

describe("addressOf", () => {
  test("percent-encodes the slash, so the id survives the query parameter whole", () => {
    expect(addressOf(urlOf("http://localhost:5198/"), "counter/step-of-ten")).toBe(
      "/?showcase=counter%2Fstep-of-ten",
    )
  })

  test("keeps the path the consumer's dev server serves the lab at", () => {
    expect(addressOf(urlOf("http://localhost:5198/lab/"), "counter/starts-at-zero")).toBe(
      "/lab/?showcase=counter%2Fstarts-at-zero",
    )
  })

  test("replaces only its own parameter, so a consumer's query survives the move", () => {
    expect(addressOf(urlOf("http://localhost:5198/?theme=dark&showcase=a%2Fone"), "b/two")).toBe(
      "/?theme=dark&showcase=b%2Ftwo",
    )
  })

  test("keeps the hash, which belongs to the page and not to the lab", () => {
    expect(addressOf(urlOf("http://localhost:5198/#panel"), "a/one")).toBe(
      "/?showcase=a%2Fone#panel",
    )
  })

  test("round-trips: the address it builds is one it reads the same id back out of", () => {
    const address = addressOf(urlOf("http://localhost:5198/"), "counter/reset-keeps-the-step")

    expect(addressedId(urlOf(`http://localhost:5198${address}`))).toEqual(
      Option.some("counter/reset-keeps-the-step"),
    )
  })
})
