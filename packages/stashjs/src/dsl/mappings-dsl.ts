import { TokenFilter, Tokenizer } from "./filters-and-tokenizers-dsl"
import { FieldOfType, FieldType, unreachable } from "../type-utils"
import { RecordTypeDefinition, TermType } from "../record-type-definition"

/**
 * A new record is permitted to not already have an assigned ID (the client will
 * create an ID when one is not already set).
 */
export type StashRecord = { id?: string }

export type HasID = { id: string }

/**
 * Fields of this type can be indexed and queried.
 */
export type MappableFieldType = ExactMappingFieldType | RangeMappingFieldType | MatchMappingFieldType

/**
 * The types that exact mappings can be defined on.
 */
export type ExactMappingFieldType = string | number | bigint | Date | boolean

/**
 * The types that range mappings  can be defined on.
 */
export type RangeMappingFieldType = string | number | bigint | Date | boolean

/**
 * The types that match mappings can be defined on.
 */
export type MatchMappingFieldType = string

/**
 * An exact mapping on a field on a record.
 */
export type ExactMapping<R extends StashRecord, F extends FieldOfType<R, ExactMappingFieldType>> = {
  kind: "exact"
  field: F
  fieldType: TermType
}

/**
 * A range mapping on a field on a record.
 */
export type RangeMapping<R extends StashRecord, F extends FieldOfType<R, RangeMappingFieldType>> = {
  kind: "range"
  field: F
  fieldType: TermType
}

/**
 * A match mapping on a field on a record.
 */
export type MatchMapping<R extends StashRecord, F extends FieldOfType<R, MatchMappingFieldType>> = {
  kind: "match"
  fields: Array<F>
  fieldType: "string"
} & MatchOptions

/**
 * A dynamic version of match mapping. This mapping matches all string fields in
 * a document, regardless of depth. All of the terms will be run through the
 * same text preprocessing pipeline and all terms will be stored in the same
 * index.
 *
 * Every term is first siphashed and then ORE encrypted.
 */
export type DynamicMatchMapping = {
  kind: "dynamic-match"
  fieldType: "string"
} & MatchOptions

/**
 * A dynamic version of match mapping. This mapping matches all string fields in
 * a document, regardless of depth. All of the terms will be run through the
 * same text preprocessing pipeline and all terms will be stored in the same
 * index.
 *
 * Every term is first siphashed and then ORE encrypted.
 */
export type FieldDynamicMatchMapping = {
  kind: "field-dynamic-match"
  fieldType: "string"
} & MatchOptions

/**
 * Guard function to check for exact mappings
 */
export function isExactMapping<R extends StashRecord, F extends FieldOfType<R, ExactMappingFieldType>>(
  mapping: any
): mapping is ExactMapping<R, F> {
  return mapping.kind == "exact"
}

/**
 * Guard function to check for range mappings
 */
export function isRangeMapping<R extends StashRecord, F extends FieldOfType<R, RangeMappingFieldType>>(
  mapping: any
): mapping is RangeMapping<R, F> {
  return mapping.kind == "range"
}

/**
 * Guard function to check for match mappings
 */
export function isMatchMapping<R extends StashRecord, F extends FieldOfType<R, string>>(
  mapping: any
): mapping is MatchMapping<R, F> {
  return mapping.kind == "match"
}

/**
 * Guard function to check for dynamic match mappings
 */
export function isDynamicMatchMapping(mapping: any): mapping is DynamicMatchMapping {
  return mapping.kind == "dynamic-match"
}

/**
 * Guard function to check for dynamic match mappings
 */
export function isFieldDynamicMatchMapping(mapping: any): mapping is FieldDynamicMatchMapping {
  return mapping.kind == "field-dynamic-match"
}

/**
 * This type represents all of the kinds of permitted mapping types allowed on a record.
 */
export type MappingOn<R extends StashRecord> =
  | ExactMapping<R, FieldOfType<R, ExactMappingFieldType>>
  | RangeMapping<R, FieldOfType<R, RangeMappingFieldType>>
  | MatchMapping<R, FieldOfType<R, MatchMappingFieldType>>
  | DynamicMatchMapping
  | FieldDynamicMatchMapping

/**
 * This type represents an object whose keys are the name of the index being
 * defined and whose values are the mappings. Values of this type will be
 * serialized and stored with the a Collection in the data-service.
 */
export type Mappings<R extends StashRecord> = {
  [key: string]: MappingOn<R>
}

/**
 * This is a utility type that when provided with a StashRecord type and a
 * MappingOn on that StashRecord type it will return the type of the underlying
 * field on the StashRecord type (e.g. string or boolean etc)
 */
export type FieldTypeOfMapping<R extends StashRecord, M extends MappingOn<R>> = M extends ExactMapping<R, infer FOT>
  ? FieldType<R, FOT>
  : M extends RangeMapping<R, infer FOT>
  ? FieldType<R, FOT>
  : M extends MatchMapping<R, infer FOT>
  ? FieldType<R, FOT> // Should be MatchMappingFieldType
  : M extends DynamicMatchMapping
  ? MatchMappingFieldType
  : M extends FieldDynamicMatchMapping
  ? MatchMappingFieldType
  : never

/**
 * This type represents some auto-generated meta information about a
 * Mappings<R>. It associates a plain text $indexName and $indexId (UUID)
 * and also stores the encryption key for the index.
 */
export type MappingsMeta<M> = M extends Mappings<infer _R>
  ? {
      [F in keyof M]-?: {
        $indexName: string
        $indexId: string
        $prfKey: Buffer
        $prpKey: Buffer
      }
    }
  : never

// TODO: support options for string (token filters etc)
// TODO: support options for date (resolution etc)
// TODO: support options for bigint (clamp or throw for out-of-range)
export type ExactFn<R extends StashRecord> = <F extends FieldOfType<R, ExactMappingFieldType>>(
  field: F,
  fieldType: TermType
) => ExactMapping<R, F>

// TODO: support options for string (token filters etc)
// TODO: support options for bigint (clamp or throw for out-of-range)
// TODO: support options for date (resolution etc)
export function makeExactFn<R extends StashRecord>(): ExactFn<R> {
  return (field, fieldType) => ({ kind: "exact", field, fieldType })
}

// TODO: support options for date (resolution etc)
// TODO: support options for bigint (clamp or throw for out-of-range)
export type RangeFn<R extends StashRecord> = <F extends FieldOfType<R, RangeMappingFieldType>>(
  field: F,
  fieldType: TermType
) => RangeMapping<R, F>

export function makeRangeFn<R extends StashRecord>(): RangeFn<R> {
  return (field, fieldType) => ({ kind: "range", field, fieldType })
}

export type MatchOptions = {
  tokenFilters: Array<TokenFilter | Tokenizer>
  tokenizer: Tokenizer
}

export type MatchFn<R extends StashRecord> = <F extends FieldOfType<R, MatchMappingFieldType>>(
  field: Array<F>,
  options: MatchOptions
) => MatchMapping<R, F>

export function makeMatchFn<R extends StashRecord>(): MatchFn<R> {
  return (fields, options) => ({ kind: "match", fields, fieldType: "string", ...options })
}

export type DynamicMatchFn = (options: MatchOptions) => DynamicMatchMapping

export function makeDynamicMatchFn(): DynamicMatchFn {
  return options => ({ kind: "dynamic-match", fieldType: "string", ...options })
}

export type FieldDynamicMatchFn = (options: MatchOptions) => FieldDynamicMatchMapping

export function makeFieldDynamicMatchFn(): FieldDynamicMatchFn {
  return options => ({ kind: "field-dynamic-match", fieldType: "string", ...options })
}

export type IndexFn<R extends StashRecord> = ExactFn<R> | RangeFn<R> | MatchFn<R> | DynamicMatchFn | FieldDynamicMatchFn

export type MappingsDSL<R extends StashRecord> = {
  Exact: ExactFn<R>
  Range: RangeFn<R>
  Match: MatchFn<R>
  DynamicMatch: DynamicMatchFn
  FieldDynamicMatch: FieldDynamicMatchFn
}

export function makeMappingsDSL<R extends StashRecord>(): MappingsDSL<R> {
  return {
    Exact: makeExactFn<R>(),
    Range: makeRangeFn<R>(),
    Match: makeMatchFn<R>(),
    DynamicMatch: makeDynamicMatchFn(),
    FieldDynamicMatch: makeFieldDynamicMatchFn(),
  }
}

function extractTypeName(field: string, record: any): TermType {
  const path = field.split(".")
  let current = record
  path.forEach(part => {
    current = current?.[part]
  })
  return current as TermType
}

export function fieldTypeOfMapping(mapping: any, recordType: RecordTypeDefinition): TermType {
  if (isExactMapping(mapping) || isRangeMapping(mapping)) {
    return extractTypeName(mapping.field, recordType)
  } else if (isMatchMapping(mapping) || isDynamicMatchMapping(mapping) || isFieldDynamicMatchMapping(mapping)) {
    return "string"
  } else {
    throw unreachable(`Unknown index kind: '${mapping.kind}'`)
  }
}
