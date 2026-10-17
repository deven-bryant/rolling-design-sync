/* Figma runtime adapter. Bundled after core.js by build.js. */
const DesignChecklist = (() => {
  const C = ChecklistCore;
  const SETTINGS_KEY = 'fds_upload_settings_v1';
  // …/sync batches are capped by JSON chars and by records so the upload bar advances steadily. On big syncs
  // both caps grow until the upload fits in MAX_UPLOAD_BATCHES requests (the API rate-limits sync requests per
  // token), but a batch never grows past BATCH_CHARS_MAX (well under the API's 64 MB body limit).
  const BATCH_CHARS = 250000;
  const BATCH_RECORDS = 200;
  const MAX_UPLOAD_BATCHES = 50;
  const BATCH_CHARS_MAX = 2000000;
  // Extra scans when the verification pass differs from the scan (values Figma loads lazily on first access).
  const VERIFY_RETRIES = 2;
  const EXISTS_IDS = 1000; // node ids per …/exists request (API cap is 5000).
  // "Already built?" prompt: asked before uploading when a sync adds at least NEW_LAYERS_MIN never-seen
  // scope layers that are also at least NEW_LAYERS_SHARE of the scope's tracked layers (library excluded).
  const NEW_LAYERS_MIN = 25;
  const NEW_LAYERS_SHARE = 0.5;
  const manyNewLayers = layers => layers.added >= NEW_LAYERS_MIN && layers.added >= NEW_LAYERS_SHARE * layers.tracked;
  const MAIN_COUNTS = () => ({ resolved: 0, scanned: 0, present: 0, stale: 0, unresolved: 0, scannedNodes: 0, librarySkipped: 0 });
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
  // Reference pass: configured screens are exported at 1x, one at a time, within the API's image limits.
  const SCREEN_WARNING = '[screen] ';
  const SCREEN_TYPES = ['FRAME', 'COMPONENT', 'INSTANCE'];
  const EXPORT_MAX_SIDE = 8192;
  const EXPORT_MAX_BYTES = 5 * 1024 * 1024;
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
      nodes[node.id] = record;
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
  /* The first difference between two captures of the same scope, for the user ("\"Button\" (12:34) fills,
     styleDefinitions"); null when they match. Names at most 3 top-level props. */
  function scanDifference(a, b) {
    const changed = Object.keys(a.nodes).concat(Object.keys(b.nodes).filter(id => !(id in a.nodes)))
      .filter(id => !a.nodes[id] || !b.nodes[id] || C.stable(a.nodes[id]) !== C.stable(b.nodes[id]));
    if (!changed.length) {
      if (C.stable(a.warnings) === C.stable(b.warnings)) return null;
      const warning = a.warnings.filter(w => !b.warnings.includes(w)).concat(b.warnings.filter(w => !a.warnings.includes(w)))[0];
      return 'the property-read warnings changed (' + String(warning).slice(0,200) + ')';
    }
    const id = changed[0], before = a.nodes[id], after = b.nodes[id], record = after || before;
    let what;
    if (!before || !after) what = before ? 'disappeared' : 'appeared';
    else {
      const differs = (x, y, k) => C.stable(x[k]) !== C.stable(y[k]);
      const keys = Array.from(new Set(Object.keys(before.props).concat(Object.keys(after.props)))).sort().filter(k => differs(before.props, after.props, k));
      what = (keys.length ? keys : ['name','type','path','context','component'].filter(k => differs(before, after, k))).slice(0,3).join(', ');
    }
    const more = changed.length > 1 ? ` (and ${changed.length - 1} more layer${changed.length === 2 ? '' : 's'})` : '';
    return `"${record.name}" (${id}) ${what}${more}`;
  }
  /* Diff the scanned scope against the server's stored `{nodeId: contentHash}` map.
     Instances are tracked as placement rows (own props + `mainComponentId`); nodes inside an instance
     (any strict ancestor is an INSTANCE) are not. Each node's hash covers its own props only.
     Records under a remote (library) main component or set — or every record, with `options.library` —
     carry `library: true`. `layers` counts the tracked and never-seen records that are not library ones. */
  function planDelta(snapshot, stored, options = {}) {
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
    const libraryMemo = new Map();
    const underLibrary = id => {
      if (libraryMemo.has(id)) return libraryMemo.get(id);
      const record = nodes[id];
      const value = !record ? false : options.library === true ? true
        : ['COMPONENT','COMPONENT_SET'].includes(record.type) && !!record.component && record.component.remote === true ? true
        : record.props.parentId ? underLibrary(record.props.parentId) : false;
      libraryMemo.set(id, value);
      return value;
    };
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
    const layers = { tracked: 0, added: 0 };
    for (const id of Object.keys(nodes).sort()) {
      if (insideInstance(id)) { skippedInstances++; continue; }
      tracked.add(id);
      const record = nodes[id];
      const isInstance = record.type === 'INSTANCE';
      if (isInstance) instances++;
      const library = underLibrary(id);
      if (!library) layers.tracked++;
      const contentHash = C.contentHash(record.props);
      const before = hashes[id];
      if (before === contentHash) { unchanged++; continue; }
      if (before === undefined) { added++; if (!library) layers.added++; } else changed++;
      const upsert = { nodeId: id, parentId: record.props.parentId || null, path: pathOf(id), nodeType: record.type,
        name: record.name, attrs: record.props, contentHash };
      if (isInstance) { upsert.isInstance = true; upsert.mainComponentId = record.component && record.component.id || null; }
      if (library) upsert.library = true;
      upserts.push(upsert);
    }
    const deletedNodeIds = Object.keys(hashes).filter(id => !tracked.has(id)).sort();
    return { upserts, deletedNodeIds, layers, counts: { scanned: Object.keys(nodes).length, tracked: tracked.size, changed, added, deleted: deletedNodeIds.length, unchanged, instances, skippedInstances } };
  }
  /* ---- Design tokens: the file's Figma variables as their own scope (`tokens` → `tokens:<collectionKey>` →
     `token:<variableKey>`). Keys are stable across library re-imports; Figma ids are not. ---- */
  const TOKENS_ROOT = C.TOKENS_ROOT_ID;
  const TOKEN_FIELDS = ['name','resolvedType','description','scopes','codeSyntax'];
  const hex2 = c => Math.max(0, Math.min(255, Math.round(Number(c) * 255))).toString(16).padStart(2, '0');
  const isColor = v => !!v && typeof v === 'object' && ['r','g','b'].every(k => typeof v[k] === 'number');
  /* One mode's value: `#rrggbb` (`#rrggbbaa` when not opaque), a number to 4 dp, a string, a boolean, or an alias
     `{ alias: "token:<key>", name }`; null when it can't be read. */
  function tokenValue(value, variables) {
    if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
      const target = variables.get(value.id);
      return target && target.key ? { alias: 'token:' + target.key, name: target.name } : null;
    }
    if (isColor(value)) {
      const alpha = hex2(typeof value.a === 'number' ? value.a : 1);
      return '#' + hex2(value.r) + hex2(value.g) + hex2(value.b) + (alpha === 'ff' ? '' : alpha);
    }
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    return null;
  }
  const aliasIds = variable => {
    let values = null;
    try { values = variable.valuesByMode; } catch (_) { values = null; }
    const out = new Set(); aliases(values, out); return Array.from(out).sort();
  };
  /* The token set: every variable in the captured records' `resolvedVariables`, every local variable
     (`getLocalVariablesAsync`), the stored tokens' `options.storedVariableIds` (kept current; a null lookup means
     the variable is gone) and, transitively, every variable those values alias. Returns
     `{ nodes: { [nodeId]: { nodeId, parentId, path, nodeType, name, attrs } }, gone, localKeys, warnings }` — `gone`
     holds the variable ids Figma returned null for, `localKeys` the keys of the file's local variables (null when
     they could not be listed). Unreadable values are `{ $unreadable: true }` plus a `[token]` warning. */
  async function collectTokens(api, records, options = {}) {
    const cancelled = () => options.cancelled && options.cancelled();
    const progress = count => { if (options.progress) options.progress('Collecting tokens', count); };
    const variables = new Map(), gone = new Set(), warnings = new Set(), seen = new Set(), queue = [];
    const stored = new Set(options.storedVariableIds || []);
    const want = id => { if (typeof id === 'string' && id && !seen.has(id)) { seen.add(id); queue.push(id); } };
    const figmaVariables = api.variables || {};
    let localKeys = null;
    for (const props of records) {
      const used = props && props.resolvedVariables;
      if (used && typeof used === 'object') Object.keys(used).sort().forEach(want);
    }
    if (typeof figmaVariables.getLocalVariablesAsync === 'function') {
      let locals = [], listed = true;
      try { locals = await figmaVariables.getLocalVariablesAsync() || []; }
      catch (error) { listed = false; warnings.add(`${TOKEN_WARNING}local variables could not be listed (${String(error && error.message || error).slice(0,200)}); only used variables are tracked.`); }
      for (const v of locals) if (v && typeof v.id === 'string') { variables.set(v.id, v); want(v.id); }
      if (listed) localKeys = new Set(locals.filter(v => v && typeof v.key === 'string' && v.key).map(v => v.key));
    }
    Array.from(stored).sort().forEach(want);
    let count = 0;
    while (queue.length) {
      if (cancelled()) throw new Error('Sync cancelled. Batches already uploaded were applied; run the sync again to finish.');
      const id = queue.shift();
      if (!variables.has(id)) {
        try {
          const v = await figmaVariables.getVariableByIdAsync(id);
          variables.set(id, v || null);
          if (!v) gone.add(id);
        } catch (_) { variables.set(id, null); }
      }
      const v = variables.get(id);
      if (v) aliasIds(v).forEach(want);
      else if (!stored.has(id)) warnings.add(`${TOKEN_WARNING}variable ${id} could not be loaded; it is not tracked as a token.`);
      if (++count % 100 === 0) { progress(count); if (options.pause) await options.pause(); }
    }
    progress(count);
    const collections = new Map(), nodes = {};
    for (const id of Array.from(variables.keys()).sort()) {
      const v = variables.get(id);
      if (!v || typeof v.key !== 'string' || !v.key) continue;
      const nodeId = 'token:' + v.key;
      if (nodes[nodeId]) continue;
      if (!collections.has(v.variableCollectionId)) {
        let collection = null;
        try { collection = await figmaVariables.getVariableCollectionByIdAsync(v.variableCollectionId); } catch (_) { collection = null; }
        collections.set(v.variableCollectionId, collection && typeof collection.key === 'string' && collection.key ? collection : null);
      }
      const collection = collections.get(v.variableCollectionId);
      if (!collection) { warnings.add(`${TOKEN_WARNING}${v.name} (${id}): its collection could not be loaded; it is not tracked as a token.`); continue; }
      const collectionId = 'tokens:' + collection.key;
      const modes = Array.isArray(collection.modes) ? collection.modes : [];
      if (!nodes[collectionId]) nodes[collectionId] = { nodeId: collectionId, parentId: TOKENS_ROOT, path: [TOKENS_ROOT], nodeType: 'VARIABLE_COLLECTION',
        name: collection.name, attrs: { name: collection.name, modes: modes.map(m => m.name), remote: collection.remote === true } };
      const attrs = {};
      for (const k of TOKEN_FIELDS) {
        try { attrs[k] = C.normalize(v[k] === undefined ? null : v[k]); }
        catch (_) { attrs[k] = { $unreadable: true }; warnings.add(`${TOKEN_WARNING}${v.name} (${id}): could not read ${k}.`); }
      }
      attrs.variableId = id;
      attrs.remote = v.remote === true;
      let values = null;
      try { values = v.valuesByMode; } catch (_) { values = null; }
      for (const mode of modes) {
        const value = tokenValue(values && typeof values === 'object' ? values[mode.modeId] : undefined, variables);
        attrs['value:' + mode.name] = value === null ? { $unreadable: true } : value;
        if (value === null) warnings.add(`${TOKEN_WARNING}${v.name} (${id}): the "${mode.name}" value could not be read; it is recorded as unreadable.`);
      }
      nodes[nodeId] = { nodeId, parentId: collectionId, path: [TOKENS_ROOT, collectionId], nodeType: 'VARIABLE', name: v.name, attrs };
    }
    return { nodes, gone, localKeys, warnings: Array.from(warnings).sort() };
  }
  /* Plan the tokens scope against `GET …/hashes?under=tokens`. The `tokens` root is always sent (that response
     carries the stored tokens map under `tokens` instead of the root's hash); other nodes only when their hash
     changed. Deletions: only a stored local token (`remote: false`) not collected now, absent from the file's local
     variables (`collected.localKeys`, so never when they could not be listed) and whose stored id is gone
     (`collected.gone`) — never a collected token nor a library one (a stale imported id is not a deleted variable);
     a stored collection only once every stored token in it (by `collectionId`) is deleted. Without the `tokens` map
     (an older server) nothing is deleted. `counts` cover variables only; `empty` = nothing collected or stored. */
  function planTokens(collected, stored) {
    const { settings: _settings, tokens: map, ...hashes } = stored && typeof stored === 'object' ? stored : {};
    const tokenMap = map && typeof map === 'object' && !Array.isArray(map) ? map : null;
    const nodes = { [TOKENS_ROOT]: { nodeId: TOKENS_ROOT, parentId: null, path: [], nodeType: 'TOKENS', name: 'Design tokens', attrs: {} }, ...collected.nodes };
    const upserts = [], deletedNodeIds = [];
    const counts = { tracked: 0, changed: 0, added: 0, unchanged: 0, deleted: 0 };
    const rank = id => id === TOKENS_ROOT ? 0 : id.startsWith('tokens:') ? 1 : 2; // parents first
    for (const id of Object.keys(nodes).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))) {
      const variable = id.startsWith('token:'), contentHash = C.contentHash(nodes[id].attrs);
      if (variable) counts.tracked++;
      if (id !== TOKENS_ROOT && hashes[id] === contentHash) { if (variable) counts.unchanged++; continue; }
      if (variable) counts[hashes[id] === undefined ? 'added' : 'changed']++;
      upserts.push({ ...nodes[id], contentHash });
    }
    if (tokenMap) {
      const localKeys = collected.localKeys instanceof Set ? collected.localKeys : null;
      const kept = new Set(); // collections holding a stored token that stays
      let unplaced = false; // a kept token without a stored collectionId: keep every collection
      for (const id of Object.keys(tokenMap).sort()) {
        const entry = tokenMap[id] && typeof tokenMap[id] === 'object' ? tokenMap[id] : {};
        const goneLocal = entry.remote === false && localKeys !== null && !localKeys.has(id.slice('token:'.length));
        if (!nodes[id] && goneLocal && typeof entry.variableId === 'string' && collected.gone.has(entry.variableId)) { deletedNodeIds.push(id); counts.deleted++; continue; }
        if (typeof entry.collectionId === 'string') kept.add(entry.collectionId); else unplaced = true;
      }
      if (!unplaced) for (const id of Object.keys(hashes).sort()) if (id.startsWith('tokens:') && !nodes[id] && !kept.has(id)) deletedNodeIds.push(id);
    }
    const empty = !Object.keys(collected.nodes).length && !Object.keys(hashes).some(id => id !== TOKENS_ROOT) && !(tokenMap && Object.keys(tokenMap).length);
    return { upserts, deletedNodeIds, counts, empty };
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
  /* Errors carry the HTTP `status` and the problem `code` (when the API sent one). */
  async function request(http, settings, path, body, method) {
    let response;
    try {
      const init = { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Authorization: 'Bearer ' + settings.token, 'X-RDS-Client': CLIENT } };
      if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      response = await http(settings.baseUrl + path, init);
    } catch (e) {
      throw new Error('Could not reach the API at ' + settings.baseUrl + ' (' + (e && e.message || e) + '). Check the URL and the manifest allowedDomains.');
    }
    let data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!response.ok) {
      const problem = problemText(data);
      const failed = message => Object.assign(new Error(message), { status: response.status, code: data && typeof data.code === 'string' ? data.code : undefined });
      if (response.status === 401 || response.status === 403) {
        throw failed('The API rejected the upload token (' + response.status + '). Check Settings.' + (problem ? '\n' + problem : ''));
      }
      if (problem) throw failed('Sync failed (' + response.status + '): ' + problem);
      const detail = data && data.message ? data.message : 'HTTP ' + response.status;
      throw failed('Sync failed at ' + path + ': ' + detail);
    }
    return data;
  }
  /* Main-component resolution (transitive closure, lazy, deduped). Every main referenced by an
     instance in `snapshot` (and, recursively, by instances inside scanned mains) must exist in the DB at
     the server's current capture version: mains that are absent, or reported `stale` (stored from an older
     capture, so their instance placements are missing), are loaded on demand (`getNodeByIdAsync` loads only
     the page that holds them; remote mains are imported by key) and their subtrees scanned with the scope
     rules. The staleness threshold is the server's; the plugin only reads the ids it reports.
     Records scanned under a remote main carry `library: true`. With `options.trackLibrary === false`
     (the file's setting) remote mains are neither checked, imported nor scanned: `counts.librarySkipped`.
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
    const counts = MAIN_COUNTS();
    const trackLibrary = options.trackLibrary !== false;
    let unchecked = [];
    const collect = mains => {
      for (const id of Object.keys(mains || {})) {
        if (refs.has(id)) continue;
        refs.set(id, mains[id]);
        if (!trackLibrary && mains[id] && mains[id].remote === true) { counts.librarySkipped++; continue; }
        counts.resolved++;
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
        const plan = planDelta(captured, {}, { library: ref.remote === true || main.remote === true });
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
     Every batch also carries `fileName` (`options.fileName`, the document name) and `rootNodeId` (the scope).
     The hashes response's `settings.trackLibraryComponents` (missing → true) decides whether remote mains are
     scanned. Without `markImplemented`, a plan that adds many never-seen layers (`manyNewLayers`) awaits
     `options.confirmNewLayers({ added, total })`: 'implemented' continues with `markImplemented`, 'new'
     continues unchanged, anything else stops before uploading.
     Upserts go in batches of at most BATCH_CHARS JSON chars and BATCH_RECORDS records (`options.batchChars`,
     `options.batchRecords`), both raised on big syncs so the upload takes at most MAX_UPLOAD_BATCHES batches
     (`options.maxBatches`) with no batch over BATCH_CHARS_MAX; deletions go in the first batch.
     With `options.api` a second pass then syncs the file's design tokens (`syncTokens`, same `markImplemented`;
     `result.tokens`); the prompt counts layers only. A third pass uploads reference images for configured screens
     whose design changed (`syncReferences`, `result.references`; `options.references: false` skips it). */
  async function sync(http, settings, snapshot, options = {}) {
    const config = validateSettings(settings);
    let markImplemented = options.markImplemented === true;
    const cancelled = () => options.cancelled && options.cancelled();
    const progress = (phase, count, total) => { if (options.progress) options.progress(phase, count, total); };
    progress('Fetching stored hashes', 0);
    const stored = await request(http, config, filePath(snapshot.fileKey, 'hashes') + '?under=' + encodeURIComponent(snapshot.scopeId));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('API returned no hash map.');
    if (cancelled()) throw new Error('Sync cancelled before uploading. Nothing changed on the server.');
    const { settings: fileSettings, ...hashes } = stored; // `settings` is never a node id
    const trackLibrary = !(fileSettings && typeof fileSettings === 'object' && fileSettings.trackLibraryComponents === false);
    const plan = planDelta(snapshot, hashes);
    progress('Comparing', plan.counts.tracked);
    if (!markImplemented && options.confirmNewLayers && manyNewLayers(plan.layers)) {
      const choice = await options.confirmNewLayers({ added: plan.layers.added, total: plan.layers.tracked });
      if (choice === 'implemented') markImplemented = true;
      else if (choice !== 'new') throw Object.assign(new Error('Sync cancelled. Nothing was uploaded.'), { notice: true });
    }
    if (cancelled()) throw new Error('Sync cancelled before uploading. Nothing changed on the server.');
    let mains = { counts: MAIN_COUNTS(), upserts: [], warnings: [] };
    if (options.api) {
      mains = await resolveMains(options.api, http, config, snapshot, { cancelled, progress, pause: options.pause, mainNodes: options.mainNodes, trackLibrary });
      if (blockingWarnings(mains.warnings).length) throw new Error('Main components not uploaded because some properties could not be read: ' + blockingWarnings(mains.warnings).slice(0,3).join(' '));
    }
    const cancelMessage = 'Sync cancelled. Batches already uploaded were applied; run the sync again to finish.';
    const uploadOptions = { cancelled, cancelMessage, fileName: options.fileName, markImplemented,
      batchChars: options.batchChars, batchRecords: options.batchRecords, maxBatches: options.maxBatches };
    const scope = await upload(http, config, snapshot.fileKey, { ...uploadOptions, rootNodeId: snapshot.scopeId, phase: 'Uploading',
      upserts: plan.upserts.concat(mains.upserts), deletedNodeIds: plan.deletedNodeIds,
      progress: (count, total) => progress('Uploading', count, total) });
    let tokens = null;
    if (options.api && options.tokens !== false) {
      if (cancelled()) throw new Error(cancelMessage);
      const records = Object.keys(snapshot.nodes).sort().map(id => snapshot.nodes[id].props).concat(mains.upserts.map(up => up.attrs));
      tokens = await syncTokens(options.api, http, config, snapshot.fileKey, records, { ...uploadOptions, pause: options.pause, progress });
    }
    let references = null;
    if (options.api && options.references !== false) {
      if (cancelled()) throw new Error(cancelMessage);
      references = await syncReferences(options.api, http, config, snapshot.fileKey, snapshot.scopeId, { cancelled, cancelMessage, pause: options.pause, progress });
    }
    return { fileKey: snapshot.fileKey, scopeId: snapshot.scopeId, markImplemented, trackLibraryComponents: trackLibrary, batches: scope.batches, ...plan.counts,
      mains: mains.counts, mainWarnings: mains.warnings, tokens, references, result: scope.result };
  }
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(api, bytes) {
    if (typeof api.base64Encode === 'function') return api.base64Encode(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63] + (i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? BASE64[n & 63] : '=');
    }
    return out;
  }
  /* Export size at 1x: the frame, or its render bounds when effects/overflow reach past it. */
  function exportSize(node) {
    let width = Number(node.width) || 0, height = Number(node.height) || 0;
    try {
      const b = node.absoluteRenderBounds;
      if (b) { width = Math.max(width, Number(b.width) || 0); height = Math.max(height, Number(b.height) || 0); }
    } catch (_) { /* Render bounds are optional. */ }
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }
  /* Third pass of a sync: reference images for the configured screens under the scope whose design changed since
     their last reference (`GET …/screens/references-needed?under=`). Each screen is loaded, exported as a 1x PNG
     and uploaded (`PUT …/screens/{nodeId}/reference` with `{ designVersion, image }`), one at a time ("Exporting
     screens"). Screens that are gone, of another type, or over EXPORT_MAX_SIDE px / EXPORT_MAX_BYTES are skipped
     with a non-blocking [screen] warning. Returns null when the server has no screen routes (404); a file that
     stores no images (images_disabled) stops the pass with one warning. Cancel is honoured between exports. */
  async function syncReferences(api, http, config, fileKey, scopeId, options) {
    let listed;
    try {
      listed = await request(http, config, filePath(fileKey, 'screens/references-needed') + '?under=' + encodeURIComponent(scopeId));
    } catch (e) {
      if (e && e.status === 404) return null;
      throw e;
    }
    const screens = (listed && Array.isArray(listed.screens) ? listed.screens : [])
      .filter(s => s && typeof s.nodeId === 'string' && s.nodeId && typeof s.designVersion === 'string' && s.designVersion);
    const result = { needed: screens.length, updated: 0, skipped: 0, warnings: [] };
    if (!screens.length) return result;
    const skip = message => { result.skipped++; result.warnings.push(SCREEN_WARNING + message); };
    options.progress('Exporting screens', 0, screens.length);
    for (let i = 0; i < screens.length; i++) {
      if (options.cancelled()) throw new Error(options.cancelMessage);
      if (options.pause) await options.pause();
      const { nodeId, designVersion } = screens[i];
      let node = null;
      try { node = await api.getNodeByIdAsync(nodeId); } catch (_) { node = null; }
      if (!node || node.removed) skip(`${nodeId}: screen no longer exists in this file; reference not updated.`);
      else if (!SCREEN_TYPES.includes(node.type)) skip(`${nodeId}: screen is a ${node.type}, not a frame, component or instance; reference not updated.`);
      else {
        const size = exportSize(node);
        if (size.width > EXPORT_MAX_SIDE || size.height > EXPORT_MAX_SIDE) {
          skip(`"${node.name}" (${nodeId}) is ${size.width} × ${size.height} px, over ${EXPORT_MAX_SIDE} px per side; reference not updated.`);
        } else {
          let bytes = null;
          try { bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }); }
          catch (e) { skip(`"${node.name}" (${nodeId}) could not be exported: ${String(e && e.message || e).slice(0, 300)}`); }
          if (bytes && bytes.length > EXPORT_MAX_BYTES) {
            skip(`"${node.name}" (${nodeId}) exports to ${(bytes.length / 1048576).toFixed(1)} MB, over ${EXPORT_MAX_BYTES / 1048576} MB; reference not updated.`);
          } else if (bytes) {
            const body = { designVersion, image: base64(api, bytes) };
            bytes = null;
            try {
              await request(http, config, filePath(fileKey, 'screens/' + encodeURIComponent(nodeId) + '/reference'), body, 'PUT');
              result.updated++;
            } catch (e) {
              if (e && e.code === 'images_disabled') {
                result.skipped += screens.length - i;
                result.warnings.push(SCREEN_WARNING + 'This file does not store images (file setting), so no screen references were uploaded.');
                options.progress('Exporting screens', screens.length, screens.length);
                return result;
              }
              if (e && (e.status === 401 || e.status === 403)) throw e;
              skip(`"${node.name}" (${nodeId}): ${e && e.message || e}`);
            }
          }
        }
      }
      options.progress('Exporting screens', i + 1, screens.length);
    }
    return result;
  }
  /* Upserts in batches of at most `batchChars` JSON chars and `batchRecords` records (raised so the upload takes at
     most `maxBatches` requests, no batch over BATCH_CHARS_MAX); deletions go in the first batch. Every batch carries
     `fileName`, `rootNodeId` and `markImplemented`; `result` sums the server's counts. */
  async function upload(http, config, fileKey, options) {
    const result = { fileKey, upserted: 0, dirty: 0, tombstoned: 0, skippedInstances: 0 };
    const counted = ['upserted','dirty','tombstoned','skippedInstances'];
    if (options.markImplemented) { result.baselined = 0; counted.push('baselined'); }
    const upserts = options.upserts;
    let batch = [], size = 0, batches = 0, deleted = options.deletedNodeIds;
    const total = upserts.length + deleted.length;
    let done = 0; // upserts + deletions acknowledged by the server
    if (total) options.progress(0, total);
    const flush = async () => {
      if (!batch.length && !deleted.length) return;
      if (options.cancelled()) throw new Error(options.cancelMessage);
      const response = await request(http, config, filePath(fileKey, 'sync'), { fileKey, fileName: options.fileName, rootNodeId: options.rootNodeId,
        upserts: batch, deletedNodeIds: deleted, markImplemented: options.markImplemented });
      for (const k of counted) result[k] += Number(response && response[k]) || 0;
      done += batch.length + deleted.length;
      batches++; batch = []; size = 0; deleted = []; options.progress(done, total);
    };
    const sizes = upserts.map(upsert => JSON.stringify(upsert).length + 2);
    const maxBatches = options.maxBatches || MAX_UPLOAD_BATCHES;
    const charLimit = Math.max(options.batchChars || BATCH_CHARS, Math.min(BATCH_CHARS_MAX, Math.ceil(sizes.reduce((a, b) => a + b, 0) / maxBatches)));
    const recordLimit = Math.max(options.batchRecords || BATCH_RECORDS, Math.ceil(upserts.length / maxBatches));
    for (let i = 0; i < upserts.length; i++) {
      if (batch.length && (size + sizes[i] > charLimit || batch.length >= recordLimit)) await flush();
      batch.push(upserts[i]); size += sizes[i];
    }
    await flush();
    return { result, batches };
  }
  /* Second pass of a sync: the file's design tokens as the `tokens` scope (`rootNodeId: "tokens"`), planned against
     `GET …/hashes?under=tokens` and uploaded with the same batching ("Uploading tokens"). Skipped (no upload) when
     the file has no variables and none are stored. Token warnings never block. */
  async function syncTokens(api, http, config, fileKey, records, options) {
    options.progress('Fetching stored token hashes', 0);
    const stored = await request(http, config, filePath(fileKey, 'hashes') + '?under=' + encodeURIComponent(TOKENS_ROOT));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('API returned no token hash map.');
    const map = stored.tokens && typeof stored.tokens === 'object' && !Array.isArray(stored.tokens) ? stored.tokens : {};
    const storedVariableIds = Object.keys(map).map(id => map[id] && map[id].variableId).filter(id => typeof id === 'string' && id);
    const collected = await collectTokens(api, records, { storedVariableIds, cancelled: options.cancelled, progress: options.progress, pause: options.pause });
    const plan = planTokens(collected, stored);
    let uploaded = { result: null, batches: 0 };
    if (!plan.empty) {
      uploaded = await upload(http, config, fileKey, { ...options, rootNodeId: TOKENS_ROOT, upserts: plan.upserts, deletedNodeIds: plan.deletedNodeIds,
        progress: (count, total) => options.progress('Uploading tokens', count, total) });
    }
    return { ...plan.counts, batches: uploaded.batches, result: uploaded.result, warnings: collected.warnings };
  }
  function start(api, http = (...args) => fetch(...args)) {
    let scope = null, busy = false, cancelled = false, waitId = 0, choiceId = 0;
    const waiters = new Map(), choices = new Map();
    const send = data => api.ui.postMessage(data);
    const pause = () => new Promise(resolve => {
      const id = ++waitId; waiters.set(id, resolve); send({ type: 'yield', id });
    });
    const confirmNewLayers = layers => new Promise(resolve => {
      const id = ++choiceId; choices.set(id, resolve); send({ type: 'confirm-new-layers', id, ...layers });
    });
    const answer = (id, choice) => { const resolve = choices.get(id); if (resolve) { choices.delete(id); resolve(choice); } };
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
    /* Scan, then re-scan until two consecutive passes match (at most VERIFY_RETRIES extra passes): values Figma
       loads lazily on first access (library styles and variables, remote mains, text metrics) settle after one. */
    async function stableCapture(key, mainNodes) {
      const onMain = main => mainNodes.set(main.id, main);
      let previous = await capture(api, scope, key, { pause, cancelled: () => cancelled, onMain,
        progress: count => send({ type: 'progress', phase: 'Scanning', count }) });
      for (let retry = 0; ; retry++) {
        const phase = retry ? `Verifying scan (retry ${retry})` : 'Verifying scan';
        const total = Object.keys(previous.nodes).length;
        const check = await capture(api, scope, key, { pause, cancelled: () => cancelled, onMain,
          progress: count => send({ type: 'progress', phase, count, total }) });
        if (cancelled) throw new Error('Scan cancelled. Nothing was uploaded.');
        const difference = scanDifference(previous, check);
        if (!difference) return previous;
        if (retry >= VERIFY_RETRIES) throw new Error(`Design kept changing while scanning: ${difference}. If you aren't editing, a library style or font may still be loading — try again.`);
        previous = check;
      }
    }
    api.ui.onmessage = async msg => {
      if (msg.type === 'yield-ack') { const resolve = waiters.get(msg.id); if (resolve) { waiters.delete(msg.id); resolve(); } return; }
      if (msg.type === 'new-layers-choice') { answer(msg.id, msg.choice); return; }
      if (msg.type === 'cancel') { cancelled = true; for (const id of Array.from(choices.keys())) answer(id, 'cancel'); return; }
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
          const synced = await sync(http, settings, snapshot, { cancelled: () => cancelled, api, pause, mainNodes, fileName: api.root.name, confirmNewLayers,
            markImplemented: msg.markImplemented === true,
            progress: (phase, count, total) => send(progressMessage(phase, count, total)) });
          send({ type: 'synced', ...synced, warnings: snapshot.warnings.concat(synced.mainWarnings, synced.tokens ? synced.tokens.warnings : [], synced.references ? synced.references.warnings : []) });
        } else {
          throw new Error('Unknown action: ' + msg.type);
        }
      } catch (e) { send({ type: e && e.notice ? 'notice' : 'error', message: e && e.message || String(e) }); }
      finally { busy = false; send({ type: 'busy', value: false }); }
    };
    try { scope = selected(); send(scopeState()); } catch (_) { send({ type: 'notice', message: 'Select a section or frame, then click Use selection.' }); }
  }
  return { capture, planDelta, scanDifference, resolveMains, collectTokens, planTokens, sync, validateSettings, start, NEW_LAYERS_MIN, NEW_LAYERS_SHARE,
    BATCH_CHARS, BATCH_RECORDS, MAX_UPLOAD_BATCHES, BATCH_CHARS_MAX, VERIFY_RETRIES, EXPORT_MAX_SIDE, EXPORT_MAX_BYTES };
})();
if (typeof figma !== 'undefined') DesignChecklist.start(figma);
if (typeof module !== 'undefined') module.exports = DesignChecklist;
