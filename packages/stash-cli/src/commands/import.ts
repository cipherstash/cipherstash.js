import { GluegunCommand } from "@cipherstash/gluegun"
import * as fs from "fs"
import { Stash, describeError, StashRecord } from "@cipherstash/stashjs"
import { Toolbox } from "@cipherstash/gluegun/build/types/domain/toolbox"

const command: GluegunCommand = {
  name: "import",

  run: async (toolbox: Toolbox) => {
    const { print, parameters } = toolbox

    const profileName: string | undefined = parameters.options.profile

    const collectionName: string | undefined = parameters.first

    if (collectionName === undefined) {
      print.error("No collection name specified.")
      process.exit(1)
    }

    const dataFile: string | undefined = parameters.options.data
    let data: Array<StashRecord>

    if (dataFile === undefined) {
      print.error("No data file specified.")
      process.exit(1)
    }

    try {
      const dataBuffer = await fs.promises.readFile(dataFile)
      data = JSON.parse(dataBuffer.toString("utf8"))
    } catch (error) {
      print.error(`Could not load source data. Reason: "${error}"`)
      process.exit(1)
    }

    const profile = await Stash.loadProfile({
      profileName,
    }).catch(error => {
      print.error(`Could not load profile. Reason: "${describeError(error)}"`)
      process.exit(1)
    })

    try {
      const stash = await Stash.connect(profile)
      const collection = await stash.loadCollection(collectionName)

      const result = await collection.putStream(streamSources(data))
      print.info(`Imported ${result.numInserted} sources into the '${collectionName}' collection.`)
    } catch (error) {
      print.error(`Could not import sources. Reason: "${describeError(error)}"`)
    }
  },
}

export default command

async function* streamSources<T>(sources: Array<T>) {
  for (const s of sources) {
    yield s
  }
}
