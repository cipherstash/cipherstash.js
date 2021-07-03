import { FieldOfType } from "../type-utils"
import { Mappings, StashRecord, FieldTypeOfMapping, ExactMapping, MatchMapping, RangeMapping, MappableFieldType, RangeType } from "./mappings-dsl"

/*
  A note on types
  ^^^^^^^^^^^^^^^

  When you see a type defined something like this:

  type Foo<
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string>
  > = ...

  The generic arguments are defined like a chain of dependencies - which is
  really important for type-correctness & inference of the Typescript compiler
  and language server.

  `R extends StashRecord` means some type `R` that conforms to `StashRecord`.

  `M extends Mappings<R>` means some type `M` that conforms to `Mappings<R>`,
  specifically the `R` that was passed as the first parameter.

  `N extends Extract<keyof M, string>` means `N` is a string key of `M` (which
  was provided as the second generic argument).

  # A note on `Extract`

  `Extract` is a utility type built in to Typescript. It takes two arguments,
  the first argument is a union type and the second argument is another type
  that you want to filter by. In the code above, it says "give me all the string
  keys from M". The reason is that in JS, keys can also be numbers or symbols as
  well as strings and we definitely only want the string keys.
*/

/**
 * A Query is defined in terms of Mappings over a particular StashRecord.
 * 
 * Note that Condition is a recursive type via.
 */
export type Query<
  R extends StashRecord,
  M extends Mappings<R>
> =
  Condition<R, M>

/**
 * A condition is a single boolean expression within a Query.
 * 
 * A Condition can be an IndexCondition (an assertion about values in an index)
 * or a ConjuctiveCondition (to combine multiple conditions into a more complex
 * condition).
 */
export type Condition<
  R extends StashRecord,
  M extends Mappings<R>
> =
  | IndexValueCondition<R, M>
  | ConjunctiveCondition<R, M>

/**
 * Currently only supports logical AND but will logical OR is coming soon.
 */
export type ConjunctiveCondition<
  R extends StashRecord,
  M extends Mappings<R>
> =
  AllCondition<R, M>

/**
 * A Condition representing a logical AND between two other Conditions.
 */
export type AllCondition<
  R extends StashRecord,
  M extends Mappings<R>
> =
  { kind: "all", conditions: Array<Condition<R, M>> }

/**
 * Represents a condition defined in terms of an index.
 * 
 * An IndexCondition can be one of ExactCondition, RangeCondition or MatchCondition.
 */
export type IndexValueCondition<
  R extends StashRecord,
  M extends Mappings<R>
> = {
  [N in Extract<keyof M, string>]:
    M[N] extends ExactMapping<R, infer _FOT> ? ExactCondition<R, M, N>
    : M[N] extends RangeMapping<R, infer _FOT> ? RangeCondition<R, M, N>
    : M[N] extends MatchMapping<R, infer _FOT> ? MatchCondition<R, M, N>
    : never
  }[Extract<keyof M, string>]

/**
 * A Condition that compares for equality a supplied value and the value from
 * the named index.
 */
export type ExactCondition<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>
> = { kind: "exact", indexName: N, op: "eq", value: FieldTypeOfMapping<R, M[N]> }


/**
 * A Condition that performs a comparison operation between a supplied value
 * and the value from the named index.
 */
export type RangeCondition<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>,
  T extends FieldTypeOfMapping<R, M[N]> = FieldTypeOfMapping<R, M[N]>
> =
  | { kind: "range", indexName: N, op: "lt" | "lte" | "eq" | "gt" | "gte", value: T }
  | { kind: "range", indexName: N, op: "between", min: T, max: T }

/**
 * A Condition that performs a textual match of a supplied string term with the
 * index.
 */
export type MatchCondition<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>
> = { kind: "match", indexName: N, op: "match", value: string }

/**
 * The operations that can be performed on a Match index.
 */
export type MatchOperators<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>,
> = {
  match(value: string): MatchCondition<R, M, N>
}

/**
 * The operations that can be performed on an Exact index.
 */
export type ExactOperators<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>
> = {
  eq(value: FieldTypeOfMapping<R, M[N]>): ExactCondition<R, M, N>
}

/**
 * The operations that can be performed on a Range index.
 */
export type RangeOperators<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>,
  T extends FieldTypeOfMapping<R, M[N]> = FieldTypeOfMapping<R, M[N]>
> = {
  lt(value: T): RangeCondition<R, M, N>
  lte(value: T): RangeCondition<R, M, N>
  eq(value: T): RangeCondition<R, M, N>
  gt(value: T): RangeCondition<R, M, N>
  gte(value: T): RangeCondition<R, M, N>
  between(min: T, max: T): RangeCondition<R, M, N>
}


/**
 * The names of all of the range operators.
 */
export type RangeOperator =
  | "lt"
  | "lte"
  | "eq"
  | "gt"
  | "gte"
  | "between"

/**
 * Utility type that when given a record, mappings and the name of an index,
 * returns a type that represents the operations supported by that index.
 */
export type OperatorsForIndex<
  R extends StashRecord,
  M extends Mappings<R>,
  N extends Extract<keyof M, string>,
> =
  M[N] extends ExactMapping<R, FieldOfType<R, MappableFieldType>> ? ExactOperators<R, M, N>
  : M[N] extends RangeMapping<R, FieldOfType<R, RangeType>> ? RangeOperators<R, M, N>
  : M[N] extends MatchMapping<R, FieldOfType<R, string>> ? MatchOperators<R, M, N>
  : never

/**
 * This type represents the sole argument provided to the callback when building
 * a Query with CollectionProxy.all($ => ...).
 * 
 * It represents a type where every string key is the name of an index and the
 * values are objects whose keys are the available operations that can be
 * performed on that index.
 */
export type QueryBuilder<
  R extends StashRecord,
  M extends Mappings<R>
> = {
  [F in Extract<keyof M, string>]: OperatorsForIndex<R, M, F>
}

/**
 * Type guard to check if a Condition is an IndexValueCondition.
 */
export function isIndexValueCondition<
  R extends StashRecord,
  M extends Mappings<R>
>(
  condition: any
): condition is IndexValueCondition<R, M> {
  return condition.kind == "range" ||
         condition.kind == "exact" ||
         condition.kind == "match"
}

/**
 * Type guard to check if a Condition is a ConjunctiveCondition.
 */
export function isConjunctiveCondition<
  R extends StashRecord,
  M extends Mappings<R>
>(
  condition: any
): condition is ConjunctiveCondition<R, M> {
  return condition.kind == "all"
}

/**
 * Creates an AllCondition from at least two conditions.
 * 
 * The first and second argument are mandatory and there can be zero or more
 * additional arguments.
 * 
 * @param condition1 the first condition
 * @param condition2 the second condition
 * @param remainingConditions additional conditions
 * @returns an AllCondition representing the logical AND of all of the provided
 * conditions.
 */
export function all<
  R extends StashRecord,
  M extends Mappings<R>
>(
  condition1: Condition<R, M>,
  condition2: Condition<R, M>,
  ...remainingConditions: Array<Condition<R, M>>
): AllCondition<R, M> {
  return { kind: "all", conditions: [condition1, condition2, ...remainingConditions] }
}

/**
 * An object of helper functions that generate the available operators for an
 * index type.
 */
export const operators: {

  exact: <
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string>
  >(
    indexName: N
  ) => ExactOperators<R, M, N>,

  range: <
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string>
  >(
    indexName: N
  ) => RangeOperators<R, M, N>,

  match: <
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string>
  >(
    indexName: N
  ) => MatchOperators<R, M, N>

} = {

  /**
   * Return an object containing operators for performing `exact` operations on `indexName`.
   */
  exact: <
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string> 
  >(
    indexName: N
  ) => ({
    eq: <T extends FieldTypeOfMapping<R, M[N]>>(value: T) => ({ kind: "exact", indexName, op: "eq", value })
  }),

  /**
   * Return an object containing operators for performing `range` operations on `indexName`.
   */
  range: <
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string>,
    T extends FieldTypeOfMapping<R, M[N]>
  >(
    indexName: N
  ) => {
    return {
      lt: (value: T) => ({ kind: "range", indexName, op: "lt", value }),
      lte: (value: T) => ({ kind: "range", indexName, op: "lte", value }),
      eq: (value: T) => ({ kind: "range", indexName, op: "eq", value }),
      gt: (value: T) => ({ kind: "range", indexName, op: "gt", value }),
      gte: (value: T) => ({ kind: "range", indexName, op: "gte", value }),
      between: (min: T, max: T) => ({ kind: "range", indexName, op: "between", min, max }),
    }
  },

  /**
   * Return an object containing operators for performing `match` operations on `indexName`.
   */
  match: <
    R extends StashRecord,
    M extends Mappings<R>,
    N extends Extract<keyof M, string>,
  >(
    indexName: N
  ) => ({
    match: (value: string) => ({ kind: "match", indexName, op: "match", value })
  })
}