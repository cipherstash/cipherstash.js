import { V1 } from "@cipherstash/stashjs-grpc"
import { OauthAuthenticationInfo } from "./auth/oauth-utils"
import { requestCallback, ClientUnaryCall, ClientWritableStream, Metadata } from "@grpc/grpc-js"
import { promisify } from "util"
import { compose } from "./fp-utils"
import { AsyncResult, Err, fromPromise, fromPromiseFn2, Ok } from "./result"
import { AuthenticationFailure, GRPCError, NativeError } from "./errors"
import { grpcMetadata } from "./auth/grpc-metadata"
import { stringify } from "./utils"
import { Memo } from "./auth/auth-strategy"
import { StashProfile } from "./stash-profile"
import { logger, isDebugLoggingEnabled } from "./logger"

/**
 * Creates a wrapper for the generated GRPC API that:
 *
 * 1. Sets authentication credentials on the GRPC metadata, and
 * 2. Converts Promises to AsyncResults
 *
 * @param stub the generated APIClient
 * @param authStrategy the authentication strategy implementation to use
 *
 * @returns an object containing an enhanced API
 */
export function makeAsyncResultApiWrapper(stub: V1.APIClient, profile: StashProfile) {
  const credsGenerator: Memo<OauthAuthenticationInfo> =
    profile.withFreshDataServiceCredentials<OauthAuthenticationInfo>(async creds => Ok(creds))
  const secureEndpoint = secureWith(credsGenerator)

  return {
    collection: {
      create: requestLogger("collection.create")(
        retryOnConnectionReset(
          secureEndpoint<V1.Collection.CreateRequest, V1.Collection.CreateReply>(stub.createCollection.bind(stub))
        )
      ),
      info: requestLogger("collection.info")(
        retryOnConnectionReset(
          secureEndpoint<V1.Collection.InfoRequest, V1.Collection.InfoReply>(stub.collectionInfo.bind(stub))
        )
      ),
      list: requestLogger("collection.list")(
        retryOnConnectionReset(
          secureEndpoint<V1.Collection.ListRequest, V1.Collection.ListReply>(stub.collectionList.bind(stub))
        )
      ),
      delete: requestLogger("collection.delete")(
        retryOnConnectionReset(
          secureEndpoint<V1.Collection.DeleteRequest, V1.Collection.InfoReply>(stub.deleteCollection.bind(stub))
        )
      ),
    },
    document: {
      get: requestLogger("document.get")(
        retryOnConnectionReset(secureEndpoint<V1.Document.GetRequest, V1.Document.GetReply>(stub.get.bind(stub)))
      ),
      getAll: requestLogger("document.getAll")(
        retryOnConnectionReset(
          secureEndpoint<V1.Document.GetAllRequest, V1.Document.GetAllReply>(stub.getAll.bind(stub))
        )
      ),
      put: requestLogger("document.put")(
        retryOnConnectionReset(secureEndpoint<V1.Document.PutRequest, V1.Document.PutReply>(stub.put.bind(stub)))
      ),
      delete: requestLogger("document.delete")(
        retryOnConnectionReset(
          secureEndpoint<V1.Document.DeleteRequest, V1.Document.DeleteReply>(stub.delete.bind(stub))
        )
      ),

      // `putStream` is a bit different. See the comments on the helper functions down below.
      putStream: authenticatePutStream(credsGenerator)(stub.putStream.bind(stub)),
    },
    query: {
      query: requestLogger("query.query")(
        retryOnConnectionReset(secureEndpoint<V1.Query.QueryRequest, V1.Query.QueryReply>(stub.query.bind(stub)))
      ),
    },
  }
}

// Helper to wrap a NativeError inside a GRPCError.
const WrappedNativeError = compose(GRPCError, NativeError)

const secureWith =
  (credsGenerator: Memo<OauthAuthenticationInfo>) =>
  <Req, Reply>(fn: (req: Req, metadata: Metadata, callback: requestCallback<Reply>) => ClientUnaryCall) =>
    makeAuthenticator2(credsGenerator)(
      fromPromiseFn2(promisify<Req, Metadata, Reply | undefined>(fn), WrappedNativeError)
    )

const requestLogger = (endpoint: string) => {
  if (isDebugLoggingEnabled()) {
    return <Request, Response>(
        fn: (request: Request) => AsyncResult<Response, GRPCError>
      ): ((request: Request) => AsyncResult<Response, GRPCError>) =>
      async request => {
        const timerBegin = process.hrtime.bigint()
        const response = await fn(request)
        const timerEnd = process.hrtime.bigint()
        const durationMS = Number((timerEnd - timerBegin) / 1000000n)
        if (response.ok) {
          logger.debug(`${endpoint} OK ${stringify({ durationMS, request, response: response.value })}`)
        } else {
          logger.debug(`${endpoint} ERR ${stringify({ durationMS, request, response: response.error })}`)
        }
        return response
      }
  } else {
    return <Request, Response>(
        fn: (request: Request) => AsyncResult<Response, GRPCError>
      ): ((request: Request) => AsyncResult<Response, GRPCError>) =>
      request =>
        fn(request)
  }
}

const retryOnConnectionReset =
  <Request, Response>(
    fn: (request: Request) => AsyncResult<Response, GRPCError>
  ): ((request: Request) => AsyncResult<Response, GRPCError>) =>
  async request => {
    const response = await fn(request)
    if (!response.ok) {
      // NOTE: This `cause.cause.message` thing is terrible, but because a
      // GRPCError wraps a NativeError which in turn wraps a JSError we have to
      // unpack it this way.
      if (response.error.tag === "GRPCError" && response.error.cause?.cause?.message?.includes("ECONNRESET")) {
        // We simply retry the request (just once)
        return await fn(request)
      }
    }
    return response
  }

// Type of a gRPC endpoint that accepts two arguments: the request & metadata
type EndpointFn2<Request, Response> = (request: Request, metadata: Metadata) => AsyncResult<Response, GRPCError>

const makeAuthenticator2 =
  (credsGenerator: Memo<OauthAuthenticationInfo>) =>
  <Request, Response>(fn: EndpointFn2<Request, Response>): ((request: Request) => AsyncResult<Response, GRPCError>) =>
  async request => {
    const authDetails = await credsGenerator.freshValue()
    if (authDetails.ok) {
      return fn(request, grpcMetadata(authDetails.value.accessToken))
    } else {
      return Err(GRPCError(authDetails.error))
    }
  }

// Returns a tuple of:
// - AsyncResult that will resolve when the stream has closed and final reply
//   from the server has been received.
// - a callback function to be passed to to `V1.APIClient.putStream`
const capturePutStreamReply = () => {
  // In Javascript, a Promise cannot be resolved from the "outside" and in this
  // case we need to be able to return a callback but the callback is also the
  // thing that resolves the promise. This function deals with the unpleasant
  // workaround.
  let promiseResolve: (_: V1.Document.StreamingPutReply | PromiseLike<V1.Document.StreamingPutReply>) => void
  let promiseReject: (_?: unknown) => void

  const promise = new Promise<V1.Document.StreamingPutReply>((resolve, reject) => {
    promiseResolve = resolve
    promiseReject = reject
  })

  const callback: requestCallback<V1.Document.StreamingPutReply> = (error, result) => {
    if (error) {
      promiseReject(error)
    } else {
      if (result) {
        promiseResolve(result)
      } else {
        promiseReject("Internal error: no result and no error passed to `putStream` callback")
      }
    }
  }

  return [fromPromise<V1.Document.StreamingPutReply, GRPCError>(promise, GRPCError), callback] as const
}

// The result of calling `putStream`. The `stream` field is returned
// synchronously, the `reply` is asynchronous and will be resolved after the
// client has finished writing and has closed the stream.
type PutStreamResult = {
  stream: ClientWritableStream<V1.Document.StreamingPutRequest>
  reply: AsyncResult<V1.Document.StreamingPutReply, GRPCError>
}

// Handles authentication and initialisation for putStream.
//
// NOTE: grpc-js generates a really weird API for a writeable stream with a reply at the end.
//
// Calling `putStream` *synchronously* returns a ClientWriteableStream but also
// accepts a callback that is resolved *asynchronously* after the client closes
// the stream and the server sends the final reply.
//
// It's different enough that we have to special-case the handling of `putStream`.
const authenticatePutStream =
  (credsGenerator: Memo<OauthAuthenticationInfo>) =>
  (fn: V1.APIClient["putStream"]): (() => AsyncResult<PutStreamResult, GRPCError | AuthenticationFailure>) =>
  async () => {
    const authDetails = await credsGenerator.freshValue()
    if (authDetails.ok) {
      const [reply, callback] = capturePutStreamReply()
      const stream = fn(grpcMetadata(authDetails.value.accessToken), callback)
      return Ok({ stream, reply })
    } else {
      return Err(GRPCError(authDetails.error))
    }
  }
