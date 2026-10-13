'use strict';

/*
 * v3 node notes (docs/api-v3-design.md, "Node notes"): a person or agent notes
 * that a built node does not match the design. An open note keeps the node
 * dirty (`changeType: requested` when the design is otherwise built) until the
 * node is cleared (which resolves its notes) or the note is dismissed or
 * deleted. Viewers may add notes and edit, delete or dismiss their own.
 */
const { writeActor, AGENT } = require('../auth');
const { withEvents } = require('../events/outbox');
const { refreshNoteState } = require('../nodeService');
const address = require('./address');
const schemas = require('./schemas');
const { problem } = require('./problem');
const { nodeFields, pick, withLibraryRefs, withNotes } = require('./read');
const { rejectUnknownKeys } = require('./actions');

const MAX_NOTE_LENGTH = 4000;
const MAX_DISMISS_REASON_LENGTH = 500;
const NOTE_STATUSES = ['open', 'all'];

// --- schemas -------------------------------------------------------------------
const { security, tags } = schemas.listNodes;
const { agentOp } = schemas;
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const problemResponse = schemas.getFile.response[404];
const problemResponses = statuses => Object.fromEntries(statuses.map(s => [s, { ...problemResponse }]));
const ERRORS = [400, 401, 403, 404];
const nodeParams = schemas.getNode.params;
const fileKeyParam = schemas.getFile.params.properties.fileKey;
const noteParams = {
  type: 'object',
  required: ['fileKey', 'noteId'],
  properties: { fileKey: fileKeyParam, noteId: { type: 'string', description: 'The note id (`noteId` from `add_note` / `list_notes`).' } },
};
const urlQuery = { type: 'object', properties: { url: schemas.getFile.querystring.properties.url } };
const compactNode = schemas.listNodes.response[200].properties.nodes.items;
const noteBody = { type: 'string', minLength: 1, maxLength: MAX_NOTE_LENGTH, description: `What does not match the design, as a person would say it (1–${MAX_NOTE_LENGTH} chars).` };

const note = {
  type: 'object',
  properties: {
    noteId: { type: 'string' },
    nodeId: { type: 'string' },
    body: { type: 'string' },
    author: { type: 'string', description: 'Who wrote it: the token label, or `portal:<label>` from a portal session.' },
    worker: nullable('string', { description: 'The worker id passed when it was added, if any.' }),
    status: { type: 'string', enum: ['open', 'resolved', 'dismissed'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    resolvedAt: nullable('string', { description: 'When it was resolved (by a clear) or dismissed.' }),
    resolvedBy: nullable('string'),
    commitRef: nullable('string', { description: 'The `commitRef` of the clear that resolved it.' }),
  },
};
const noteReply = {
  type: 'object',
  properties: { fileKey: { type: 'string' }, note, node: compactNode },
};

const addNote = {
  summary: 'Add a note to a node',
  description: [
    'Records that the built node does not match the design, with what is wrong. An open note makes the node dirty — `changeType: requested` (category `note`) when its design is otherwise built, or its design change plus category `note` — and keeps it dirty across re-syncs.',
    'The node is listed with its open `notes` until it is cleared (`clear_nodes` resolves its notes) or the note is dismissed. Viewer tokens and sessions may add notes too. Returns the note and the node\'s new state; a tombstoned node cannot take notes.',
  ].join(' '),
  tags, security,
  ...agentOp('add_note', 'notes add'),
  params: nodeParams,
  querystring: urlQuery,
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: noteBody,
      worker: { type: 'string', minLength: 1, maxLength: 200, description: 'Your worker id, recorded on the note.' },
    },
  },
  response: { 200: noteReply, ...problemResponses(ERRORS) },
};

const listNotes = {
  summary: 'List a node\'s notes',
  description: 'The notes on a node, newest first: its open ones (default), or `status=all` for resolved and dismissed ones too.',
  tags, security,
  ...agentOp('list_notes', 'notes list'),
  params: nodeParams,
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: NOTE_STATUSES, description: 'open (default) or all.' },
      url: schemas.getFile.querystring.properties.url,
    },
  },
  response: {
    200: { type: 'object', properties: { fileKey: { type: 'string' }, nodeId: { type: 'string' }, notes: { type: 'array', items: note } } },
    ...problemResponses(ERRORS),
  },
};

const editNote = {
  summary: 'Edit a note',
  description: 'Replaces the body of an open note. Only its author may edit it.',
  tags, security,
  params: noteParams,
  body: { type: 'object', required: ['body'], properties: { body: noteBody } },
  response: { 200: noteReply, ...problemResponses(ERRORS) },
};

const deleteNote = {
  summary: 'Delete a note',
  description: 'Deletes an open note (only its author may); the node\'s state is recomputed without it.',
  tags, security,
  params: noteParams,
  response: {
    200: { type: 'object', properties: { fileKey: { type: 'string' }, noteId: { type: 'string' }, deleted: { type: 'boolean' }, node: compactNode } },
    ...problemResponses(ERRORS),
  },
};

const dismissNote = {
  summary: 'Dismiss a note',
  description: 'Closes an open note without changing the build (e.g. it is wrong or already handled); the node\'s state is recomputed without it. Its author or any agent may dismiss it. To resolve a note by fixing the code, clear the node instead.',
  tags, security,
  ...agentOp('dismiss_note', 'notes dismiss'),
  params: noteParams,
  body: nullable('object', {
    properties: { reason: { type: 'string', minLength: 1, maxLength: MAX_DISMISS_REASON_LENGTH, description: 'Why it was dismissed.' } },
    description: 'Optional; `{}` or null dismisses without a reason.',
  }),
  response: { 200: noteReply, ...problemResponses(ERRORS) },
};

// --- routes ----------------------------------------------------------------------
/**
 * @param {any} app
 * @param {{ store: import('../store/types').Store } & Record<string, any>} deps
 */
function registerNoteRoutes(app, { store, now, bus = null, libraryLinks = null }) {
  const viewerWrite = { viewerWrite: true };

  async function file(request) {
    const { fileKey, nodeId: urlNodeId } = address.resolveFile(request.params.fileKey, request.query && request.query.url);
    const [found] = await store.listFiles({ fileKey });
    if (!found) throw address.fileNotFound(fileKey);
    return { fileKey, urlNodeId };
  }

  /** The stored node for a caller's `1:2` / `1-2`, read inside `tx`. */
  async function storedNode(tx, fileKey, raw) {
    const ids = address.nodeIdCandidates(raw);
    const rows = await tx.getNodes(fileKey, ids);
    const found = ids.map(id => rows.find(n => n.nodeId === id)).find(Boolean);
    if (!found) throw address.nodeNotFound(fileKey, raw);
    return found;
  }

  async function nodeOut(fileKey, nodeId, at) {
    const node = await store.getNodeV3(fileKey, nodeId);
    if (!node) return null;
    await withLibraryRefs(store, libraryLinks, fileKey, [node]);
    await withNotes(store, fileKey, [node]);
    return pick(nodeFields(fileKey, node, at), schemas.COMPACT_FIELDS);
  }

  const notFound = (fileKey, noteId) => problem('note_not_found', `No note ${noteId} in file ${fileKey}.`, {
    hint: 'Use a noteId from add_note or list_notes (status=all for closed notes).',
  });
  const notOpen = found => problem('invalid_parameter', `noteId: note ${found.noteId} is ${found.status}.`, {
    hint: 'Only open notes can be edited, deleted or dismissed. Add a new note instead.',
  });

  /** The open note `noteId`, read inside `tx`; checks `allowed(note)` (403 forbidden otherwise). */
  async function openNote(tx, fileKey, noteId, allowed, action) {
    const found = await tx.getNote(fileKey, noteId);
    if (!found) throw notFound(fileKey, noteId);
    if (!allowed(found)) {
      throw problem('forbidden', `Only the note's author can ${action} it.`, {
        hint: action === 'dismiss' ? 'Ask the author or an agent to dismiss it.' : `Ask the author (${found.author}) to ${action} it, or add a new note.`,
      });
    }
    if (found.status !== 'open') throw notOpen(found);
    return found;
  }

  const authorOf = request => writeActor(request);
  const isAgent = request => !!request.auth && request.auth.role === AGENT;

  app.get('/files/:fileKey/nodes/:nodeId/notes', { schema: listNotes }, async (/** @type {any} */ request) => {
    const { fileKey, urlNodeId } = await file(request);
    const raw = address.resolveNodeParam(request.params.nodeId, urlNodeId);
    const node = await storedNode(store, fileKey, raw);
    const notes = await store.listNotes(fileKey, [node.nodeId], { status: request.query.status === 'all' ? 'all' : 'open' });
    return { fileKey, nodeId: node.nodeId, notes };
  });

  app.post('/files/:fileKey/nodes/:nodeId/notes', { schema: addNote, config: viewerWrite }, async (/** @type {any} */ request) => {
    rejectUnknownKeys('body', request.body, addNote.body);
    const { fileKey, urlNodeId } = await file(request);
    const raw = address.resolveNodeParam(request.params.nodeId, urlNodeId);
    const author = authorOf(request);
    const worker = typeof request.body.worker === 'string' ? request.body.worker.trim() || null : null;
    if (!request.body.body.trim()) throw problem('invalid_body', 'body must not be blank.', { hint: 'Describe what does not match the design.' });
    const at = now().toISOString();
    const added = await withEvents(store, bus, async (tx, emit) => {
      const node = await storedNode(tx, fileKey, raw);
      if (node.deletedAt) {
        throw problem('invalid_parameter', `nodeId: node ${node.nodeId} was deleted from the design.`, {
          hint: 'Notes go on live nodes. Clear the deleted node once its code is removed.',
        });
      }
      const created = await tx.insertNote({ fileKey, nodeId: node.nodeId, body: request.body.body, author, worker, at });
      const after = await refreshNoteState(tx, fileKey, node.nodeId);
      const dirtied = !node.dirty && !!(after && after.dirty);
      await emit(fileKey, 'note.added', { actor: author, data: { nodeId: node.nodeId, noteId: created.noteId, author, dirtied } });
      return created;
    });
    return { fileKey, note: added, node: await nodeOut(fileKey, added.nodeId, at) };
  });

  app.patch('/files/:fileKey/notes/:noteId', { schema: editNote, config: viewerWrite }, async (/** @type {any} */ request) => {
    rejectUnknownKeys('body', request.body, editNote.body);
    const { fileKey } = await file(request);
    const { noteId } = request.params;
    if (!request.body.body.trim()) throw problem('invalid_body', 'body must not be blank.', { hint: 'Describe what does not match the design, or delete the note.' });
    const author = authorOf(request);
    const at = now().toISOString();
    const edited = await withEvents(store, bus, async tx => {
      await openNote(tx, fileKey, noteId, n => n.author === author, 'edit');
      return tx.editNote(fileKey, noteId, { body: request.body.body, at });
    });
    if (!edited) throw notFound(fileKey, noteId);
    return { fileKey, note: edited, node: await nodeOut(fileKey, edited.nodeId, at) };
  });

  app.delete('/files/:fileKey/notes/:noteId', { schema: deleteNote, config: viewerWrite }, async (/** @type {any} */ request) => {
    const { fileKey } = await file(request);
    const { noteId } = request.params;
    const author = authorOf(request);
    const at = now().toISOString();
    const deleted = await withEvents(store, bus, async tx => {
      await openNote(tx, fileKey, noteId, n => n.author === author, 'delete');
      const done = await tx.deleteNote(fileKey, noteId);
      if (done) await refreshNoteState(tx, fileKey, done.nodeId);
      return done;
    });
    if (!deleted) throw notFound(fileKey, noteId);
    return { fileKey, noteId, deleted: true, node: await nodeOut(fileKey, deleted.nodeId, at) };
  });

  app.post('/files/:fileKey/notes/:noteId/dismiss', { schema: dismissNote, config: viewerWrite }, async (/** @type {any} */ request) => {
    rejectUnknownKeys('body', request.body, dismissNote.body);
    const { fileKey } = await file(request);
    const { noteId } = request.params;
    const by = authorOf(request);
    const reason = request.body && typeof request.body.reason === 'string' ? request.body.reason.trim() || null : null;
    const at = now().toISOString();
    const dismissed = await withEvents(store, bus, async (tx, emit) => {
      await openNote(tx, fileKey, noteId, n => n.author === by || isAgent(request), 'dismiss');
      const done = await tx.closeNote(fileKey, noteId, { status: 'dismissed', by, at });
      if (!done) return null;
      await refreshNoteState(tx, fileKey, done.nodeId);
      await emit(fileKey, 'note.dismissed', { actor: by, data: { nodeId: done.nodeId, noteId, author: done.author, ...(reason ? { reason } : {}) } });
      return done;
    });
    if (!dismissed) throw notFound(fileKey, noteId);
    return { fileKey, note: dismissed, node: await nodeOut(fileKey, dismissed.nodeId, at) };
  });
}

module.exports = { registerNoteRoutes, MAX_NOTE_LENGTH, MAX_DISMISS_REASON_LENGTH };
