import type { ApiResponse } from '../../api/client';
import type { Category } from './categories';

export type NodePage = ApiResponse<'/v3/files/{fileKey}/nodes'>;
/** One node as a listing returns it. */
export type NodeItem = NonNullable<NodePage['nodes']>[number];
/** One node in full (`GET …/nodes/:nodeId`). */
export type NodeDetail = ApiResponse<'/v3/files/{fileKey}/nodes/{nodeId}'>;
export type FileClaims = ApiResponse<'/v3/files/{fileKey}/claims'>;
export type FileClaim = NonNullable<FileClaims['claims']>[number];
export type EventsPage = ApiResponse<'/v3/files/{fileKey}/events'>;
export type FileEvent = NonNullable<EventsPage['events']>[number];
export type FileInfo = ApiResponse<'/v3/files/{fileKey}'>;
export type ScopeList = ApiResponse<'/v3/files/{fileKey}/scopes'>;
export type Scope = NonNullable<ScopeList['scopes']>[number];

/** The fields a listed node and a node in full share. */
export type NodeLike = NodeItem | NodeDetail;
export type NodeClaim = NonNullable<NodeItem['claim']>;

export type StateFilter = 'all' | 'dirty' | 'clean' | 'blocked';
export type ChangeFilter = 'added' | 'modified' | 'deleted';

/**
 * The Node tree's filters, one-to-one with listing parameters. Kept by the route (in the URL);
 * `NodeTable` reads them and reports changes.
 */
export interface NodeFilters {
  /** The search box: plain text matches names, a node id lists that node, `key:value` pairs pass through as `q`. */
  q?: string;
  /** Default `all`. */
  state?: StateFilter;
  changeType?: ChangeFilter;
  category?: Category;
  /** A Figma node type, e.g. `INSTANCE`. */
  type?: string;
  /** *Expand instances*: expanding an instance shows its main component. */
  expandInstances?: boolean;
}

export type SessionRole = 'agent' | 'viewer';
