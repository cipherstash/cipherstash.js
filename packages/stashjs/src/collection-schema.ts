import { StashRecord, Mappings, MappingsMeta, MappingOn } from "./dsl/mappings-dsl"
import { Query, QueryBuilder, OperatorsForIndex, operators, isAnyQuery } from "./dsl/query-dsl"
import { makeId, idBufferToString } from "./utils"
import { CollectionSchemaDefinition } from "./parsers/collection-schema-parser"
import * as crypto from "crypto"
import { QueryBuilderError } from "./errors"
import { RecordTypeDefinition } from "./record-type-definition"

/**
 * Class for representing a *definition* of a collection that includes a name
 * and its mappings, but has not yet been persisted to the data-service.
 */
export class CollectionSchema<R extends StashRecord, M extends Mappings<R>, MM extends MappingsMeta<M>> {
  /**
   * Metadata about the Mappings, such as encrypted indexID and encryption keys.
   */

  constructor(
    public readonly name: string,
    public readonly recordType: RecordTypeDefinition,
    public readonly mappings: M,
    public readonly meta: MM
  ) {}

  /**
   * Defines a named Collection via a fluent API.
   *
   * e.g.
   * ```typescript
   * const schema = CollectionSchema.define<Employee>("employees").notIndexed()
   * // or
   * const schema = CollectionSchema.define<Employee>("employees").fromCollectionSchemaDefinition({ ... })
   * ```
   *
   * @param collectionName the name of the collection
   */
  public static define<R extends StashRecord>(collectionName: string) {
    return {
      fromCollectionSchemaDefinition(def: CollectionSchemaDefinition) {
        type M = Mappings<R>
        type MM = MappingsMeta<M>
        return new CollectionSchema<R, M, MM>(
          collectionName,
          def.type,
          def.indexes as M,
          Object.fromEntries(
            Object.keys(def.indexes).map(indexName => {
              return [
                indexName,
                {
                  $indexName: indexName,
                  // Keep the generated UUID as a string
                  // because we'll use it later to key analysis objects
                  //$indexId: idBufferToString(makeId()),
                  $indexId: idBufferToString(makeId()),
                  $prfKey: crypto.randomBytes(16),
                  $prpKey: crypto.randomBytes(16),
                },
              ]
            })
          ) as MM
        )
      },

      /**
       * Defines a named Collection *without* any mappings.
       *
       * This is useful for defining a collection to serve as a simple key value
       * store.  The only operations supported on a collection with this schema will
       * be `put`, `get` and `delete`. It will not be queryable.
       *
       * @returns a CollectionSchema instance
       */
      notIndexed() {
        type M = Mappings<R>
        type MM = MappingsMeta<M>
        return new CollectionSchema<R, M, MM>(collectionName, {}, {} as M, {} as MM)
      },
    }
  }

  /**
   * Builds a Query that can be later executed.
   *
   * @param callback a user-supplied callback that can build a Query using the query DSL.
   * @returns a Query object
   */
  public buildQuery(callback: QueryBuilderCallback<R, M>): Query<R, M> {
    const maybeQuery = callback(this.makeQueryBuilder())

    // Since the QueryBuilderCallback could return "any", double check that the returned
    // object was actually a query.
    if (!isAnyQuery(maybeQuery)) {
      throw new QueryBuilderError("Query builder returned invalid query")
    }

    return maybeQuery
  }

  /**
   * Returns a QueryBuilder tailored to the Mappings defined on this Collection.
   */
  public makeQueryBuilder(): QueryBuilder<R, M> {
    const schemaName = this.name

    type MappingKey = Extract<keyof M, string>

    function makeIndexOpsHandler(
      indexName: string,
      operators?: OperatorsForIndex<R, M, MappingKey>
    ): ProxyHandler<object> {
      return {
        get(_target, opName) {
          if (typeof opName !== "string") {
            throw new QueryBuilderError(`Cannot index operators with invalid type: ${typeof opName}`)
          }

          if (!operators) {
            throw new QueryBuilderError(
              `Cannot use operator "${opName}" on "${indexName}" on collection "${schemaName}" as there are no operators`
            )
          }

          const operator = operators[opName as keyof typeof operators]

          if (!operator) {
            throw new QueryBuilderError(
              `Cannot use operator "${opName}" on index "${indexName}" on collection "${schemaName}"`
            )
          }

          return operator
        },
      }
    }

    return new Proxy<object>(
      {},
      {
        get: (_target, indexName) => {
          if (typeof indexName !== "string") {
            throw new QueryBuilderError(`Cannot index QueryBuilder with invalid type: ${typeof indexName}`)
          }

          const mapping = this.mappings[indexName]

          if (!mapping) {
            throw new QueryBuilderError(`No index named "${indexName}" on collection "${schemaName}"`)
          }

          const operators = this.operatorsFor(indexName as MappingKey, mapping)

          return new Proxy<object>({}, makeIndexOpsHandler(indexName, operators))
        },
      }
    ) as unknown as QueryBuilder<R, M>
  }

  /**
   * Returns an Operators object containing operator functions for the specified
   * index name and Mapping.
   */
  private operatorsFor<MO extends MappingOn<R>, N extends Extract<keyof M, string>>(
    indexName: N,
    mapping: MO
  ): OperatorsForIndex<R, M, N> {
    switch (mapping.kind) {
      case "exact":
        return operators.exact(indexName) as OperatorsForIndex<R, M, N>
      case "range":
        return operators.range(indexName) as unknown as OperatorsForIndex<R, M, N> // FIXME: remove unknown (this was added when upgraded to TS 4.7.3)
      case "match":
        return operators.match(indexName) as OperatorsForIndex<R, M, N>
      case "dynamic-match":
        return operators.dynamicMatch(indexName) as OperatorsForIndex<R, M, N>
      case "field-dynamic-match":
        return operators.scopedDynamicMatch(indexName) as OperatorsForIndex<R, M, N>
    }
  }
}

export type QueryBuilderCallback<R extends StashRecord, M extends Mappings<R>> = ($: QueryBuilder<R, M>) => Query<R, M>
