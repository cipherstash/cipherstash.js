import { ClientWritableStream } from "@grpc/grpc-js"
import { V1 } from "@cipherstash/stashjs-grpc"
import { CollectionSchema } from "."
import { AnalysisRunner, AnalysisResult } from "./analysis-runner"
import { Mappings, MappingsMeta, StashRecord } from "./dsl/mappings-dsl"
import { StashInternal } from "./stash-internal"
import { AsyncResult, Err, fromPromise, Ok } from "./result"
import { StreamingPutFailure } from "./errors"
import { makeAsyncResultApiWrapper } from "./stash-api-async-result-wrapper"

export class StreamWriter<R extends StashRecord, M extends Mappings<R>, MM extends MappingsMeta<M>> {
  private analysisRunner: AnalysisRunner
  private api: ReturnType<typeof makeAsyncResultApiWrapper>

  constructor(private collectionId: Uint8Array, stash: StashInternal, schema: CollectionSchema<R, M, MM>) {
    this.analysisRunner = new AnalysisRunner({ profile: stash.profile, schema })
    this.api = makeAsyncResultApiWrapper(stash.stub, stash.profile)
  }

  /**
   * Performs a streaming insert to a collection.
   *
   * @param records a source of records to insert. Must implement `Iterator`. A
   *                generator function will work.
   *
   * @returns a Promise that will resolve once all records from the iterator
   *          have been written.
   */
  public writeAll(records: AsyncIterator<R>): AsyncResult<V1.Document.StreamingPutReply, StreamingPutFailure> {
    return this.writeStream(this.analysisRunner.analyze(records))
  }

  private async writeStream(
    analysisResults: AsyncIterator<AnalysisResult>
  ): AsyncResult<V1.Document.StreamingPutReply, StreamingPutFailure> {
    const initialised = await this.api.document.putStream()
    if (initialised.ok) {
      const { stream, reply } = initialised.value
      const begin = await this.writeStreamingPutBegin(stream, this.collectionId)
      if (!begin.ok) {
        return Err(begin.error)
      }
      let result = await analysisResults.next()
      while (!result.done) {
        const putRequest = await this.writeOneStreamingPutRequest(stream, result.value)
        if (!putRequest.ok) {
          return Err(putRequest.error)
        }
        result = await analysisResults.next()
      }
      stream.end()

      const message = await reply

      stream.removeAllListeners()

      if (message.ok) {
        return Ok(message.value)
      } else {
        return Err(StreamingPutFailure(message.error))
      }
    } else {
      return Err(StreamingPutFailure(initialised.error))
    }
  }

  private toStreamingPutRequest(analysisResult: AnalysisResult): V1.Document.StreamingPutRequest {
    return {
      document: {
        vectors: analysisResult.vectors,
        source: {
          id: analysisResult.docId,
          source: analysisResult.encryptedSource,
        },
      },
    }
  }

  private writeStreamingPutBegin(
    stream: ClientWritableStream<V1.Document.StreamingPutRequest>,
    collectionId: Uint8Array
  ): AsyncResult<void, StreamingPutFailure> {
    const promise = new Promise<void>((resolve, reject) => {
      this.writeWithDrainAndErrorHandlers(stream, { begin: { collectionId } }, resolve, reject)
    })

    return fromPromise(promise, (err: any) => err)
  }

  private writeOneStreamingPutRequest(
    stream: ClientWritableStream<V1.Document.StreamingPutRequest>,
    analysisResult: AnalysisResult
  ): AsyncResult<void, StreamingPutFailure> {
    let payload = this.toStreamingPutRequest(analysisResult)
    const promise = new Promise<void>((resolve, reject) => {
      this.writeWithDrainAndErrorHandlers(stream, payload, resolve, reject)
    })

    return fromPromise(promise, (err: any) => err)
  }

  private writeWithDrainAndErrorHandlers<Payload>(
    stream: ClientWritableStream<Payload>,
    payload: Payload,
    resolve: (value: void | PromiseLike<void>) => void,
    reject: (reason?: any) => void
  ): void {
    const cleanupListeners = () => {
      stream.removeListener("error", errorListener)
      stream.removeListener("drain", drainListener)
    }
    const errorListener = (err: any) => {
      cleanupListeners()
      reject(err)
    }
    const drainListener = () => {
      cleanupListeners()
      resolve(void 0)
    }
    if (
      !stream.write(payload, (err: any) => {
        cleanupListeners()
        reject(err)
      })
    ) {
      stream.once("error", errorListener)
      stream.once("drain", drainListener)
    } else {
      process.nextTick(() => resolve(void 0))
    }
  }
}
