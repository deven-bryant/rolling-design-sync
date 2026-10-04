/*
 * The data layer contract both stores implement (store/memory.js and
 * store/postgres.js, `@implements {Store}`). `npm run typecheck` fails when
 * either one lacks a method or declares an incompatible one.
 */

/** A stored node row, camelCased (postgres.js `mapNode`). */
export interface StoredNode {
  fileKey: string;
  nodeId: string;
  nodeType: string | null;
  name: string | null;
  parentId: string | null;
  /** ltree path of node-id labels, root first. */
  path: string;
  attrs: Record<string, any>;
  isInstance: boolean;
  mainComponentId: string | null;
  contentHash: string | null;
  captureVersion: number;
  implementedHash: string | null;
  dirty: boolean;
  implementedCommit: string | null;
  implementedAt: string | null;
  claimedBy: string | null;
  claimExpiresAt: string | null;
  deletedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  implementedAttrs: Record<string, any> | null;
  changeType: string | null;
  changedProps: string[];
  changeCategories: string[];
  claimId: string | null;
  blockedAt: string | null;
  blockedBy: string | null;
  blockedReason: string | null;
  orderKey: string | null;
}

/** A node as the v3 reads see it: the row plus its claim label, expansion region and subtree counts. */
export interface V3Node extends StoredNode {
  claimLabel?: string | null;
  expandOrd?: number;
  descendants?: { total: number; dirty: number; blocked: number };
}

export interface NodeCounts { total: number; dirty: number; blocked: number; clean?: number }

export interface FileRow { fileKey: string; name: string | null; lastSyncAt: string | null; createdAt: string | null }
export interface FileWithCounts extends FileRow { counts: NodeCounts }

export interface SyncEvent { id: any; fileKey: string; rootNodeId: string | null; counts: Record<string, any>; createdAt: string | null }

export interface Scope {
  nodeId: string;
  name: string | null;
  nodeType: string | null;
  deleted: boolean;
  lastSyncAt: string | null;
  lastSyncCounts: Record<string, any>;
  counts: NodeCounts;
}

export interface Claim { claimId: string; fileKey: string; worker: string; label: string | null; createdAt: string | null; expiresAt: string | null }
export interface ClaimListing extends Claim { fileName: string | null; nodeCount: number; nodeIds: string[]; nodes: any }
export interface ClaimResult { claim: Claim; nodes: V3Node[] }

export interface StoredEvent { id: number; fileKey: string; type: string; actor: string | null; data: Record<string, any>; createdAt: string }

/** A v3 listing filter (v3/read.js `buildFilter`, `states` expanded); `regions` comes from `expand=instances`. */
export interface V3Filter {
  states: string[];
  under: string | null;
  depth: number | null;
  types: string[];
  changeTypes: string[];
  changedExact: string[];
  changedPrefixes: string[];
  categories: string[];
  components: string[];
  instance: boolean | null;
  names: string[];
  since: string | null;
  claimed: string[];
  worker: string | null;
  now: string;
  /** Ltree paths of the scope (null = the whole file) and each expanded component, in order. */
  regions?: (string | null)[];
}

/** Keyset position of a page: the previous page's last sort key and id. */
export interface PageAfter { k: any; id: string }

export interface ListNodesPage { sort: string; desc: boolean; limit: number; after: PageAfter | null; counts: boolean }
export interface WorkItemsPage { group: string; limit: number; after: PageAfter | null; maxIds: number; progress: boolean }

export interface NodeSummary {
  total: number;
  byState: Record<string, number>;
  byChangeType: Record<string, number>;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  byFrame: { nodeId: string; name: string | null; count: number }[] | null;
}

export interface Store {
  /** Runs `fn` with a store bound to one transaction; all-or-nothing. */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
  close(): Promise<void>;

  // --- node sync
  getNode(fileKey: string, nodeId: string): Promise<StoredNode | null>;
  getNodes(fileKey: string, nodeIds: string[]): Promise<StoredNode[]>;
  upsertNode(fileKey: string, row: Record<string, any>, baseline?: { implementedAt: string } | null): Promise<StoredNode & { baselined: boolean }>;
  nodesPresent(fileKey: string, nodeIds: string[]): Promise<string[]>;
  nodeCaptureVersions(fileKey: string, nodeIds: string[]): Promise<{ nodeId: string; captureVersion: number }[]>;
  tombstoneNodes(fileKey: string, nodeIds: string[], deletedAt: string): Promise<StoredNode[]>;
  listNodeSubtree(fileKey: string, nodeId: string, options?: { dirty?: boolean; includeDeleted?: boolean }): Promise<StoredNode[]>;
  listChildren(fileKey: string, parentIds: string[]): Promise<StoredNode[]>;
  rekeySubtrees(fileKey: string, moves: { nodeId: string; path: string; from: string; to: string }[]): Promise<number>;
  updateNode(fileKey: string, nodeId: string, patch: Record<string, any>): Promise<StoredNode | null>;

  // --- maintenance
  listChangeRepairCandidates(options: { after?: { fileKey: string; nodeId: string } | null; limit: number }): Promise<StoredNode[]>;
  repairChangeColumns(items: Record<string, any>[]): Promise<number>;
  listOrderKeyCandidates(options: { after?: { fileKey: string; depth: number; nodeId: string } | null; limit: number }): Promise<(StoredNode & { depth: number })[]>;
  setOrderKeys(items: { fileKey: string; nodeId: string; orderKey: string }[]): Promise<number>;

  // --- files and syncs
  upsertFile(file: { fileKey: string; name?: string | null; lastSyncAt?: string | null }): Promise<FileRow>;
  recordSync(sync: { fileKey: string; rootNodeId?: string | null; counts?: Record<string, any>; createdAt?: string | null }): Promise<SyncEvent>;
  listFiles(options?: { fileKey?: string | null }): Promise<FileWithCounts[]>;
  listScopes(fileKey: string): Promise<Scope[]>;

  // --- v3 reads
  listNodes(fileKey: string, filter: V3Filter, page: ListNodesPage): Promise<{ nodes: V3Node[]; total: number; next: PageAfter | null }>;
  getNodeV3(fileKey: string, nodeId: string, options?: { counts?: boolean }): Promise<V3Node | null>;
  summarizeNodes(fileKey: string, filter: V3Filter): Promise<NodeSummary>;
  listWorkItems(fileKey: string, filter: V3Filter, page: WorkItemsPage): Promise<{ items: Record<string, any>[]; total: number; next: PageAfter | null }>;
  expansionReach(fileKey: string, options: { scope: string | null; maxDepth: number }): Promise<{ mainComponentId: string; depth: number; path: string | null }[]>;
  expansionEdges(fileKey: string, options: { regions: { key: any; path: string | null; depth: number }[]; mains: { mainComponentId: string; depth: number }[] }):
    Promise<{ region: any; instanceId: string; instancePath: string; instanceKey: string; mainComponentId: string }[]>;

  // --- clear, claims, blocks
  clearNodes(fileKey: string, items: { nodeId: string; contentHash: string }[], patch: Record<string, any>): Promise<{ nodeId: string; contentHash: string }[]>;
  getClaim(fileKey: string, claimId: string): Promise<Claim | null>;
  listClaims(options: { fileKey?: string | null; nowIso: string }): Promise<ClaimListing[]>;
  createClaim(claim: { fileKey: string; worker: string; label?: string | null; expiresAt: string; nowIso: string; nodeIds: string[] }): Promise<ClaimResult>;
  renewClaim(fileKey: string, claimId: string, options: { expiresAt: string; nowIso: string }): Promise<ClaimResult | null>;
  releaseClaim(fileKey: string, claimId: string, options: { nowIso: string }): Promise<ClaimResult | null>;
  blockNode(fileKey: string, nodeId: string, block: { reason: string | null; by: string | null; at: string }):
    Promise<{ node: V3Node; released: { claimId: string; worker: string } | null } | null>;
  unblockNode(fileKey: string, nodeId: string): Promise<{ node: V3Node; prior: { at: string | null; by: string | null; reason: string | null } } | null>;

  // --- events
  insertEvent(event: { fileKey: string; type: string; actor?: string | null; data?: Record<string, any>; createdAt?: string | null }): Promise<StoredEvent>;
  latestEvent(type: string): Promise<StoredEvent | null>;
  listEvents(options?: {
    fileKey?: string | null; after?: number; before?: number | null; order?: 'asc' | 'desc'; types?: string[]; nodeId?: string | null; since?: string | null; limit?: number;
  }): Promise<(StoredEvent & { fileName: string | null })[]>;
  getEvent(fileKey: string | null, id: number): Promise<StoredEvent | null>;
  lastEventId(fileKey: string): Promise<number>;
  latestEventIds(fileKeys: string[]): Promise<{ fileKey: string; id: number }[]>;
  pruneEvents(before: string): Promise<number>;
}
