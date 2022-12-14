import { GluegunCommand } from "@cipherstash/gluegun"
import {
  MappingOn,
  Stash,
  StashRecord,
  describeError,
  isDynamicMatchMapping,
  isExactMapping,
  isFieldDynamicMatchMapping,
  isMatchMapping,
  isRangeMapping,
} from "@cipherstash/stashjs"
import { Toolbox } from "@cipherstash/gluegun/build/types/domain/toolbox"

const command: GluegunCommand = {
  name: "describe-collection",

  run: async (toolbox: Toolbox) => {
    const { print, parameters } = toolbox

    const profileName: string | undefined = parameters.options.profile

    const profile = await Stash.loadProfile({ profileName }).catch(error => {
      print.error(`Could not load profile. Reason: "${describeError(error)}"`)
      process.exit(1)
    })

    try {
      const stash = await Stash.connect(profile)
      const collectionName = parameters.first
      if (collectionName === undefined) {
        print.error("No collection name specified.")
        process.exit(1)
      }

      const collection = await stash.loadCollection(collectionName)
      const mappings = {}

      Object.entries(collection.schema.mappings).forEach(([indexName, mapping]) => {
        mappings[indexName] = {
          indexType: mapping.kind,
          fields: describeFields(mapping),
          operators: describeOperators(mapping),
        }
      })

      if (parameters.options.json) {
        const json = {
          id: collection.id,
          name: collection.name,
          ref: collection.ref,
          mappings,
        }
        print.info(JSON.stringify(json, null, 2))
      } else {
        print.highlight(" Identifiers:")
        print.table(
          [
            ["ID", collection.id],
            ["Name", collection.name],
            ["Ref (hex encoded)", collection.ref],
          ],
          { format: "lean" }
        )

        const tbl = [["Index Name", "Index Type", "Field(s)", "Query Operators"]]

        for (const k in mappings) {
          tbl.push([k, mappings[k].indexType, mappings[k].fields, mappings[k].operators])
        }

        print.newline()
        print.highlight(" Indexes:")
        print.table(tbl, { format: "lean" })
      }
    } catch (error) {
      print.error(`Could not list collections. Reason: "${describeError(error)}"`)
    }
  },
}

export default command

function describeFields(mapping: MappingOn<StashRecord>): string {
  if (isDynamicMatchMapping(mapping) || isFieldDynamicMatchMapping(mapping)) {
    return "all string fields"
  }

  if (isMatchMapping(mapping)) {
    return mapping.fields.join(", ")
  }

  if (isRangeMapping(mapping) || isExactMapping(mapping)) {
    return mapping.field
  }

  throw new Error(`Unreachable: unknown index type ${JSON.stringify(mapping)}`)
}

function describeOperators(mapping: MappingOn<StashRecord>): string {
  if (isMatchMapping(mapping) || isDynamicMatchMapping(mapping) || isFieldDynamicMatchMapping(mapping)) {
    return "=~"
  }

  if (isRangeMapping(mapping)) {
    return "<, <=, =, >= >"
  }

  if (isExactMapping(mapping)) {
    return "="
  }

  throw new Error(`Unreachable: unknown index type ${JSON.stringify(mapping)}`)
}
