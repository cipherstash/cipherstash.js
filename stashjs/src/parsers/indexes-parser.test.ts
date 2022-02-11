import { isRight } from 'fp-ts/lib/Either'
import { ExactIndex, MatchIndex, parseIndexDefinition, RangeIndex } from './indexes-parser'
import { isOk, Ok } from '../result'
import { parse } from 'path/posix'

describe("Index definition: Exact", () => {
  it("parses valid index definition", () => {
    const def = {
      "kind": "exact",
      "field": "title"
    }

    const parsed = ExactIndex.decode(def)
    expect(isRight(parsed)).toBe(true)
  })

  it("parses invalid index definition", () => {
    const def = {
      "kind": "garbage",
      "field": "title"
    }

    const parsed = ExactIndex.decode(def)
    expect(isRight(parsed)).toBe(false)
  })
})

describe("Index definition: Range", () => {
  it("parses valid index definition", () => {
    const def = {
      "kind": "range",
      "field": "title"
    }

    const parsed = RangeIndex.decode(def)
    expect(isRight(parsed)).toBe(true)
  })

  it("parses invalid index definition", () => {
    const def = {
      "kind": "garbage",
      "field": "title"
    }

    const parsed = RangeIndex.decode(def)
    expect(isRight(parsed)).toBe(false)
  })
})

describe("Index definition: Match", () => {
  it("parses valid index definition", () => {
    const def = {
      "kind": "match",
      "fields": ["title"],
      "tokenFilters": [
        { "kind": "downcase" },
        { "kind": "ngram", "tokenLength": 3 }
      ],
      "tokenizer": { "kind": "standard" }
    }

    const parsed = MatchIndex.decode(def)
    expect(isRight(parsed)).toBe(true)
  })

  it("parses invalid index definition", () => {
    const def = {
      "kind": "match",
      "fields": "title",
      "tokenFilters": [
        { "kind": "downcase" },
        { "kind": "ngram", "tokenLength": 3 }
      ],
      "tokenizer": { "kind": "standard" }
    }

    const parsed = MatchIndex.decode(def)
    expect(isRight(parsed)).toBe(false)
  })
})

describe("Entire indexes definition", () => {
  it("can be parsed", () => {
    const indexes = {
      "exactTitle": { "kind": "exact", "field": "title" },
      "runningTime": { "kind": "range", "field": "runningTime" },
      "year": { "kind": "range", "field": "year" },
      "title": {
        "kind": "match",
        "fields": ["title"],
        "tokenFilters": [
          { "kind": "downcase" },
          { "kind": "ngram", "tokenLength": 3 }
        ],
        "tokenizer": { "kind": "standard" }
      }
    }

    const parsed = parseIndexDefinition(indexes)
    expect(isOk(parsed)).toBe(true)
  })
})