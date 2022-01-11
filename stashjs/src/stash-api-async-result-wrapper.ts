import { V1 } from "@cipherstash/stashjs-grpc"
import { ClientUnaryCall, ClientWritableStream, Metadata, ServiceError } from "@grpc/grpc-js"
import { promisify } from "util"
import { AsyncResult, Err, fromPromise, fromPromiseFn2, Ok } from "./result"
import { AuthenticationFailure, GRPCError } from "./errors"
import { grpcMetadata } from "./auth/grpc-metadata"
import { AuthStrategy } from "./auth/auth-strategy"

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
export function makeAsyncResultApiWrapper(stub: V1.APIClient, authStrategy: AuthStrategy) {
  const secureEndpoint = secureWith(authStrategy)

  return {
    collection: {
      create: secureEndpoint<V1.Collection.CreateRequest, V1.Collection.CreateReply>(stub.createCollection),
      info: secureEndpoint<V1.Collection.InfoRequest, V1.Collection.InfoReply>(stub.collectionInfo),
      list: secureEndpoint<V1.Collection.ListRequest, V1.Collection.ListReply>(stub.collectionList),
      delete: secureEndpoint<V1.Collection.DeleteRequest, V1.Collection.InfoReply>(stub.deleteCollection)
    },
    document: {
      get: secureEndpoint<V1.Document.GetRequest, V1.Document.GetReply>(stub.get),
      getAll: secureEndpoint<V1.Document.GetAllRequest, V1.Document.GetAllReply>(stub.getAll),
      put: secureEndpoint<V1.Document.PutRequest, V1.Document.PutReply>(stub.put),
      delete: secureEndpoint<V1.Document.DeleteRequest, V1.Document.DeleteReply>(stub.delete),

      // `putStream` is a bit different. See the comments on the helper functions down below.
      putStream: authenticatePutStream(authStrategy)(stub.putStream)
    },
    query: {
      query: secureEndpoint<V1.Query.QueryRequest, V1.Query.QueryReply>(stub.query)
    }
  }
}

const secureWith =
  (authStrategy: AuthStrategy) =>
    <Req, Reply>(fn: (req: Req, metadata: Metadata, callback: (error?: ServiceError, result?: Reply | undefined) => void) => ClientUnaryCall) =>
      makeAuthenticator2(authStrategy)(fromPromiseFn2(promisify<Req, Metadata, Reply | undefined>(fn), GRPCError))

// Type of a gRPC endpoint that accepts two arguments: the request & metadata
type EndpointFn2<Request, Response> = (request: Request, metadata: Metadata) => AsyncResult<Response, GRPCError>

const makeAuthenticator2 =
  (authStrategy: AuthStrategy) =>
    <Request, Response>(fn: EndpointFn2<Request, Response>): (request: Request) => AsyncResult<Response, GRPCError> =>
      async (request) => {
        const authDetails = await authStrategy.getAuthenticationDetails()
        if (authDetails.ok) {
          return fn(request, grpcMetadata(authDetails.value.authToken))
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

  const callback = (error?: ServiceError, result?: V1.Document.StreamingPutReply) => {
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
  stream: ClientWritableStream<V1.Document.StreamingPutRequest>,
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
  (authStrategy: AuthStrategy) =>
    (fn: V1.APIClient["putStream"]): () => AsyncResult<PutStreamResult, GRPCError | AuthenticationFailure> =>
      async () => {
        const authDetails = await authStrategy.getAuthenticationDetails()
        if (authDetails.ok) {
          const [reply, callback] = capturePutStreamReply()
          const stream = fn(grpcMetadata(authDetails.value.authToken), callback)
          return Ok({ stream, reply })
        } else {
          return Err(GRPCError(authDetails.error))
        }
      }