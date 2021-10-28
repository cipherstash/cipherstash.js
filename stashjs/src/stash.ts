import { V1 } from '@cipherstash/stashjs-grpc'

import { CipherSuite, makeCipherSuite } from './crypto/cipher'
import { CollectionSchema } from './collection-schema'
import { AuthStrategy } from './auth/auth-strategy'
import { ViaClientCredentials } from './auth/via-client-credentials'
import { ViaStoredToken } from './auth/via-stored-token'
import { Mappings, MappingsMeta, StashRecord } from './dsl/mappings-dsl'

import { Collection } from './collection'
import { idBufferToString, idStringToBuffer, makeRef, refBufferToString } from './utils'
import { loadConfigFromEnv, StashConfig } from './stash-config'

import { grpcMetadata } from './auth/grpc-metadata'
import { CollectionMetadata, configStore } from '.'
import { isWorkspaceConfigAndAuthInfo, WorkspaceConfigAndAuthInfo } from './auth/config-store'

export type LoadConfigOptions = Readonly<{
  workspaceId?: string
}>

/**
 * Represents an authenticated session to a CipherStash instance.
 *
 * Provides methods for creating, loading and deleting collections.
 *
 * TODO: extract the GRPC-message-munging code into helpers in the `src/grpc`
 * directory.
 */
export class Stash {
  readonly sourceDataCipherSuite: CipherSuite

  private constructor(
    public readonly stub: V1.APIClient,
    public readonly serviceFqdn: string,
    public readonly authStrategy: AuthStrategy,
    public readonly sourceDataCMK: string,
  ) {
    this.sourceDataCipherSuite = makeCipherSuite(sourceDataCMK)
  }

  public static async loadConfig(opts?: LoadConfigOptions): Promise<WorkspaceConfigAndAuthInfo> {
    const config = opts?.workspaceId
      ? await configStore.loadWorkspaceConfigAndAuthInfo(opts.workspaceId)
      : await configStore.loadDefaultWorkspaceConfigAndAuthInfo()

    return config
  }

  public static loadConfigFromEnv(): StashConfig {
    return loadConfigFromEnv()
  }

  public static async connect(config: WorkspaceConfigAndAuthInfo): Promise<Stash>
  public static async connect(config: StashConfig): Promise<Stash>
  public static async connect(config: StashConfig | WorkspaceConfigAndAuthInfo): Promise<Stash> {
    if (isWorkspaceConfigAndAuthInfo(config)) {
      try {
        const authStrategy = new ViaStoredToken(config)
        await authStrategy.initialise()
        return new Stash(
          V1.connect(config.workspaceConfig.serviceFqdn),
          config.workspaceConfig.serviceFqdn,
          authStrategy,
          config.workspaceConfig.keyManagement.key.cmk
        )
      } catch (err) {
        return Promise.reject(err)
      }
    } else {
      try {
        const authStrategy = new ViaClientCredentials(config)
        await authStrategy.initialise()
        return new Stash(
          V1.connect(config.serviceFqdn),
          config.serviceFqdn,
          authStrategy,
          config.keyManagement.key.cmk
        )
      } catch (err) {
        return Promise.reject(err)
      }
    }
  }

  public close(): void {
    this.stub.close()
  }

  public async createCollection<
    R extends StashRecord,
    M extends Mappings<R>,
    MM extends MappingsMeta<M>
  >(
    schema: CollectionSchema<R, M, MM>
  ): Promise<Collection<R, M, MM>> {
    return this.authStrategy.authenticatedRequest((authToken: string) =>
      new Promise(async (resolve, reject) => {
        const request: V1.CreateRequestInput = {
          ref: await makeRef(schema.name, this.serviceFqdn),
          metadata: await this.encryptCollectionMetadata({ name: schema.name }),
          indexes: await this.encryptMappings(schema)
        }

        this.stub.createCollection(request, grpcMetadata(authToken), async (err: any, res: any) => {
          if (err) {
            reject(err)
          } else {
            this.unpackCollection<R, M, MM>(res!).then(resolve, reject)
          }
        })
      })
    )
  }

  public async loadCollection<
    R extends StashRecord,
    M extends Mappings<R>,
    MM extends MappingsMeta<M>
  >(
    definition: CollectionSchema<R, M, MM>
  ): Promise<Collection<R, M, MM>> {
    return this.authStrategy.authenticatedRequest((authToken: string) =>
      new Promise(async (resolve, reject) => {
        const ref = await makeRef(definition.name, this.serviceFqdn)
        this.stub.collectionInfo({
          ref
        }, grpcMetadata(authToken), async (err: any, res: any) => {
          if (err) {
            reject(err)
          } else {
            this.unpackCollection<R, M, MM>(res!).then(resolve, reject)
          }
        })
      })
    )
  }

  public deleteCollection(
    collectionName: string
  ): Promise<void> {
    return this.authStrategy.authenticatedRequest((authToken: string) =>
      new Promise(async (resolve, reject) => {
        const ref = await makeRef(collectionName, this.serviceFqdn)
        this.stub.deleteCollection({
          ref
        }, grpcMetadata(authToken), async (err: any, _res: any) => {
          if (err) {
            reject(err)
          } else {
            resolve(undefined)
          }
        })
      })
    )
  }

  private async unpackCollection<
    R extends StashRecord,
    M extends Mappings<R>,
    MM extends MappingsMeta<M>
  >(
    infoReply: V1.InfoReplyOutput
  ): Promise<Collection<R, M, MM>> {
    const { id, indexes: encryptedMappings, metadata } = infoReply
    const collectionMeta = await this.decryptCollectionMetadata(metadata)
    const storedMappings = await this.decryptMappings(encryptedMappings!)

    // TODO verify the collection has the mappings that the user expects - they should be deep equal
    const mappings: M = Object.fromEntries(storedMappings.map(sm => [sm.meta.$indexName, sm.mapping]))
    const mappingsMeta: MM = Object.fromEntries(storedMappings.map(sm => {
      return [sm.meta.$indexName, {
        ...sm.meta,
        $prf: Buffer.from(sm.meta.$prf, 'hex'),
        $prp: Buffer.from(sm.meta.$prp, 'hex'),
      }]
    }))

    return Promise.resolve(
      new Collection<R, M, MM>(
        this,
        idBufferToString(id!),
        refBufferToString(infoReply.ref!),
        new CollectionSchema(collectionMeta.name, mappings, mappingsMeta)
      )
    )
  }

  private async decryptMappings(
    encryptedMappings: V1.IndexOutput[]
  ): Promise<Array<StoredMapping>> {

    const storedMappings = await Promise.all(encryptedMappings.map(async ({ settings, id: indexId }) => {
      const { mapping, meta } = await this.sourceDataCipherSuite.decrypt(settings!)
      return {
        mapping,
        meta: {
          ...meta,
          $indexId: idBufferToString(indexId),
          $prf: Buffer.from(meta!.$prf, 'hex'),
          $prp: Buffer.from(meta!.$prp, 'hex'),
        }
      }
    })) as Array<StoredMapping>

    return storedMappings
  }

  private async encryptMappings<
    R extends StashRecord,
    M extends Mappings<R>,
    MM extends MappingsMeta<M>
  >(
    definition: CollectionSchema<R, M, MM>
  ): Promise<Array<V1.IndexInput>> {

    const encryptedIndexes = await Promise.all(Object.entries(definition.mappings).map(async ([indexName, mapping]) => {
      const storedMapping: StoredMapping = {
        mapping,
        meta: {
          ...definition.meta[indexName]!,
          $prf: definition.meta[indexName]!.$prf.toString('hex'),
          $prp: definition.meta[indexName]!.$prp.toString('hex'),
        }
      }

      const { result } = await this.sourceDataCipherSuite.encrypt(storedMapping)
      return {
        id: idStringToBuffer(storedMapping.meta.$indexId),
        settings: result
      }
    }))

    return encryptedIndexes
  }

  private async encryptCollectionMetadata(metadata: CollectionMetadata): Promise<Buffer> {
    const { result } = await this.sourceDataCipherSuite.encrypt(metadata)
    return result
  }

  private async decryptCollectionMetadata(buffer: Buffer): Promise<CollectionMetadata> {
    return await this.sourceDataCipherSuite.decrypt(buffer)
  }
}

type StoredMapping = {
  mapping: any
  meta: any
}
