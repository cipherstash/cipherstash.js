import { CollectionSchema } from "./collection-schema"
import { all } from "./dsl/query-dsl"
import { QueryBuilderError } from "./errors"

type PatientRecord = {
  id: string
  name: string
  phone: string
  altPhone: string
  dob: Date
  email: string
  secondaryEmail: string
  expired: boolean
  age: number
  notes: string
  description: string
  address: {
    streetNumber: string
    street: string
    city: string
    country: string
    postcode: string
  }
}

let schema = CollectionSchema.define<PatientRecord>("patients").fromCollectionSchemaDefinition({
  type: {
    id: "string",
    name: "string",
    phone: "string",
    altPhone: "string",
    dob: "date",
    email: "string",
    secondaryEmail: "string",
    expired: "boolean",
    age: "float64",
    notes: "string",
    description: "string",
    address: {
      streetNumber: "string",
      street: "string",
      city: "string",
      country: "string",
      postcode: "string",
    },
  },
  indexes: {
    email: { kind: "exact", fieldType: "string", field: "email" },
    age: { kind: "exact", fieldType: "uint64", field: "age" },
    ageRange: { kind: "range", fieldType: "uint64", field: "age" },
    dob: { kind: "exact", fieldType: "date", field: "dob" },
    dobRange: { kind: "range", fieldType: "date", field: "dob" },
    expired: { kind: "exact", fieldType: "boolean", field: "expired" },
    city: { kind: "exact", fieldType: "string", field: "address.city" },
    notesAndDescription: {
      kind: "match",
      fieldType: "string",
      fields: ["notes", "description"],
      tokenFilters: [{ kind: "downcase" }, { kind: "ngram", tokenLength: 3 }],
      tokenizer: { kind: "standard" },
    },
    allStringFields1: {
      kind: "dynamic-match",
      fieldType: "string",
      tokenFilters: [{ kind: "downcase" }, { kind: "ngram", tokenLength: 3 }],
      tokenizer: { kind: "standard" },
    },
    allStringFields2: {
      kind: "field-dynamic-match",
      fieldType: "string",
      tokenFilters: [{ kind: "downcase" }, { kind: "ngram", tokenLength: 3 }],
      tokenizer: { kind: "standard" },
    },
  },
})

describe("CollectionSchema", () => {
  describe("define", () => {
    test("produces a schema with a name", () => {
      expect(schema.name).toBe("patients")
    })

    test("produces a schema with mappings", () => {
      expect(schema.mappings).toStrictEqual({
        email: { kind: "exact", field: "email", fieldType: "string" },
        expired: { kind: "exact", field: "expired", fieldType: "boolean" },
        age: { kind: "exact", field: "age", fieldType: "uint64" },
        dob: { kind: "exact", field: "dob", fieldType: "date" },
        dobRange: { kind: "range", field: "dob", fieldType: "date" },
        city: { kind: "exact", field: "address.city", fieldType: "string" },
        ageRange: { kind: "range", field: "age", fieldType: "uint64" },
        notesAndDescription: {
          kind: "match",
          fieldType: "string",
          fields: ["notes", "description"],
          tokenFilters: [{ kind: "downcase" }, { kind: "ngram", tokenLength: 3 }],
          tokenizer: { kind: "standard" },
        },
        allStringFields1: {
          kind: "dynamic-match",
          fieldType: "string",
          tokenFilters: [
            {
              kind: "downcase",
            },
            {
              kind: "ngram",
              tokenLength: 3,
            },
          ],
          tokenizer: {
            kind: "standard",
          },
        },
        allStringFields2: {
          kind: "field-dynamic-match",
          fieldType: "string",
          tokenFilters: [
            {
              kind: "downcase",
            },
            {
              kind: "ngram",
              tokenLength: 3,
            },
          ],
          tokenizer: {
            kind: "standard",
          },
        },
      })
    })
  })

  describe("buildQuery", () => {
    describe("single condition queries", () => {
      test("exact mapping on string field", () => {
        let query = schema.buildQuery($ => $.email.eq("person@email.example"))
        expect(query).toStrictEqual({ kind: "exact", indexName: "email", op: "eq", value: "person@email.example" })
      })

      test("exact mapping on boolean field", () => {
        let query = schema.buildQuery($ => $.expired.eq(true))
        expect(query).toStrictEqual({ kind: "exact", indexName: "expired", op: "eq", value: true })
      })

      test("exact mapping on number field", () => {
        let query = schema.buildQuery($ => $.age.eq(43))
        expect(query).toStrictEqual({ kind: "exact", indexName: "age", op: "eq", value: 43 })
      })

      test("exact mapping on date field", () => {
        let date: Date = new Date(Date.UTC(2021, 6, 1))
        let query = schema.buildQuery($ => $.dob.eq(date))
        expect(query).toStrictEqual({ kind: "exact", indexName: "dob", op: "eq", value: date })
      })

      test("range mapping on date field", () => {
        let date1: Date = new Date(Date.UTC(2021, 6, 1))
        let date2: Date = new Date(Date.UTC(2022, 6, 1))
        let query = schema.buildQuery($ => $.dobRange.between(date1, date2))
        expect(query).toStrictEqual({ kind: "range", indexName: "dobRange", op: "between", min: date1, max: date2 })
      })

      test("range mapping on number field", () => {
        let number1 = 10
        let number2 = 100
        let query = schema.buildQuery($ => $.ageRange.between(number1, number2))
        expect(query).toStrictEqual({ kind: "range", indexName: "ageRange", op: "between", min: number1, max: number2 })
      })

      test("match mapping on string field", () => {
        let query = schema.buildQuery($ => $.notesAndDescription.match("diabetes"))
        expect(query).toStrictEqual({ kind: "match", op: "match", indexName: "notesAndDescription", value: "diabetes" })
      })

      test("dynamic match mapping without search by field", () => {
        let query = schema.buildQuery($ => $.allStringFields1.match("London"))
        expect(query).toStrictEqual({
          kind: "dynamic-match",
          op: "match",
          indexName: "allStringFields1",
          value: "London",
        })
      })

      test("dynamic match mapping with search by field", () => {
        let query = schema.buildQuery($ => $.allStringFields2.match("address.city", "London"))
        expect(query).toStrictEqual({
          kind: "field-dynamic-match",
          op: "match",
          indexName: "allStringFields2",
          fieldName: "address.city",
          value: "London",
        })
      })

      test("throw when accessing invalid index field", () => {
        expect(() => schema.buildQuery(($: any) => $.invalidIndex.eq("test"))).toThrowError(
          new QueryBuilderError('No index named "invalidIndex" on collection "patients"')
        )
      })

      test("throw when using an operator that doesn't exist", () => {
        expect(() => schema.buildQuery($ => ($.city as any).boom("wow"))).toThrowError(
          new QueryBuilderError('Cannot use operator "boom" on index "city" on collection "patients"')
        )
      })

      test("throw when using an incorrect operator on a field", () => {
        expect(() => schema.buildQuery($ => ($.city as any).match("London"))).toThrowError(
          new QueryBuilderError('Cannot use operator "match" on index "city" on collection "patients"')
        )
      })

      test("throw when returning an incorrect query", () => {
        expect(() => schema.buildQuery(($: any) => $)).toThrowError(
          new QueryBuilderError("Query builder returned invalid query")
        )
      })
    })

    describe("conjunctive queries", () => {
      test("all (logical and)", () => {
        let query = schema.buildQuery($ => all($.expired.eq(true), $.notesAndDescription.match("diabetes")))
        expect(query).toStrictEqual({
          kind: "all",
          conditions: [
            { indexName: "expired", kind: "exact", op: "eq", value: true },
            { indexName: "notesAndDescription", kind: "match", op: "match", value: "diabetes" },
          ],
        })
      })
    })
  })
})
