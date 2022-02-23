import {
  KmsKeyringNode,
  buildClient,
  KMS as KMSv2,
  CommitmentPolicy,
  NodeCachingMaterialsManager,
  getLocalCryptographicMaterialsCache,
} from '@aws-crypto/client-node'
import { getClient } from '@aws-crypto/client-node'
import { KMS as KMSv3 } from "@aws-sdk/client-kms"
import * as crypto from 'crypto'
import { deserialize, serialize } from '../serializer'
import { AWSClientConfig } from '../auth/aws-client-config'
import { AsyncResult, Ok, Err, fromPromise } from '../result'
import { DecryptionFailure, EncryptionFailure, KMSError  } from '../errors'

// TODO: Read https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/concepts.html#key-commitment

const client = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
)

type ThenArg<T> = T extends PromiseLike<infer U> ? U : never
// This could be considered a bit hacky. The AWS SDK does not export the
// EncryptOutput type even though it exports functions that return it. We return
// this type ourselves but TS to the rescue.
//
// TODO: submit patch to export the EncryptOutput type (or figure out why it's
// not exported).  Also publish the info on how to work around it (see below)
export type EncryptOutput = ThenArg<ReturnType<ReturnType<typeof buildClient>['encrypt']>>

export const cacheCapacity = 1000

/* maxAge is the time in milliseconds that an entry will be cached.
 * Elements are actively removed from the cache.
 */
const maxAge = 1000 * 30

/* The maximum amount of bytes that will be encrypted under a single data key.
 * This value is optional,
 * but you should configure the lowest value possible.
 */
const maxBytesEncrypted = 100*1000

/* The maximum number of messages that will be encrypted under a single data key.
 * This value is optional,
 * but you should configure the lowest value possible.
 */
const maxMessagesEncrypted = 1000

const partition = "source"

export type CipherSuite = {
  encrypt: <T>(plaintext: T) => AsyncResult<EncryptOutput, EncryptionFailure>
  decrypt: <T>(ciphertext: Buffer) => AsyncResult<T, DecryptionFailure>
}

export function makeNodeCachingMaterialsManager(generatorKeyId: string, awsConfig: AWSClientConfig): NodeCachingMaterialsManager {
  return new NodeCachingMaterialsManager({
    backingMaterials: new KmsKeyringNode({ generatorKeyId, clientProvider: getClient(KMSv2, awsConfig) }),
    cache: getLocalCryptographicMaterialsCache(cacheCapacity),
    maxAge,
    maxBytesEncrypted,
    partition,
    maxMessagesEncrypted,
  })
}

export function makeCipherSuite(cmm: NodeCachingMaterialsManager): CipherSuite {
  const context = {
    version: "0.1",
    format: "BSON"
  }

  return {
    encrypt: async <T>(plaintext: T) => {
      const buffer = serialize(plaintext)
      const promise = client.encrypt(cmm, buffer, {
        encryptionContext: context,
        plaintextLength: buffer.byteLength
      })
      return await fromPromise(promise, EncryptionFailure)
    },

    decrypt: async <T>(ciphertext: Buffer) => {
      const promise = client.decrypt(cmm, ciphertext)
      const decrypted = await fromPromise(promise, DecryptionFailure)
      if (decrypted.ok) {
        return Ok(deserialize<T>(decrypted.value.plaintext))
      } else {
        return Err(decrypted.error)
      }
    }
  }
}

/**
 * Given an AWS region name and a Base64-encoded naming key, returns a function
 * that when given a name will return a Buffer containing hash of the name.
 *
 * The hash generated by this function is deterministic by design.
 *
 * @param kmsClient the KMS client
 * @param namingKey Base64-encoded naming key
 * @returns a function that when given a name, returns the hash of the name as a Buffer
 */
export async function makeRefGenerator(kmsClient: KMSv3, namingKey: string): AsyncResult<MakeRefFn, KMSError> {
  // Do the expensive initialisation here instead of in `makeRef(string)`.  That
  // way it only happens once.
  const promise = kmsClient.decrypt({ CiphertextBlob: Buffer.from(namingKey, 'base64') })
  const key = await fromPromise(promise, KMSError)

  if (key.ok) {
    return Ok(function makeRef(name) {
      const hmac = crypto.createHmac('sha256', key.value.Plaintext!)
      hmac.update(name)
      return hmac.digest()
    })
  } else {
    return Err(key.error)
  }
}

export type MakeRefFn = (name: string) => Buffer
