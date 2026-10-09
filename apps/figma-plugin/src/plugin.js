/* Figma runtime adapter. Bundled after core.js by build.js. */
const DesignChecklist = (() => {
  const C = ChecklistCore;
  const SETTINGS_KEY = 'fds_upload_settings_v1';
  const BATCH_CHARS = 2000000; // JSON chars per …/sync request, well under the API's 64 MB body limit.
  const EXISTS_IDS = 1000; // node ids per …/exists request (API cap is 5000).
  // build.js defines PLUGIN_VERSION from package.json when it bundles code.js.
  const VERSION = typeof PLUGIN_VERSION === 'string' ? PLUGIN_VERSION : 'dev';
  const CLIENT = 'plugin/' + VERSION;
  const filePath = (fileKey, route) => '/v3/files/' + encodeURIComponent(fileKey) + '/' + route;
  const PROPS = (`name type visible opacity blendMode isMask maskType clipsContent
    width height rotation relativeTransform minWidth maxWidth minHeight maxHeight
    layoutMode layoutWrap primaryAxisSizingMode counterAxisSizingMode
    primaryAxisAlignItems counterAxisAlignItems counterAxisAlignContent
    paddingLeft paddingRight paddingTop paddingBottom itemSpacing counterAxisSpacing
    itemReverseZIndex strokesIncludedInLayout layoutAlign layoutGrow layoutPositioning
    layoutSizingHorizontal layoutSizingVertical constraints
    fills strokes strokeWeight strokeAlign strokeCap strokeJoin dashPattern
    strokeTopWeight strokeBottomWeight strokeLeftWeight strokeRightWeight strokeMiterLimit
    cornerRadius topLeftRadius topRightRadius bottomLeftRadius bottomRightRadius cornerSmoothing
    effects fillStyleId strokeStyleId effectStyleId gridStyleId layoutGrids
    characters fontName fontSize fontWeight textCase textDecoration letterSpacing lineHeight
    textAlignHorizontal textAlignVertical textAutoResize paragraphIndent paragraphSpacing
    listSpacing hangingPunctuation hangingList textTruncation maxLines textStyleId
    openTypeFeatures leadingTrim hyperlink textWrapStyle textDecorationStyle textDecorationOffset
    textDecorationThickness textDecorationColor textDecorationSkipInk
    vectorPaths vectorNetwork booleanOperation arcData pointCount innerRadius
    componentPropertyReferences
    boundVariables explicitVariableModes resolvedVariableModes reactions overflowDirection
    numberOfFixedChildren overlayPositionType overlayBackground overlayBackgroundInteraction
    gridRowCount gridColumnCount gridRowGap gridColumnGap gridRowSizes gridColumnSizes
    gridRowSpan gridColumnSpan gridRowAnchorIndex gridColumnAnchorIndex
    gridChildHorizontalAlign gridChildVerticalAlign`).split(/\s+/).filter(Boolean);
  const TEXT_FIELDS = ['fontName','fontSize','fontWeight','textDecoration','textCase','lineHeight','letterSpacing','fills','textStyleId','fillStyleId','listOptions','indentation','hyperlink','boundVariables','openTypeFeatures','paragraphIndent','paragraphSpacing','listSpacing','textWrapStyle','textDecorationStyle','textDecorationOffset','textDecorationThickness','textDecorationColor','textDecorationSkipInk'];
  const COVERAGE = 'Snapshot comparison of the selected section/frame and all descendants, including hidden instance layers; tracked layout, text runs, appearance, vectors, component references, prototype reactions, and available bound-variable values in current modes. Numeric precision: 0.0001. Root canvas position is ignored. This is a scoped property report, not a guarantee of complete Figma feature or visual coverage.';
  const METADATA_WARNING = '[component metadata] ';
  const MAIN_WARNING = '[main component] ';
  // A style or variable definition Figma won't return (e.g. a library style that
  // isn't published): the node's own values are still captured, only the token
  // name is unknown, so the snapshot is complete enough to upload.
  const TOKEN_WARNING = '[token] ';
  const blockingWarnings = warnings => warnings.filter(w => !w.startsWith(METADATA_WARNING) && !w.startsWith(MAIN_WARNING) && !w.startsWith(TOKEN_WARNING));
  function componentSet(node) {
    try { return node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent : null; }
    catch (_) { return null; }
  }
  function componentReference(node) {
    const reference = { id: node.id, key: node.key, name: node.name, remote: node.remote };
    try {
      const set = componentSet(node);
      if (set) reference.set = { id: set.id, key: set.key, name: set.name };
    } catch (_) { /* Library set metadata may not be accessible. */ }
    return reference;
  }
  function readComponentMetadata(node, props, warnings) {
    function read(owner, field) {
      try {
        if (field in owner) props[field] = C.normalize(owner[field]);
      } catch (error) {
        // Missing metadata is not an empty definition/value map. Preserve the gap explicitly.
        props[field] = { $unreadable: true, ownerId: owner.id };
        const reason = String(error && error.message || error).slice(0,500);
        warnings.add(METADATA_WARNING + `${node.id}: could not read ${field} from ${owner.id}: ${reason}. Review this metadata manually.`);
      }
    }
    if (node.type === 'INSTANCE') {
      // Figma deprecates variantProperties on instances. Never invoke that getter.
      read(node, 'componentProperties');
      const values = props.componentProperties;
      if (values && values.$unreadable) {
        props.variantProperties = { $unreadable: true, source: 'componentProperties' };
      } else if (values && typeof values === 'object') {
        const variants = {};
        for (const name of Object.keys(values)) {
          const property = values[name];
          if (property && property.type === 'VARIANT') variants[name] = property.value;
        }
        props.variantProperties = Object.keys(variants).length ? variants : null;
      }
    }
    if (node.type === 'COMPONENT') read(node, 'variantProperties');
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      // Variant definitions belong to the component set, not each variant component.
      const owner = componentSet(node) || node;
      if (owner !== node) props.componentDefinitionOwnerId = owner.id;
      read(owner, 'componentPropertyDefinitions');
    }
  }
  function readFields(node, fields, warnings) {
    const p = {};
    for (const k of fields) {
      try { if (k in node) p[k] = C.normalize(node[k]); }
      catch (_) { p[k] = { $unreadable: true }; warnings.add(`${node.id || 'style'}: could not read ${k}.`); }
    }
    return p;
  }
  function aliases(value, out) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'VARIABLE_ALIAS' && typeof value.id === 'string') out.add(value.id);
    if (Array.isArray(value)) value.forEach(v => aliases(v, out));
    else Object.keys(value).forEach(k => aliases(value[k], out));
  }
  /* Ids of the scope root's ancestors (root first) up to, not including, the page. */
  function ancestorsOf(root) {
    const out = [];
    for (let p = root.parent; p && !['PAGE','DOCUMENT'].includes(p.type); p = p.parent) {
      if (p.type === 'INSTANCE') throw new Error('The selected scope is inside a component instance. Instance internals are not tracked; select the main component or a scope outside it.');
      out.unshift(p.id);
    }
    return out;
  }
  /* `mains` collects every instance's resolved main component (id -> {id,key,name,remote});
     `options.onMain(mainNode)` receives the traversable main node itself, once per unique main. */
  async function capture(api, root, key, options = {}) {
    const nodes = {}, mains = {}, pending = [], warnings = new Set(), styleCache = new Map(), variableCache = new Map();
    const ancestors = ancestorsOf(root);
    let count = 0;
    api.skipInvisibleInstanceChildren = false;
    async function visit(node, path, context) {
      count++;
      if (options.cancelled && options.cancelled()) throw new Error('Scan cancelled. Nothing was uploaded.');
      if (node.removed) throw new Error('Design changed during scanning. Try again when editing is paused.');
      const nextPath = path ? path + ' / ' + node.name : node.name;
      if (['SECTION','FRAME','COMPONENT','COMPONENT_SET','INSTANCE'].includes(node.type)) context = { id: node.id, name: node.name, type: node.type };
      const props = readFields(node, PROPS, warnings);
      readComponentMetadata(node, props, warnings);
      props.parentId = node === root ? null : node.parent && node.parent.id;
      const children = 'children' in node ? Array.from(node.children) : [];
      // An instance's children belong to its main; its own record covers placement + overrides only.
      if ('children' in node && node.type !== 'INSTANCE') props.childOrder = children.map(n => n.id);
      // Canvas movement of the entire scope has no implementation significance.
      if (node === root) delete props.relativeTransform;
      if (node.type === 'TEXT') {
        try { props.textSegments = C.normalize(node.getStyledTextSegments(TEXT_FIELDS)); }
        catch (_) { warnings.add(`${node.id}: rich text segments unavailable; mixed formatting may be incomplete.`); }
      }
      const styles = {};
      const styleIds = new Set();
      for (const k of ['fillStyleId','strokeStyleId','effectStyleId','gridStyleId','textStyleId']) if (typeof props[k] === 'string' && props[k]) styleIds.add(props[k]);
      for (const s of props.textSegments || []) for (const k of ['fillStyleId','textStyleId']) if (typeof s[k] === 'string' && s[k]) styleIds.add(s[k]);
      for (const id of Array.from(styleIds).sort()) {
        if (!styleCache.has(id)) {
          try {
            const s = await api.getStyleByIdAsync(id);
            styleCache.set(id, s ? readFields(s, ['name','type','key','paints','effects','layoutGrids','fontName','fontSize','textCase','textDecoration','letterSpacing','lineHeight','paragraphIndent','paragraphSpacing','boundVariables'], warnings) : null);
          } catch (_) { styleCache.set(id, null); }
        }
        styles[id] = styleCache.get(id);
        if (!styles[id]) warnings.add(`${TOKEN_WARNING}${node.id}: style ${id} could not be resolved; its values are captured without the style name.`);
      }
      if (styleIds.size) props.styleDefinitions = styles;
      const ids = new Set(); aliases(props, ids);
      if (ids.size) props.resolvedVariables = {};
      for (const id of Array.from(ids).sort()) {
        try {
          if (!variableCache.has(id)) variableCache.set(id, await api.variables.getVariableByIdAsync(id));
          const v = variableCache.get(id);
          if (!v) throw new Error('missing');
          props.resolvedVariables[id] = { name: v.name, key: v.key, collectionId: v.variableCollectionId,
            codeSyntax: C.normalize(v.codeSyntax), resolved: C.normalize(v.resolveForConsumer(node)) };
        } catch (_) { props.resolvedVariables[id] = null; warnings.add(`${TOKEN_WARNING}${node.id}: variable ${id} could not be resolved; its values are captured without the variable name.`); }
      }
      let component = null;
      if (node.type === 'INSTANCE') {
        try {
          const main = await node.getMainComponentAsync();
          if (main) {
            component = componentReference(main);
            if (!mains[main.id]) { mains[main.id] = { ...component, type: main.type }; if (options.onMain) options.onMain(main); }
          } else warnings.add(`${node.id}: main component unavailable.`);
        } catch (_) { warnings.add(`${node.id}: main component unavailable.`); }
      } else if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        component = componentReference(node);
      }
      if (component) props.componentReference = C.normalize(component);
      const record = { id: node.id, name: node.name, type: node.type, path: nextPath, context, component, props };
      if (options.onNode) options.onNode(record);
      if (options.retain !== false) nodes[node.id] = record;
      for (let i = children.length - 1; i >= 0; i--) pending.push([children[i], nextPath, context]);
      if (count % 100 === 0) {
        if (options.progress) options.progress(count);
        await (options.pause ? options.pause() : new Promise(resolve => setTimeout(resolve, 0)));
      }
    }
    pending.push([root, '', { id: root.id, name: root.name, type: root.type }]);
    while (pending.length) await visit(...pending.pop());
    if (options.progress) options.progress(count);
    return { schemaVersion: C.SCHEMA, createdAt: new Date().toISOString(), fileKey: key,
      scopeId: root.id, scopeName: root.name, ancestors, coverage: COVERAGE, warnings: Array.from(warnings).sort(), nodes, mains };
  }
  /* Diff the scanned scope against the server's stored `{nodeId: contentHash}` map.
     Instances are tracked as placement rows (own props + `mainComponentId`); nodes inside an instance
     (any strict ancestor is an INSTANCE) are not. Each node's hash covers its own props only. */
  function planDelta(snapshot, stored) {
    const nodes = snapshot.nodes, hashes = stored && typeof stored === 'object' ? stored : {};
    const within = new Map(); // nodeId -> true when the node is an instance or lives inside one
    const withinInstance = id => {
      if (within.has(id)) return within.get(id);
      const record = nodes[id];
      const value = !record ? false : record.type === 'INSTANCE' ? true : record.props.parentId ? withinInstance(record.props.parentId) : false;
      within.set(id, value);
      return value;
    };
    const insideInstance = id => { const record = nodes[id]; return !!(record && record.props.parentId && withinInstance(record.props.parentId)); };
    const chains = new Map();
    const pathOf = id => { // ancestor ids root-first, from the page down to the node's parent
      if (chains.has(id)) return chains.get(id);
      const record = nodes[id];
      const chain = record.props.parentId ? pathOf(record.props.parentId).concat(record.props.parentId) : (snapshot.ancestors || []).slice();
      chains.set(id, chain);
      return chain;
    };
    const upserts = [], tracked = new Set();
    let changed = 0, added = 0, unchanged = 0, skippedInstances = 0, instances = 0;
    for (const id of Object.keys(nodes).sort()) {
      if (insideInstance(id)) { skippedInstances++; continue; }
      tracked.add(id);
      const record = nodes[id];
      const isInstance = record.type === 'INSTANCE';
      if (isInstance) instances++;
      const contentHash = C.contentHash(record.props);
      const before = hashes[id];
      if (before === contentHash) { unchanged++; continue; }
      if (before === undefined) added++; else changed++;
      const upsert = { nodeId: id, parentId: record.props.parentId || null, path: pathOf(id), nodeType: record.type,
        name: record.name, attrs: record.props, contentHash };
      if (isInstance) { upsert.isInstance = true; upsert.mainComponentId = record.component && record.component.id || null; }
      upserts.push(upsert);
    }
    const deletedNodeIds = Object.keys(hashes).filter(id => !tracked.has(id)).sort();
    return { upserts, deletedNodeIds, counts: { scanned: Object.keys(nodes).length, tracked: tracked.size, changed, added, deleted: deletedNodeIds.length, unchanged, instances, skippedInstances } };
  }
  function normalizeBaseUrl(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/?#]+/.test(url)) throw new Error('Enter the API base URL (https://…) in Settings.');
    return url;
  }
  function validateSettings(settings) {
    const baseUrl = normalizeBaseUrl(settings && settings.baseUrl);
    const token = String((settings && settings.token) || '').trim();
    if (!token) throw new Error('Enter the upload token in Settings.');
    return { baseUrl, token };
  }
  /* A v3 problem (application/problem+json) as `title` + `hint`; null for any other error body. */
  function problemText(data) {
    if (!data || typeof data.title !== 'string' || !data.title) return null;
    return typeof data.hint === 'string' && data.hint ? data.title + '. ' + data.hint : data.title + '.';
  }
  async function request(http, settings, path, body) {
    let response;
    try {
      const init = { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + settings.token, 'X-RDS-Client': CLIENT } };
      if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      response = await http(settings.baseUrl + path, init);
    } catch (e) {
      throw new Error('Could not reach the API at ' + settings.baseUrl + ' (' + (e && e.message || e) + '). Check the URL and the manifest allowedDomains.');
    }
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
      const problem = problemText(data);
      if (response.status === 401 || response.status === 403) {
        throw new Error('The API rejected the upload token (' + response.status + '). Check Settings.' + (problem ? '\n' + problem : ''));
      }
      if (problem) throw new Error('Sync failed (' + response.status + '): ' + problem);
      const detail = data && data.message ? data.message : 'HTTP ' + response.status;
      throw new Error('Sync failed at ' + path + ': ' + detail);
    }
    return data;
  }
  /* Main-component resolution (transitive closure, lazy, deduped). Every main referenced by an
     instance in `snapshot` (and, recursively, by instances inside scanned mains) must exist in the DB at
     the server's current capture version: mains that are absent, or reported `stale` (stored from an older
     capture, so their instance placements are missing), are loaded on demand (`getNodeByIdAsync` loads only
     the page that holds them; remote mains are imported by key) and their subtrees scanned with the scope
     rules. The staleness threshold is the server's; the plugin only reads the ids it reports.
     Returns the upserts for every newly scanned main plus counts + warnings. Never loads all pages. */
  async function resolveMains(api, http, config, snapshot, options = {}) {
    const cancelled = () => options.cancelled && options.cancelled();
    const progress = (phase, count, total) => { if (options.progress) options.progress(phase, count, total); };
    const mainNodes = options.mainNodes || new Map();
    const capturedMains = new Set(Object.keys(snapshot.nodes)); // scanned or queued this run (dedup + cycle guard)
    const presentInDb = new Set();
    const mainQueue = [];
    const upserts = [], warnings = new Set();
    const refs = new Map(); // mainId -> {id,key,name,remote}
    const counts = { resolved: 0, scanned: 0, present: 0, stale: 0, unresolved: 0, scannedNodes: 0 };
    let unchecked = [];
    const collect = mains => {
      for (const id of Object.keys(mains || {})) {
        if (refs.has(id)) continue;
        refs.set(id, mains[id]); counts.resolved++;
        if (!capturedMains.has(id)) unchecked.push(id);
      }
    };
    const check = async () => {
      const ids = unchecked.filter(id => !capturedMains.has(id) && !presentInDb.has(id));
      unchecked = [];
      for (let i = 0; i < ids.length; i += EXISTS_IDS) {
        if (cancelled()) throw new Error('Sync cancelled while resolving main components. Nothing was uploaded.');
        const slice = ids.slice(i, i + EXISTS_IDS);
        progress('Checking main components', i + slice.length, ids.length);
        const response = await request(http, config, filePath(snapshot.fileKey, 'exists'), { fileKey: snapshot.fileKey, nodeIds: slice });
        const present = new Set(response && Array.isArray(response.present) ? response.present : []);
        const stale = new Set(response && Array.isArray(response.stale) ? response.stale : []);
        for (const id of slice) {
          if (present.has(id) && !stale.has(id)) { presentInDb.add(id); counts.present++; }
          else if (!capturedMains.has(id)) { capturedMains.add(id); mainQueue.push(id); if (stale.has(id)) counts.stale++; }
        }
      }
    };
    const load = async id => {
      const ref = refs.get(id);
      let node = null;
      try { node = await api.getNodeByIdAsync(id); } catch (_) { node = null; }
      if (!node || node.removed) node = mainNodes.get(id) || null;
      if (node && node.removed) node = null;
      if ((!node || !('children' in node)) && ref && ref.remote && ref.key) {
        try {
          const importer = ref.type === 'COMPONENT_SET' ? api.importComponentSetByKeyAsync : api.importComponentByKeyAsync;
          if (typeof importer === 'function') node = await importer.call(api, ref.key);
        } catch (_) { node = null; }
      }
      return node && !node.removed && 'children' in node ? node : null; // main components are always traversable containers
    };
    collect(snapshot.mains);
    while (unchecked.length || mainQueue.length) {
      await check();
      while (mainQueue.length) {
        if (cancelled()) throw new Error('Sync cancelled while resolving main components. Nothing was uploaded.');
        const id = mainQueue.shift();
        const ref = refs.get(id) || { id };
        const main = await load(id);
        if (!main) { counts.unresolved++; warnings.add(MAIN_WARNING + `${id}: main component "${ref.name || id}" could not be loaded; its definition was not synced.`); continue; }
        const captured = await capture(api, main, snapshot.fileKey, { cancelled, pause: options.pause,
          onMain: n => mainNodes.set(n.id, n),
          progress: count => progress('Scanning main components', counts.scannedNodes + count) });
        for (const w of captured.warnings) warnings.add(w);
        for (const nodeId of Object.keys(captured.nodes)) capturedMains.add(nodeId);
        const plan = planDelta(captured, {});
        for (const up of plan.upserts) upserts.push(up);
        counts.scanned++; counts.scannedNodes += plan.counts.scanned;
        collect(captured.mains);
      }
    }
    return { upserts, counts, warnings: Array.from(warnings).sort() };
  }
  /* Delta sync: fetch the scope's stored hashes → hash locally → resolve + scan missing main components
     (when `options.api` is given) → upload only changed/new nodes + tombstones.
     `options.markImplemented: true` asks the server to insert never-seen nodes as already implemented
     (first-scan baseline); it is sent on every batch of the run and `result.baselined` sums the counts.
     Every batch also carries `fileName` (`options.fileName`, the document name) and `rootNodeId` (the scope). */
  async function sync(http, settings, snapshot, options = {}) {
    const config = validateSettings(settings);
    const limit = options.batchChars || BATCH_CHARS;
    const markImplemented = options.markImplemented === true;
    const cancelled = () => options.cancelled && options.cancelled();
    const progress = (phase, count, total) => { if (options.progress) options.progress(phase, count, total); };
    progress('Fetching stored hashes', 0);
    const stored = await request(http, config, filePath(snapshot.fileKey, 'hashes') + '?under=' + encodeURIComponent(snapshot.scopeId));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('API returned no hash map.');
    if (cancelled()) throw new Error('Sync cancelled before uploading. Nothing changed on the server.');
    const plan = planDelta(snapshot, stored);
    progress('Comparing', plan.counts.tracked);
    let mains = { counts: { resolved: 0, scanned: 0, present: 0, stale: 0, unresolved: 0, scannedNodes: 0 }, upserts: [], warnings: [] };
    if (options.api) {
      mains = await resolveMains(options.api, http, config, snapshot, { cancelled, progress, pause: options.pause, mainNodes: options.mainNodes });
      if (blockingWarnings(mains.warnings).length) throw new Error('Main components not uploaded because some properties could not be read: ' + blockingWarnings(mains.warnings).slice(0,3).join(' '));
    }
    const batchPath = filePath(snapshot.fileKey, 'sync');
    const result = { fileKey: snapshot.fileKey, upserted: 0, dirty: 0, tombstoned: 0, skippedInstances: 0 };
    const counted = ['upserted','dirty','tombstoned','skippedInstances'];
    if (markImplemented) { result.baselined = 0; counted.push('baselined'); }
    let batch = [], size = 0, batches = 0, deleted = plan.deletedNodeIds;
    const total = plan.upserts.length + mains.upserts.length + deleted.length;
    let done = 0; // upserts + deletions acknowledged by the server
    if (total) progress('Uploading', 0, total);
    const flush = async () => {
      if (!batch.length && !deleted.length) return;
      if (cancelled()) throw new Error('Sync cancelled. Batches already uploaded were applied; run the sync again to finish.');
      const response = await request(http, config, batchPath, { fileKey: snapshot.fileKey, fileName: options.fileName, rootNodeId: snapshot.scopeId,
        upserts: batch, deletedNodeIds: deleted, markImplemented });
      for (const k of counted) result[k] += Number(response && response[k]) || 0;
      done += batch.length + deleted.length;
      batches++; batch = []; size = 0; deleted = []; progress('Uploading', done, total);
    };
    for (const upsert of plan.upserts.concat(mains.upserts)) {
      const chars = JSON.stringify(upsert).length + 2;
      if (size && size + chars > limit) await flush();
      batch.push(upsert); size += chars;
    }
    await flush();
    return { fileKey: snapshot.fileKey, scopeId: snapshot.scopeId, markImplemented, batches, ...plan.counts, mains: mains.counts, mainWarnings: mains.warnings, result };
  }
  function start(api, http = (...args) => fetch(...args)) {
    let scope = null, busy = false, cancelled = false, waitId = 0;
    const waiters = new Map();
    const send = data => api.ui.postMessage(data);
    const pause = () => new Promise(resolve => {
      const id = ++waitId; waiters.set(id, resolve); send({ type: 'yield', id });
    });
    async function loadSettings() {
      try {
        const stored = await api.clientStorage.getAsync(SETTINGS_KEY);
        return { baseUrl: String((stored && stored.baseUrl) || ''), token: String((stored && stored.token) || '') };
      } catch (_) { return { baseUrl: '', token: '' }; }
    }
    async function saveSettings(msg) {
      const settings = { baseUrl: String(msg.baseUrl || '').trim().replace(/\/+$/, ''), token: String(msg.token || '').trim() };
      await api.clientStorage.setAsync(SETTINGS_KEY, settings);
      return settings;
    }
    api.showUI(__html__, { width: 560, height: 640, themeColors: true });
    send({ type: 'version', version: VERSION });
    function selected() {
      const s = api.currentPage.selection;
      if (s.length !== 1 || !['SECTION','FRAME'].includes(s[0].type)) throw new Error('Select exactly one section or frame, then click Use selection.');
      return s[0];
    }
    const progressMessage = (phase, count, total) => total === undefined ? { type: 'progress', phase, count } : { type: 'progress', phase, count, total };
    const scopeState = () => ({ type: 'scope', id: scope.id, name: scope.name, nodeType: scope.type });
    async function stableCapture(key, mainNodes) {
      const options = { pause, cancelled: () => cancelled, progress: count => send({ type: 'progress', phase: 'Scanning', count }),
        onMain: main => mainNodes.set(main.id, main) };
      const first = await capture(api, scope, key, options);
      let seen = 0;
      const total = Object.keys(first.nodes).length;
      const check = await capture(api, scope, key, { pause, cancelled: () => cancelled, retain: false,
        progress: count => send({ type: 'progress', phase: 'Verifying scan', count, total }),
        onNode: record => {
          seen++;
          if (C.stable(first.nodes[record.id]) !== C.stable(record)) throw new Error('Design changed since the capture. Pause editing and upload again.');
        } });
      if (seen !== total || C.stable(first.warnings) !== C.stable(check.warnings)) throw new Error('Design changed during scanning. Try again.');
      if (cancelled) throw new Error('Scan cancelled. Nothing was uploaded.');
      return first;
    }
    api.ui.onmessage = async msg => {
      if (msg.type === 'yield-ack') { const resolve = waiters.get(msg.id); if (resolve) { waiters.delete(msg.id); resolve(); } return; }
      if (msg.type === 'cancel') { cancelled = true; return; }
      if (busy) { send({ type: 'error', message: 'An operation is already running.' }); return; }
      busy = true; cancelled = false; send({ type: 'busy', value: true });
      try {
        if (msg.type === 'load-settings') {
          send({ type: 'settings', settings: await loadSettings() });
        } else if (msg.type === 'save-settings') {
          const settings = await saveSettings(msg);
          send({ type: 'settings', settings });
          send({ type: 'notice', message: settings.baseUrl && settings.token ? 'Settings saved on this machine.' : 'Settings saved. Both the API base URL and upload token are required before uploading.' });
        } else if (msg.type === 'select') {
          scope = selected(); send(scopeState());
        } else if (msg.type === 'upload') {
          if (!scope || scope.removed) throw new Error('Choose a section or frame first.');
          const settings = validateSettings(msg.baseUrl !== undefined || msg.token !== undefined ? await saveSettings(msg) : await loadSettings());
          const key = C.fileKey(msg.fileUrl);
          send({ type: 'clear-result' });
          const mainNodes = new Map();
          const snapshot = await stableCapture(key, mainNodes);
          if (blockingWarnings(snapshot.warnings).length) throw new Error('Snapshot not uploaded because some properties could not be read: ' + blockingWarnings(snapshot.warnings).slice(0,3).join(' '));
          const synced = await sync(http, settings, snapshot, { cancelled: () => cancelled, api, pause, mainNodes, fileName: api.root.name,
            markImplemented: msg.markImplemented === true,
            progress: (phase, count, total) => send(progressMessage(phase, count, total)) });
          send({ type: 'synced', ...synced, warnings: snapshot.warnings.concat(synced.mainWarnings) });
        } else {
          throw new Error('Unknown action: ' + msg.type);
        }
      } catch (e) { send({ type: 'error', message: e.message || String(e) }); }
      finally { busy = false; send({ type: 'busy', value: false }); }
    };
    try { scope = selected(); send(scopeState()); } catch (_) { send({ type: 'notice', message: 'Select a section or frame, then click Use selection.' }); }
  }
  return { capture, planDelta, resolveMains, sync, validateSettings, start };
})();
if (typeof figma !== 'undefined') DesignChecklist.start(figma);
if (typeof module !== 'undefined') module.exports = DesignChecklist;
