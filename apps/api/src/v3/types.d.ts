/*
 * v3 request and response types, derived from the OpenAPI document that
 * Fastify builds from schemas.js (openapi.generated.d.ts, `npm run gen:types`).
 * schemas.js stays the single source: change a schema, regenerate, and
 * `npm run typecheck` flags the handlers and clients that no longer match.
 */
import type { FastifyRequest } from 'fastify';
import type { paths } from './openapi.generated';

export type V3Path = keyof paths;
export type V3Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type V3Operation<P extends V3Path, M extends V3Method> = NonNullable<paths[P][M]>;

type Defined<T> = [T] extends [never] ? {} : NonNullable<T>;
type JsonOf<T> = T extends { content: { 'application/json': infer B } } ? B : never;

export type V3Params<P extends V3Path, M extends V3Method> = V3Operation<P, M> extends { parameters: { path?: infer T } } ? Defined<T> : {};
export type V3Query<P extends V3Path, M extends V3Method> = V3Operation<P, M> extends { parameters: { query?: infer T } } ? Defined<T> : {};
export type V3Body<P extends V3Path, M extends V3Method> = V3Operation<P, M> extends { requestBody?: infer B } ? JsonOf<NonNullable<B>> : never;
export type V3Reply<P extends V3Path, M extends V3Method, S extends number = 200> =
  V3Operation<P, M> extends { responses: infer R } ? (S extends keyof R ? JsonOf<R[S]> : never) : never;

/** The Fastify request of a v3 route, typed by its schema. */
export type V3Request<P extends V3Path, M extends V3Method> = FastifyRequest<{
  Params: V3Params<P, M>;
  Querystring: V3Query<P, M>;
  Body: V3Body<P, M>;
}>;

// The main bodies by name.
export type NodeList = V3Reply<'/v3/files/{fileKey}/nodes', 'get'>;
export type NodeOut = V3Reply<'/v3/files/{fileKey}/nodes/{nodeId}', 'get'>;
export type FileOut = V3Reply<'/v3/files/{fileKey}', 'get'>;
export type SyncBody = V3Body<'/v3/files/{fileKey}/sync', 'post'>;
export type SyncReply = V3Reply<'/v3/files/{fileKey}/sync', 'post'>;
export type ClearBody = V3Body<'/v3/files/{fileKey}/clear', 'post'>;
export type ClearReply = V3Reply<'/v3/files/{fileKey}/clear', 'post'>;
export type ClaimBody = V3Body<'/v3/files/{fileKey}/claims', 'post'>;
export type ClaimReply = V3Reply<'/v3/files/{fileKey}/claims', 'post'>;
export type BlockBody = V3Body<'/v3/files/{fileKey}/nodes/{nodeId}/block', 'post'>;
export type BlockReply = V3Reply<'/v3/files/{fileKey}/nodes/{nodeId}/block', 'post'>;
export type SummaryReply = V3Reply<'/v3/files/{fileKey}/summary', 'get'>;
export type WorkReply = V3Reply<'/v3/files/{fileKey}/work', 'get'>;
export type EventList = V3Reply<'/v3/files/{fileKey}/events', 'get'>;
