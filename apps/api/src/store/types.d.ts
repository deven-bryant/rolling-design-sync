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
  /** A library node: a remote main component / component set, or inside one. */
  library: boolean;
  /** Set by v3/read.js `withLibraryRefs` on library rows: their component key and library-file location. */
  libraryRef?: { key: string | null; type: string | null; resolved: boolean; fileKey: string | null; nodeId: string | null };
}

/** The columns of a live node that check-target state needs (`listFileNodesForTargets`). */
export type TargetNode = Pick<StoredNode, 'nodeId' | 'path' | 'parentId' | 'contentHash' | 'isInstance' | 'mainComponentId' | 'dirty' | 'changeType' | 'changeCategories'>;

/** A node as the v3 reads see it: the row plus its claim label, expansion region and subtree counts. */
export interface V3Node extends StoredNode {
  claimLabel?: string | null;
  expandOrd?: number;
  descendants?: { total: number; dirty: number; blocked: number };
}

export interface NodeCounts { total: number; dirty: number; blocked: number; clean?: number }

export interface FileRow { fileKey: string; name: string | null; lastSyncAt: string | null; createdAt: string | null; settings: Record<string, any> }
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

export interface NodeNote {
  noteId: string; fileKey: string; nodeId: string; body: string; author: string; worker: string | null; source: 'user' | 'render_check';
  status: 'open' | 'resolved' | 'dismissed'; createdAt: string; updatedAt: string;
  resolvedAt: string | null; resolvedBy: string | null; commitRef: string | null;
}

export interface Attachment {
  attachmentId: string; fileKey: string; ownerKind: 'note' | 'screen' | 'check'; ownerId: string;
  kind: 'screenshot' | 'reference' | 'built' | 'heatmap' | 'node_map'; contentType: string; size: number; width: number; height: number;
  sha256: string; blobKey: string; thumbKey: string | null; createdBy: string; createdAt: string;
}

export interface ScreenMask { x: number; y: number; width: number; height: number }

/** A check target (`screen` row): a manual screen (set_screen) or an auto-detected screen / component target. */
export interface Screen {
  fileKey: string; nodeId: string; route: string | null; viewport: { width: number; height: number }; theme: string | null; query: string | null;
  masks: ScreenMask[]; threshold: number; referenceId: string | null; referenceVersion: string | null;
  level: 'screen' | 'component'; source: 'manual' | 'auto'; familyKey: string | null; gallery: Record<string, any> | null;
  maskNodeIds: string[]; nodeMapId: string | null; excluded: boolean;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}

/** A scope's check switch (`scope_setting`); scopes without a row are checked. */
export interface ScopeChecks { fileKey: string; nodeId: string; checks: boolean; updatedBy: string; updatedAt: string }

export interface TargetFamily { fileKey: string; familyKey: string; route: string; updatedBy: string; updatedAt: string }

export interface RenderRegion { x: number; y: number; width: number; height: number; pixels: number }

export interface RenderCheck {
  checkId: string; fileKey: string; nodeId: string; status: 'requested' | 'passed' | 'mismatch' | 'error'; designVersion: string;
  requestedBy: string; requestedAt: string; submittedBy: string | null; submittedAt: string | null; commitRef: string | null; source: string | null;
  score: number | null; threshold: number | null; regions: RenderRegion[]; builtId: string | null; heatmapId: string | null;
  referenceId: string | null; error: string | null;
  /** The nodes a mismatch was attributed to (v3/targets.js `attribute`). */
  attribution: Record<string, any>[];
}

export interface StoredEvent { id: number; fileKey: string; type: string; actor: string | null; data: Record<string, any>; createdAt: string }

/** A v3 listing filter (v3/read.js `buildFilter`, `states` expanded); `regions` comes from `expand=instances`. */
export interface V3Filter {
  states: string[];
  /** Subtree roots (stored node ids, in order): their union; null = the whole file. */
  under: string[] | null;
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
  /** Library nodes: `include` them, `exclude` them or list `only` them; null = the file's default (v3/read.js `applyLibraryDefault`). */
  library: 'include' | 'exclude' | 'only' | null;
  /** Only nodes with (true) or without (false) open notes; null/absent = either. */
  hasNotes?: boolean | null;
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

/** A cached resolution of a library component key (library.js). */
export interface LibraryComponent { componentKey: string; fileKey: string | null; nodeId: string | null; name: string | null; resolvedAt: string | null; error: string | null }

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
  /** Every live node of the file that has a path, with only the columns check-target state needs — one query. */
  listFileNodesForTargets(fileKey: string): Promise<TargetNode[]>;
  rekeySubtrees(fileKey: string, moves: { nodeId: string; path: string; from: string; to: string }[]): Promise<number>;
  updateNode(fileKey: string, nodeId: string, patch: Record<string, any>): Promise<StoredNode | null>;
  markLibrarySubtrees(fileKey: string, rootIds: string[]): Promise<string[]>;

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
  updateFileSettings(fileKey: string, settings: Record<string, any>): Promise<FileRow | null>;

  // --- library components
  getLibraryComponents(keys: string[]): Promise<LibraryComponent[]>;
  upsertLibraryComponent(row: { componentKey: string; fileKey?: string | null; nodeId?: string | null; name?: string | null; resolvedAt: string; error?: string | null }): Promise<LibraryComponent>;
  /** Per variable id: the live nodes whose `attrs.resolvedVariables` has it (design-token usage). */
  tokenUsage(fileKey: string, variableKeys: string[]): Promise<{ variableKey: string; layers: number }[]>;
  placementCounts(fileKey: string, mainIds: string[], regions?: (string | null)[] | null): Promise<{ mainComponentId: string; placements: number; placementsInScope: number | null }[]>;

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

  // --- notes (newest first; edit / close / delete touch open notes only and return null otherwise)
  insertNote(note: { fileKey: string; nodeId: string; body: string; author: string; worker?: string | null; source?: 'user' | 'render_check'; at: string }): Promise<NodeNote>;
  getNote(fileKey: string, noteId: string): Promise<NodeNote | null>;
  listNotes(fileKey: string, nodeIds: string[], options?: { status?: 'open' | 'all' }): Promise<NodeNote[]>;
  /** Open and resolved note counts of the nodes that have any (dismissed notes are not counted). */
  noteCounts(fileKey: string, nodeIds: string[]): Promise<{ nodeId: string; open: number; resolved: number; openRender: number }[]>;
  editNote(fileKey: string, noteId: string, edit: { body: string; at: string }): Promise<NodeNote | null>;
  closeNote(fileKey: string, noteId: string, close: { status: 'resolved' | 'dismissed'; by: string; at: string; commitRef?: string | null }): Promise<NodeNote | null>;
  deleteNote(fileKey: string, noteId: string): Promise<NodeNote | null>;
  /** Resolves the open notes of `nodeIds`; returns them, oldest first. */
  resolveNotes(fileKey: string, nodeIds: string[], resolve: { by: string; at: string; commitRef?: string | null }): Promise<NodeNote[]>;

  // --- attachments (oldest first), screens (by node id), render checks (newest first)
  insertAttachment(attachment: Omit<Attachment, 'attachmentId' | 'thumbKey'> & { attachmentId?: string; thumbKey?: string | null }): Promise<Attachment>;
  getAttachment(fileKey: string, attachmentId: string): Promise<Attachment | null>;
  listAttachments(fileKey: string, ownerKind: Attachment['ownerKind'], ownerIds: string[]): Promise<Attachment[]>;
  /** Deletes the rows; returns them so the caller can delete their blobs. */
  deleteAttachments(fileKey: string, attachmentIds: string[]): Promise<Attachment[]>;
  upsertScreen(screen: { fileKey: string; nodeId: string; route: string | null; viewport: { width: number; height: number }; theme?: string | null;
    query?: string | null; masks?: ScreenMask[]; threshold: number; level?: Screen['level']; source?: Screen['source']; familyKey?: string | null;
    gallery?: Record<string, any> | null; maskNodeIds?: string[]; by: string; at: string }): Promise<Screen>;
  getScreen(fileKey: string, nodeId: string): Promise<Screen | null>;
  listScreens(fileKey: string): Promise<Screen[]>;
  deleteScreen(fileKey: string, nodeId: string): Promise<Screen | null>;
  setScreenReference(fileKey: string, nodeId: string, ref: { referenceId: string; referenceVersion: string; nodeMapId?: string | null; at: string }): Promise<Screen | null>;
  setScopeChecks(fileKey: string, nodeId: string, setting: { checks: boolean; by: string; at: string }): Promise<ScopeChecks>;
  listScopeChecks(fileKey: string): Promise<ScopeChecks[]>;
  /** Sets a target's `excluded` flag (re-detection never resets it); null when it is not a target. */
  setTargetExcluded(fileKey: string, nodeId: string, flag: { excluded: boolean; by: string; at: string }): Promise<Screen | null>;
  setFamilyRoute(fileKey: string, familyKey: string, family: { route: string; by: string; at: string }): Promise<TargetFamily>;
  listFamilies(fileKey: string): Promise<TargetFamily[]>;
  insertCheck(check: { fileKey: string; nodeId: string; designVersion: string; requestedBy: string; at: string }): Promise<RenderCheck>;
  getCheck(fileKey: string, checkId: string): Promise<RenderCheck | null>;
  listChecks(fileKey: string, options?: { status?: RenderCheck['status'] | null; nodeId?: string | null; limit?: number }): Promise<RenderCheck[]>;
  /** The newest check of each of `nodeIds` that has any. */
  latestChecks(fileKey: string, nodeIds: string[]): Promise<RenderCheck[]>;
  /** Records the result of a requested check; null when it isn't requested (anymore). */
  finishCheck(fileKey: string, checkId: string, result: Pick<RenderCheck, 'status' | 'designVersion' | 'submittedBy' | 'submittedAt'>
    & Partial<Pick<RenderCheck, 'commitRef' | 'source' | 'score' | 'threshold' | 'regions' | 'builtId' | 'heatmapId' | 'referenceId' | 'error' | 'attribution'>>): Promise<RenderCheck | null>;
  /** Deletes the screen's checks but the newest `keep`; returns the deleted ones. */
  deleteChecks(fileKey: string, nodeId: string, options?: { keep?: number; except?: string[] }): Promise<RenderCheck[]>;

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
  /**
   * Per tracked file (by fileKey), nodes cleared (`nodes.cleared` `data.count`, else `nodeIds.length`) in
   * `[since, until)` and in `[from, since)`, and nodes newly dirtied (`sync.completed` `counts.dirty`) in `[since, until)`.
   */
  eventTrends(options: { fileKey?: string | null; from: string; since: string; until: string }):
    Promise<{ fileKey: string; fileName: string | null; cleared: number; clearedPrevious: number; dirtied: number }[]>;
}
