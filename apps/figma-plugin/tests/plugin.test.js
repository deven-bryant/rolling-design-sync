const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('../src/core');
const { version: PLUGIN_VERSION } = require('../package.json');
const sandbox = { module: { exports: {} }, ChecklistCore: C, setTimeout, PLUGIN_VERSION };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/plugin.js'),'utf8'),sandbox);
const P = sandbox.module.exports;
/* Every fake node keeps shared plugin data like Figma (namespace + key -> string, '' when unset). */
function node(id,type='FRAME',extra={}) {
 const shared=new Map();
 return { id,type,name:type+' '+id,visible:true,width:100,height:50,removed:false,
  getSharedPluginData:(ns,key)=>shared.get(ns+'\u0000'+key)||'',setSharedPluginData:(ns,key,value)=>{shared.set(ns+'\u0000'+key,String(value));},
  getPluginData:key=>shared.get('\u0000'+key)||'',setPluginData:(key,value)=>{shared.set('\u0000'+key,String(value));},...extra };
}
function fixture() {
 const root=node('1:1','SECTION',{children:[]});
 const child=node('1:2','RECTANGLE',{parent:root,fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]});root.children.push(child);
 const registry=new Map([[root.id,root],[child.id,child]]);
 const api={root:{name:'Design file'},skipInvisibleInstanceChildren:true,getNodeByIdAsync:async id=>registry.get(id)||null,getStyleByIdAsync:async()=>null,variables:{getVariableByIdAsync:async()=>null}};
 return {root,child,api,registry};
}
test('variant references and remote mains carry their component set; unavailable sets are optional',async()=>{
 const f=fixture();
 const set=node('5:0','COMPONENT_SET',{key:'SET',name:'Table cell',children:[],componentPropertyDefinitions:{}});
 const main=node('5:1','COMPONENT',{parent:set,key:'VARIANT',name:'Type=Badge',remote:true,children:[],variantProperties:{Type:'Badge'}});
 const instance=node('1:3','INSTANCE',{parent:f.root,children:[],getMainComponentAsync:async()=>main});f.root.children.push(instance,main);
 const expected={id:set.id,key:set.key,name:set.name};
 let scan=await P.capture(f.api,f.root,'FILE');
 same(scan.nodes[main.id].component.set,expected);
 same(scan.nodes[main.id].props.componentReference.set,expected);
 same(scan.nodes[instance.id].props.componentReference.set,expected);
 same(scan.mains[main.id].set,expected);
 const variantHash=C.contentHash(scan.nodes[instance.id].props),plainHash=C.contentHash(scan.nodes[f.child.id].props);
 main.parent=f.root;
 scan=await P.capture(f.api,f.root,'FILE');
 assert.equal(scan.nodes[main.id].component.set,undefined);assert.equal(scan.mains[main.id].set,undefined);
 assert.notEqual(C.contentHash(scan.nodes[instance.id].props),variantHash);
 assert.equal(C.contentHash(scan.nodes[f.child.id].props),plainHash);
 f.root.children=f.root.children.filter(n=>n!==main);
 Object.defineProperty(main,'parent',{get(){throw new Error('Library parent unavailable');}});
 scan=await P.capture(f.api,f.root,'FILE');
 assert.equal(scan.nodes[instance.id].component.set,undefined);assert.equal(scan.mains[main.id].set,undefined);
 same(scan.warnings,[]);
});
test('nested edits, additions, removals, reparenting and order changes are represented',async()=>{
 const {root,child,api}=fixture();const a=await P.capture(api,root,'FILE');
 child.width=120;const b=await P.capture(api,root,'FILE');
 assert.equal(C.diff(a,b).items.find(i=>i.nodeId===child.id).changes[0].property,'width');
 const third=node('1:3','TEXT',{parent:root,characters:'New',getStyledTextSegments:()=>[],fontSize:14});root.children.push(third);
 let r=C.diff(b,await P.capture(api,root,'FILE'));assert.equal(r.items.find(i=>i.nodeId===third.id).changeType,'added-to-scope');
 root.children=[third];r=C.diff(a,await P.capture(api,root,'FILE'));assert.equal(r.items.find(i=>i.nodeId===child.id).changeType,'removed-from-scope');
 root.children=[third,child];const c=await P.capture(api,root,'FILE');root.children=[child,third];
 r=C.diff(c,await P.capture(api,root,'FILE'));assert.ok(r.items[0].changes.some(c=>c.property==='childOrder'));
 const frame=node('1:4','FRAME',{parent:root,children:[child]});child.parent=frame;root.children=[third,frame];
 r=C.diff(c,await P.capture(api,root,'FILE'));assert.equal(r.items.find(i=>i.nodeId===child.id).changeType,'moved');
});
test('hidden layers, mixed text formatting, external styles and variable values are scanned',async()=>{
 const {root,child,api}=fixture();child.visible=false;
 child.boundVariables={width:{type:'VARIABLE_ALIAS',id:'VariableID:1'}};let token=100,paint=0.5,weight=400;
 api.variables.getVariableByIdAsync=async()=>({name:'space',key:'V',codeSyntax:{WEB:'--space'},variableCollectionId:'C',resolveForConsumer:()=>({value:token,resolvedType:'FLOAT'})});
 child.fillStyleId='S';api.getStyleByIdAsync=async()=>({name:'Primary',type:'PAINT',key:'S',paints:[{type:'SOLID',opacity:paint}]});
 const text=node('1:3','TEXT',{parent:root,characters:'AB',fontSize:Symbol('mixed'),getStyledTextSegments:()=>[{start:0,end:1,characters:'A',fontWeight:weight},{start:1,end:2,characters:'B',fontWeight:700}]});root.children.push(text);
 const a=await P.capture(api,root,'FILE');token=120;paint=.8;weight=600;const b=await P.capture(api,root,'FILE');
 const r=C.diff(a,b);assert.equal(api.skipInvisibleInstanceChildren,false);
 assert.ok(r.items.find(i=>i.nodeId===child.id).changes.some(c=>c.property==='resolvedVariables'));
 assert.ok(r.items.find(i=>i.nodeId===child.id).changes.some(c=>c.property==='styleDefinitions'));
 assert.ok(r.items.find(i=>i.nodeId===text.id).changes.some(c=>c.property==='textSegments'));
});
test('instance overrides and inherited effective appearance changes are captured',async()=>{
 const {root,child,api}=fixture();const instance=node('1:3','INSTANCE',{parent:root,children:[child],componentProperties:{Size:{type:'VARIANT',value:'Small'}},getMainComponentAsync:async()=>({id:'2:1',name:'Button',key:'COMP',remote:true})});root.children=[instance];child.parent=instance;
 const a=await P.capture(api,root,'FILE');child.fills[0].color.r=.5;instance.componentProperties.Size.value='Large';const r=C.diff(a,await P.capture(api,root,'FILE'));
 assert.equal(r.items.length,2);assert.equal(r.items.find(i=>i.nodeId===instance.id).component.key,'COMP');
});
test('root canvas movement ignored; missing dependencies produce warnings',async()=>{
 const {root,child,api}=fixture();root.relativeTransform=[[1,0,10],[0,1,20]];const a=await P.capture(api,root,'FILE');root.relativeTransform=[[1,0,50],[0,1,70]];
 assert.equal(C.diff(a,await P.capture(api,root,'FILE')).items.length,0);
 child.fillStyleId='missing';assert.match((await P.capture(api,root,'FILE')).warnings.join(' '),/could not be resolved/);
});
test('file URL validation and Markdown escaping',async()=>{
 const {root,child,api}=fixture();assert.equal(C.fileKey('https://www.figma.com/design/Abc123/My-file?node-id=1-2'),'Abc123');
 for(const url of ['https://evil.com/design/KEY','javascript:alert(1)','https://figma.com.evil.com/design/KEY'])assert.throws(()=>C.fileKey(url));
 const a=await P.capture(api,root,'FILE');child.name='[bad](javascript:evil) <script>';const b=await P.capture(api,root,'FILE');const r=C.diff(a,b);
 assert.ok(C.markdown(r).includes('\\[bad\\]'));assert.throws(()=>C.diff(a,{...b,fileKey:'OTHER'}),/another section or file/);
});
test('variant definitions come from component set; unsupported getters on other nodes are not called',async()=>{
 const f=fixture();let invalidReads=0;
 const set=node('2:1','COMPONENT_SET',{parent:f.root,children:[],componentPropertyDefinitions:{State:{type:'VARIANT',defaultValue:'Default',variantOptions:['Default','Hover']}}});
 const variant=node('2:2','COMPONENT',{parent:set,children:[],key:'V'});
 Object.defineProperty(variant,'componentPropertyDefinitions',{get(){invalidReads++;throw new Error('Read definitions on component set');}});
 Object.defineProperty(f.child,'componentProperties',{get(){invalidReads++;throw new Error('Not an instance');}});
 Object.defineProperty(f.child,'componentPropertyDefinitions',{get(){invalidReads++;throw new Error('Not a component');}});
 set.children.push(variant);f.root.children.push(set);
 const a=await P.capture(f.api,f.root,'FILE');assert.equal(invalidReads,0);assert.equal(a.warnings.length,0);
 assert.equal(a.nodes[variant.id].props.componentDefinitionOwnerId,set.id);
 assert.equal(a.nodes[variant.id].props.componentPropertyDefinitions.State.defaultValue,'Default');
 set.componentPropertyDefinitions.State.defaultValue='Hover';const b=await P.capture(f.api,f.root,'FILE');
 assert.ok(C.diff(a,b).items.find(i=>i.nodeId===variant.id).changes.some(c=>c.property==='componentPropertyDefinitions'));
});
test('nested instance deprecated variant getter is never called; modern variant values are captured',async()=>{
 const f=fixture();let reads=0;
 const inst=node('I1481:404968;1283:215838;1103:38514','INSTANCE',{parent:f.root,children:[],componentProperties:{State:{type:'VARIANT',value:'Default'},'Label#1':{type:'TEXT',value:'Hello'}},getMainComponentAsync:async()=>({id:'3:1',key:'K',name:'Button',remote:true})});
 Object.defineProperty(inst,'variantProperties',{get(){reads++;throw new Error('Cannot read variantProperties on nested instance');}});
 f.root.children.push(inst);
 const a=await P.capture(f.api,f.root,'FILE');assert.equal(reads,0);assert.equal(a.warnings.length,0);
 assert.equal(C.stable(a.nodes[inst.id].props.variantProperties),C.stable({State:'Default'}));
 inst.componentProperties.State.value='Hover';const b=await P.capture(f.api,f.root,'FILE');
 assert.ok(C.diff(a,b).items[0].changes.some(c=>c.property==='variantProperties'&&c.after.State==='Hover'));
});
test('unavailable instance values leave explicit unknown variants and component variants remain guarded',async()=>{
 const f=fixture();let deprecatedReads=0;
 const inst=node('I1:3;2:4','INSTANCE',{parent:f.root,children:[],getMainComponentAsync:async()=>({id:'3:1',key:'K',name:'Button',remote:true})});
 Object.defineProperty(inst,'componentProperties',{get(){throw new Error('Nested values unavailable');}});
 Object.defineProperty(inst,'variantProperties',{get(){deprecatedReads++;throw new Error('Deprecated getter');}});
 const component=node('3:2','COMPONENT',{parent:f.root,children:[],componentPropertyDefinitions:{},key:'C'});
 Object.defineProperty(component,'variantProperties',{get(){throw new Error('Variant metadata unavailable');}});
 f.root.children.push(inst,component);const b=await P.capture(f.api,f.root,'FILE');assert.equal(deprecatedReads,0);
 assert.equal(b.nodes[inst.id].props.variantProperties.$unreadable,true);
 assert.equal(b.nodes[component.id].props.variantProperties.$unreadable,true);
 assert.equal(b.warnings.length,2);assert.ok(b.warnings.every(w=>w.startsWith('[component metadata]')));
});

/* ---- Mock API server: implements the v3 plugin routes in memory, with v3 problem errors. ---- */
const CAPTURE_VERSION=2; // server constant: rows stamped below this are reported stale by …/exists
const HASHES='/v3/files/FILE/hashes',EXISTS='/v3/files/FILE/exists',SYNC='/v3/files/FILE/sync',NEEDED='/v3/files/FILE/screens/references-needed';
const PROBLEMS={
 unauthorized:[401,'Missing bearer token','Send Authorization: Bearer <plugin token>.'],
 invalid_token:[401,'Invalid bearer token','Use a plugin token from RDS_PLUGIN_TOKENS (or the local tokens file).'],
 wrong_token_class:[403,'Wrong token class','The plugin routes are for the Figma plugin: use a plugin token (RDS_PLUGIN_TOKENS).'],
 invalid_parameter:[400,'Invalid parameter','Pass ?under=<scope root node id>.'],
 invalid_body:[400,'Invalid request body','Check the body against GET /v3/openapi.json.'],
 route_not_found:[404,'Route not found','See GET /v3/openapi.json for the routes.'],
 images_disabled:[409,'Images disabled','Send the request without images, or have an agent set storeImages to true with update_file_settings.'],
};
function problemBody(code,detail,hint){const [status,title,defaultHint]=PROBLEMS[code];return {type:'https://example.test/errors#'+code,title,status,code,detail,hint:hint===undefined?defaultHint:hint};}
/* `settings`: the file settings `…/hashes` returns (default `{trackLibraryComponents:true}`; null = an older server without them).
   `tokensMap: false` = an older server whose `?under=tokens` returns the root hash under "tokens" instead of the token map.
   `screens`: the `{ nodeId, designVersion }` list …/screens/references-needed returns (omitted = an older server without
   the screen routes: 404); `refuseImages: true` answers every reference upload with images_disabled.
   `legacy: true` = a server from before scope kinds and node maps: it refuses `scopeKind` and `nodeMap` (invalid_body).
   `kinds` records the scopeKind stored per fileKey|rootNodeId. */
function mockServer({token='secret',agentToken='agent',fail,settings,tokensMap,screens,refuseImages,legacy}={}) {
 const calls=[];const nodes=new Map();const kinds=new Map();// key fileKey|nodeId -> row
 const json=(status,body)=>({ok:status<300,status,json:async()=>body});
 const problem=(code,detail,hint)=>{const body=problemBody(code,detail,hint);return json(body.status,body);};
 const rowKey=(fileKey,id)=>fileKey+'|'+id;
 const subtree=(fileKey,rootId)=>[...nodes.values()].filter(r=>r.fileKey===fileKey&&(r.nodeId===rootId||r.path.includes(rootId)));
 const fetch=async(url,init)=>{
  const u=new URL(url);const body=init.body?JSON.parse(init.body):null;
  calls.push({path:u.pathname,method:init.method,query:Object.fromEntries(u.searchParams),body,auth:init.headers.Authorization,client:init.headers['X-RDS-Client'],bytes:init.body?init.body.length:0});
  if(fail&&fail(u.pathname,calls.length))throw new TypeError('Failed to fetch');
  const sm=screens&&/^\/v3\/files\/([^/]+)\/screens\/(?:(references-needed)|([^/]+)\/reference)$/.exec(u.pathname);
  if(sm){
   if(init.headers.Authorization!=='Bearer '+token)return problem('invalid_token','The bearer token is not recognized.');
   if(sm[2]&&init.method==='GET')return json(200,{screens:screens.map(s=>({...s}))});
   if(sm[3]&&init.method==='PUT'){
    const {nodeMap,...rest}=body||{};
    if(!body||typeof rest.designVersion!=='string'||typeof rest.image!=='string'||Object.keys(rest).length!==2)return problem('invalid_body','Body must be { designVersion, image, nodeMap? }.');
    if(nodeMap!==undefined){
     if(legacy)return problem('invalid_body',"body: unknown member 'nodeMap'.");
     const keys=['nodeId','mainNodeId','x','y','width','height','depth'];
     if(!Array.isArray(nodeMap)||!nodeMap.every(e=>e&&typeof e.nodeId==='string'&&(e.mainNodeId===undefined||typeof e.mainNodeId==='string')&&['x','y','width','height'].every(k=>Number.isInteger(e[k]))&&e.width>=0&&e.height>=0&&Number.isInteger(e.depth)&&e.depth>=0&&Object.keys(e).every(k=>keys.includes(k))))
      return problem('invalid_body','nodeMap entries must be { nodeId, mainNodeId?, x, y, width, height, depth }.');}
    if(refuseImages)return problem('images_disabled','File FILE does not store images (settings.storeImages is false).');
    return json(200,{fileKey:decodeURIComponent(sm[1]),nodeId:decodeURIComponent(sm[3]),designVersion:body.designVersion,current:true});}
   return problem('route_not_found',`No route ${init.method} ${u.pathname}.`);
  }
  const m=/^\/v3\/files\/([^/]+)\/(hashes|exists|sync)$/.exec(u.pathname);
  if(!m)return problem('route_not_found',`No route ${init.method} ${u.pathname}.`);
  if(!init.headers.Authorization)return problem('unauthorized','Missing bearer token.');
  if(init.headers.Authorization==='Bearer '+agentToken)return problem('wrong_token_class','This route requires a plugin token; an agent token was sent.');
  if(init.headers.Authorization!=='Bearer '+token)return problem('invalid_token','The bearer token is not recognized.');
  const fileKey=decodeURIComponent(m[1]),route=m[2];
  if((route==='hashes')!==(init.method==='GET'))return problem('route_not_found',`No route ${init.method} ${u.pathname}.`);
  if(body&&body.fileKey!==undefined&&body.fileKey!==fileKey)return problem('invalid_body',`body.fileKey '${body.fileKey}' does not match the file key '${fileKey}' in the path.`,'Drop fileKey from the body; the path names the file.');
  if(route==='hashes'){const under=u.searchParams.get('under');if(!under)return problem('invalid_parameter','querystring must have required property \'under\'.');
   const out={};for(const r of subtree(fileKey,under))if(!r.deletedAt)out[r.nodeId]=r.contentHash;
   if(under==='tokens'&&tokensMap!==false){out.tokens={};for(const r of subtree(fileKey,under))if(!r.deletedAt&&r.nodeId.startsWith('token:'))out.tokens[r.nodeId]={variableId:r.attrs.variableId,remote:r.attrs.remote===true,collectionId:r.parentId??null};}
   if(settings!==null)out.settings=settings===undefined?{trackLibraryComponents:true}:settings;return json(200,out);}
  if(route==='exists'){
   if(!body||!Array.isArray(body.nodeIds)||!body.nodeIds.every(id=>typeof id==='string'&&id))return problem('invalid_body','Body must be { nodeIds }.');
   if(body.nodeIds.length>5000)return problem('invalid_body','nodeIds must contain at most 5000 ids.','Split the ids into requests of at most 5000.');
   const present=[...new Set(body.nodeIds)].filter(id=>{const r=nodes.get(rowKey(fileKey,id));return r&&!r.deletedAt;});
   const stale=present.filter(id=>nodes.get(rowKey(fileKey,id)).captureVersion<CAPTURE_VERSION);return json(200,{present,stale});}
  if(!body||!Array.isArray(body.upserts)||!Array.isArray(body.deletedNodeIds))return problem('invalid_body','Body must be { upserts, deletedNodeIds }.');
  if(body.markImplemented!==undefined&&typeof body.markImplemented!=='boolean')return problem('invalid_body','markImplemented must be a boolean.');
  if(body.scopeKind!==undefined){
   if(legacy)return problem('invalid_body',"body: unknown member 'scopeKind'.");
   if(!['screens','components','none'].includes(body.scopeKind)||!body.rootNodeId)return problem('invalid_body','scopeKind must be screens, components or none, with rootNodeId.');
   kinds.set(rowKey(fileKey,body.rootNodeId),body.scopeKind);}
  let upserted=0,dirty=0,skippedInstances=0,tombstoned=0,baselined=0;
  for(const up of body.upserts){
   if(typeof up.nodeId!=='string'||typeof up.contentHash!=='string')return problem('invalid_body','upsert.nodeId and contentHash are required.');
   if(!Array.isArray(up.path))return problem('invalid_body','upsert.path must be an array.');
   if(up.isInstance!==undefined&&up.isInstance!==null&&typeof up.isInstance!=='boolean')return problem('invalid_body','upsert.isInstance must be a boolean.');
   if(up.mainComponentId!==undefined&&up.mainComponentId!==null&&(typeof up.mainComponentId!=='string'||!up.mainComponentId))return problem('invalid_body','upsert.mainComponentId must be a node id string or null.');
   const prev=nodes.get(rowKey(fileKey,up.nodeId));const baseline=!prev&&body.markImplemented===true;const implementedHash=prev?prev.implementedHash:baseline?up.contentHash:null;
   const row={fileKey,nodeId:up.nodeId,parentId:up.parentId,path:up.path,nodeType:up.nodeType,name:up.name,attrs:up.attrs,isInstance:up.isInstance===true||up.nodeType==='INSTANCE',mainComponentId:up.mainComponentId??null,contentHash:up.contentHash,implementedHash,dirty:up.contentHash!==implementedHash,deletedAt:null,captureVersion:CAPTURE_VERSION,library:!!(prev&&prev.library)||up.library===true,implementedCommit:prev?prev.implementedCommit:baseline?'baseline':null};
   nodes.set(rowKey(fileKey,up.nodeId),row);upserted++;if(row.dirty)dirty++;if(baseline)baselined++;}
  for(const id of body.deletedNodeIds){const r=nodes.get(rowKey(fileKey,id));if(r&&!r.deletedAt){r.deletedAt='now';r.dirty=true;tombstoned++;}}
  return json(200,{fileKey,upserted,dirty,tombstoned,skippedInstances,...(body.markImplemented===true?{baselined}:{})});
 };
 return {fetch,calls,nodes,kinds};
}
/* `choice` answers the "already built?" prompt like the UI would ('new' unless a test sets r.choice);
   `kind` answers the "Contains" prompt ('none', the UI's pre-selection, unless a test sets r.kind). */
function runtime(f,server,stored) {
 const messages=[];const storage=new Map(Object.entries(stored||{}));
 const out={choice:'new',kind:'none'};
 const api={...f.api,currentPage:{selection:[f.root]},showUI:()=>{},
  clientStorage:{getAsync:async k=>storage.get(k),setAsync:async(k,v)=>{storage.set(k,v);}},
  ui:{postMessage:m=>{messages.push(m);if(m.type==='yield')queueMicrotask(()=>api.ui.onmessage({type:'yield-ack',id:m.id}));
   if(m.type==='confirm-new-layers'&&out.choice)queueMicrotask(()=>api.ui.onmessage({type:'new-layers-choice',id:m.id,choice:out.choice}));
   if(m.type==='confirm-scope-kind'&&out.kind)queueMicrotask(()=>api.ui.onmessage({type:'scope-kind-choice',id:m.id,kind:out.kind}));}}};
 const ctx={figma:api,__html__:'',setTimeout,fetch:server.fetch,module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../code.js'),'utf8'),ctx);
 return Object.assign(out,{api,messages,storage,send:async m=>{messages.length=0;await api.ui.onmessage(m);return messages;}});
}
const SETTINGS={fds_upload_settings_v1:{baseUrl:'https://api.example.test',token:'secret'}};
const FILE='https://www.figma.com/design/FILE/Design';
const CFG={baseUrl:'https://api.example.test',token:'secret'};
const same=(a,b)=>assert.equal(C.stable(a),C.stable(b));// vm-context arrays are not reference-equal to ours
test('planDelta hashes each node with packages/core, classifies changed/new/deleted, records instances and skips their internals',async()=>{
 const f=fixture();const page=node('0:1','PAGE',{children:[f.root]});f.root.parent=page;
 const inst=node('1:3','INSTANCE',{parent:f.root,children:[],componentProperties:{Size:{type:'VARIANT',value:'Small'}},getMainComponentAsync:async()=>({id:'3:1',key:'K',name:'Button',remote:true})});
 const inner=node('I1:3;2:1','RECTANGLE',{parent:inst});inst.children.push(inner);f.root.children.push(inst);
 const snapshot=await P.capture(f.api,f.root,'FILE');same(snapshot.ancestors,[]);
 let plan=P.planDelta(snapshot,{});
 same(plan.upserts.map(u=>u.nodeId),['1:1','1:2','1:3']);same(plan.deletedNodeIds,[]);
 same(plan.counts,{scanned:4,tracked:3,changed:0,added:3,deleted:0,unchanged:0,instances:1,skippedInstances:1});
 const root=plan.upserts[0],child=plan.upserts[1],placement=plan.upserts[2];
 assert.equal(root.contentHash,C.contentHash(snapshot.nodes['1:1'].props));assert.equal(root.parentId,null);same(root.path,[]);
 assert.equal(child.parentId,'1:1');same(child.path,['1:1']);assert.equal(child.nodeType,'RECTANGLE');assert.equal(child.name,'RECTANGLE 1:2');
 assert.equal(C.stable(child.attrs),C.stable(snapshot.nodes['1:2'].props));assert.equal(child.isInstance,undefined);assert.equal(child.mainComponentId,undefined);
 assert.equal(placement.nodeType,'INSTANCE');assert.equal(placement.isInstance,true);assert.equal(placement.mainComponentId,'3:1');
 assert.equal(placement.parentId,'1:1');same(placement.path,['1:1']);assert.equal(placement.contentHash,C.contentHash(snapshot.nodes['1:3'].props));
 assert.equal(placement.attrs.childOrder,undefined);assert.equal(placement.attrs.componentProperties.Size.value,'Small');assert.equal(placement.attrs.componentReference.id,'3:1');
 const stored=Object.fromEntries(plan.upserts.map(u=>[u.nodeId,u.contentHash]));
 plan=P.planDelta(snapshot,stored);assert.equal(plan.upserts.length,0);assert.equal(plan.counts.unchanged,3);
 // Editing a layer inside the instance never dirties the placement; editing an override does.
 inner.width=999;plan=P.planDelta(await P.capture(f.api,f.root,'FILE'),stored);assert.equal(plan.upserts.length,0);
 inst.componentProperties.Size.value='Large';plan=P.planDelta(await P.capture(f.api,f.root,'FILE'),stored);same(plan.upserts.map(u=>u.nodeId),['1:3']);assert.equal(plan.counts.changed,1);
 inst.componentProperties.Size.value='Small';
 f.child.width=120;const gone={...stored,'1:9':'deadbeef'};plan=P.planDelta(await P.capture(f.api,f.root,'FILE'),gone);
 same(plan.upserts.map(u=>u.nodeId),['1:2']);
 same(plan.deletedNodeIds,['1:9']);
});
test('parent hash is unaffected by a child edit; ancestors above the scope are materialized into path',async()=>{
 const f=fixture();const section=node('0:5','SECTION',{children:[f.root]});const page=node('0:1','PAGE',{children:[section]});section.parent=page;f.root.parent=section;
 const a=await P.capture(f.api,f.root,'FILE');same(a.ancestors,['0:5']);
 const stored=Object.fromEntries(P.planDelta(a,{}).upserts.map(u=>[u.nodeId,u.contentHash]));
 f.child.width=120;const plan=P.planDelta(await P.capture(f.api,f.root,'FILE'),stored);
 same(plan.upserts.map(u=>u.nodeId),['1:2']);assert.equal(plan.counts.changed,1);assert.equal(plan.counts.unchanged,1);
 same(plan.upserts[0].path,['0:5','1:1']);
 const insideInstance=node('0:6','INSTANCE',{children:[f.root]});f.root.parent=insideInstance;
 await assert.rejects(P.capture(f.api,f.root,'FILE'),/inside a component instance/);
});
test('sync fetches stored hashes then posts only deltas + tombstones with the bearer token',async()=>{
 const f=fixture();const server=mockServer();const snapshot=await P.capture(f.api,f.root,'FILE');
 let out=await P.sync(server.fetch,{baseUrl:'https://api.example.test/',token:'secret'},snapshot);
 same(server.calls.map(c=>[c.method,c.path]),[['GET',HASHES],['POST',SYNC]]);
 same(server.calls[0].query,{under:'1:1'});assert.ok(server.calls.every(c=>c.auth==='Bearer secret'&&c.client==='plugin/'+PLUGIN_VERSION));
 same(server.calls[1].body.deletedNodeIds,[]);assert.equal(server.calls[1].body.fileKey,'FILE');
 assert.equal(out.added,2);assert.equal(out.changed,0);assert.equal(out.batches,1);same(out.result,{fileKey:'FILE',upserted:2,dirty:2,tombstoned:0,skippedInstances:0});
 server.calls.length=0;out=await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'));
 assert.equal(server.calls.length,1);assert.equal(out.batches,0);assert.equal(out.unchanged,2);assert.equal(out.result.upserted,0);
 f.root.children=[];server.calls.length=0;out=await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'));
 same(server.calls[1].body.upserts.map(u=>u.nodeId),['1:1']);same(server.calls[1].body.deletedNodeIds,['1:2']);
 assert.equal(out.changed,1);assert.equal(out.deleted,1);assert.equal(out.result.tombstoned,1);assert.equal(server.nodes.get('FILE|1:2').deletedAt,'now');
});
test('settings validation, auth failures, network failures and server errors surface as messages',async()=>{
 const f=fixture();const snapshot=await P.capture(f.api,f.root,'FILE');
 assert.throws(()=>P.validateSettings({baseUrl:'',token:'x'}),/API base URL/);
 assert.throws(()=>P.validateSettings({baseUrl:'ftp://x',token:'x'}),/API base URL/);
 assert.throws(()=>P.validateSettings({baseUrl:'https://api.example.test',token:' '}),/upload token/);
 assert.equal(C.stable(P.validateSettings({baseUrl:' https://api.example.test// ',token:' t '})),C.stable({baseUrl:'https://api.example.test',token:'t'}));
 await assert.rejects(P.sync(mockServer().fetch,{baseUrl:'https://api.example.test',token:'wrong'},snapshot),/rejected the upload token \(401\)/);
 await assert.rejects(P.sync(mockServer({fail:()=>true}).fetch,CFG,snapshot),/Could not reach the API at https:\/\/api.example.test/);
 await assert.rejects(P.sync(mockServer({fail:(p,n)=>n===2}).fetch,CFG,snapshot),/Could not reach the API/);
 const broken={fetch:async()=>({ok:false,status:400,json:async()=>({error:'bad_request',message:'upsert.path must be an array.'})})};
 await assert.rejects(P.sync(broken.fetch,CFG,snapshot),/Sync failed at \/v3\/files\/FILE\/hashes\?under=1%3A1: upsert.path must be an array/);
});
test('v3 problem errors show title and hint; 401/403 keep the upload-token guidance',async()=>{
 const f=fixture();const snapshot=await P.capture(f.api,f.root,'FILE');
 const invalid=await P.sync(mockServer().fetch,{...CFG,token:'wrong'},snapshot).catch(e=>e);
 assert.equal(invalid.message,'The API rejected the upload token (401). Check Settings.\nInvalid bearer token. Use a plugin token from RDS_PLUGIN_TOKENS (or the local tokens file).');
 const wrongClass=await P.sync(mockServer().fetch,{...CFG,token:'agent'},snapshot).catch(e=>e);
 assert.equal(wrongClass.message,'The API rejected the upload token (403). Check Settings.\nWrong token class. The plugin routes are for the Figma plugin: use a plugin token (RDS_PLUGIN_TOKENS).');
 const reply=(status,body)=>({fetch:async()=>({ok:false,status,json:async()=>body})});
 const rejected=await P.sync(reply(400,problemBody('invalid_body','upsert.path must be an array.')).fetch,CFG,snapshot).catch(e=>e);
 assert.equal(rejected.message,'Sync failed (400): Invalid request body. Check the body against GET /v3/openapi.json.');
 const noHint=await P.sync(reply(500,{...problemBody('invalid_body','boom',null),status:500,title:'Internal server error'}).fetch,CFG,snapshot).catch(e=>e);
 assert.equal(noHint.message,'Sync failed (500): Internal server error.');
 const bare=await P.sync(reply(401,null).fetch,CFG,snapshot).catch(e=>e);
 assert.equal(bare.message,'The API rejected the upload token (401). Check Settings.');
 const html=await P.sync(reply(502,null).fetch,CFG,snapshot).catch(e=>e);
 assert.equal(html.message,'Sync failed at /v3/files/FILE/hashes?under=1%3A1: HTTP 502');
});
test('the runtime shows a 401 problem to the user and uploads nothing',async()=>{
 const f=fixture();const server=mockServer();
 const r=runtime(f,server,{fds_upload_settings_v1:{baseUrl:'https://api.example.test',token:'revoked'}});
 await r.send({type:'upload',fileUrl:FILE});
 const error=r.messages.find(m=>m.type==='error');
 assert.match(error.message,/^The API rejected the upload token \(401\)\. Check Settings\.\nInvalid bearer token\. Use a plugin token from RDS_PLUGIN_TOKENS/);
 same(server.calls.map(c=>c.path),[HASHES]);assert.equal(server.nodes.size,0);
 assert.equal(r.messages.some(m=>m.type==='synced'),false);assert.equal(r.messages.filter(m=>m.type==='busy').at(-1).value,false);
});
test('every request goes to a v3 plugin route with X-RDS-Client: plugin/<package version>',async()=>{
 for(const file of ['../src/plugin.js','../code.js'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,file),'utf8'),/\/v[12]\//,file);
 assert.ok(fs.readFileSync(path.join(__dirname,'../code.js'),'utf8').includes('const PLUGIN_VERSION = '+JSON.stringify(PLUGIN_VERSION)+';'),'code.js is built from the current package version');
 const f=fixture();const lib=library(f);lib.instance('1:5',f.root,lib.define('8:1','Button'));
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(server.calls.map(c=>[c.method,c.path]),[['GET',HASHES],['POST',EXISTS],['POST',SYNC],['GET',HASHES],['GET',NEEDED]]);// ?under=tokens (no variables, no token upload), then the screens
 assert.ok(server.calls.every(c=>c.client==='plugin/'+PLUGIN_VERSION),JSON.stringify(server.calls.map(c=>c.client)));
 const src=mockServer();await P.sync(src.fetch,CFG,await P.capture(f.api,f.root,'FILE'));
 assert.ok(src.calls.length&&src.calls.every(c=>c.client==='plugin/'+PLUGIN_VERSION));
});
test('runtime persists settings in clientStorage and refuses to upload without them',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server);
 await r.send({type:'load-settings'});assert.equal(C.stable(r.messages.find(m=>m.type==='settings').settings),C.stable({baseUrl:'',token:''}));
 await r.send({type:'upload',fileUrl:FILE});assert.match(r.messages.find(m=>m.type==='error').message,/API base URL/);assert.equal(server.calls.length,0);
 await r.send({type:'save-settings',baseUrl:'https://api.example.test/',token:'secret'});
 assert.equal(C.stable(r.storage.get('fds_upload_settings_v1')),C.stable({baseUrl:'https://api.example.test',token:'secret'}));
 const again=runtime(f,server,Object.fromEntries(r.storage));await again.send({type:'load-settings'});
 assert.equal(again.messages.find(m=>m.type==='settings').settings.token,'secret');
 await again.send({type:'upload',fileUrl:'https://evil.com/design/KEY'});assert.match(again.messages.find(m=>m.type==='error').message,/figma\.com/i);assert.equal(server.calls.length,0);
});
test('runtime syncs and reports changed / new / deleted counts; second scan uploads only the delta',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 let done=r.messages.find(m=>m.type==='synced');assert.equal(done.added,2);assert.equal(done.changed,0);assert.equal(done.deleted,0);assert.equal(done.batches,1);
 assert.equal(done.result.upserted,2);assert.equal(done.result.dirty,2);
 assert.ok(r.messages.some(m=>m.type==='progress'&&m.phase==='Uploading'));
 assert.equal(r.messages.filter(m=>m.type==='busy').at(-1).value,false);
 f.child.width=150;const third=node('1:3','TEXT',{parent:f.root,characters:'New',getStyledTextSegments:()=>[],fontSize:14});f.root.children.push(third);
 server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});done=r.messages.find(m=>m.type==='synced');
 assert.equal(done.changed,2);assert.equal(done.added,1);assert.equal(done.deleted,0);assert.equal(done.unchanged,0);// root's childOrder changed, child width changed, text new
 same(server.calls[1].body.upserts.map(u=>u.nodeId).sort(),['1:1','1:2','1:3']);
 f.root.children=[third];server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});done=r.messages.find(m=>m.type==='synced');
 assert.equal(done.deleted,1);same(server.calls[1].body.deletedNodeIds,['1:2']);assert.equal(done.result.tombstoned,1);
 assert.equal(server.nodes.size,3);
});
test('instances are uploaded as placement rows; their descendants and nested instances are not',async()=>{
 const f=fixture();const inst=node('1:3','INSTANCE',{parent:f.root,children:[],componentProperties:{},getMainComponentAsync:async()=>({id:'3:1',key:'K',name:'Button',remote:true})});
 inst.children.push(node('I1:3;2:1','RECTANGLE',{parent:inst}));f.root.children.push(inst);
 const nested=node('I1:3;2:2','INSTANCE',{parent:inst,children:[],componentProperties:{},getMainComponentAsync:async()=>({id:'3:2',key:'K2',name:'Icon',remote:true})});
 nested.children.push(node('I1:3;2:2;2:3','VECTOR',{parent:nested}));inst.children.push(nested);
 const component=node('2:1','COMPONENT',{parent:f.root,children:[],componentPropertyDefinitions:{},key:'C'});f.root.children.push(component);
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.instances,1);assert.equal(done.skippedInstances,3);assert.equal(done.tracked,4);assert.equal(done.scanned,7);
 const batch=server.calls.find(c=>c.path===SYNC);
 same(batch.body.upserts.map(u=>u.nodeId).sort(),['1:1','1:2','1:3','2:1']);
 const placement=batch.body.upserts.find(u=>u.nodeId==='1:3');assert.equal(placement.isInstance,true);assert.equal(placement.mainComponentId,'3:1');assert.equal(placement.parentId,'1:1');
 assert.ok(batch.body.upserts.filter(u=>u.nodeId!=='1:3').every(u=>u.isInstance===undefined&&u.mainComponentId===undefined));
 assert.equal(server.nodes.get('FILE|1:3').mainComponentId,'3:1');assert.equal(server.nodes.has('FILE|I1:3;2:2'),false);assert.equal(done.result.skippedInstances,0);
 // Main-resolution is unchanged: both mains (outer + nested) are resolved; the remote mains cannot be imported in this mock: reported, not uploaded, not blocking.
 same(done.mains,{resolved:2,scanned:0,present:0,stale:0,unresolved:2,scannedNodes:0,librarySkipped:0});assert.match(done.warnings.join(' '),/\[main component\] 3:1/);assert.match(done.warnings.join(' '),/\[main component\] 3:2/);
});
test('unsaved settings sent with the upload are persisted and used',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server);
 await r.send({type:'upload',fileUrl:FILE,baseUrl:'https://api.example.test',token:'secret'});
 assert.ok(r.messages.some(m=>m.type==='synced'));assert.equal(r.storage.get('fds_upload_settings_v1').token,'secret');
});
test('12,051-node scan is chunked into multiple batches and yields progress',async()=>{
 const f=fixture();for(let n=3;n<=12051;n++){const child=node('1:'+n,'RECTANGLE',{parent:f.root});f.root.children.push(child);f.registry.set(child.id,child);}
 const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.equal(r.messages.some(m=>m.type==='error'),false,JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.added,12051);assert.ok(done.batches>1);assert.equal(done.result.upserted,12051);
 assert.ok(done.batches<=P.MAX_UPLOAD_BATCHES,`${done.batches} batches`);// caps grow so a big sync stays within the sync rate limit
 assert.ok(r.messages.some(m=>m.type==='progress'&&m.phase==='Scanning'&&m.count>10000));
 assert.ok(r.messages.some(m=>m.type==='progress'&&m.phase==='Uploading'));
 const batches=server.calls.filter(c=>c.path===SYNC);assert.equal(batches.length,done.batches);
 assert.ok(batches.every(c=>c.bytes<=2100000));assert.equal(server.nodes.size,12051);
 assert.ok(batches.every(c=>c.body.fileName==='Design file'&&c.body.rootNodeId==='1:1'));
});
test('a 1,000-node sync is sent in batches of at most 200 records and 250,000 chars, so the bar fills steadily',async t=>{
 assert.equal(P.BATCH_RECORDS,200);assert.equal(P.BATCH_CHARS,250000);
 const f=fixture();for(let n=3;n<=1000;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();const seen=[];
 const out=await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'),{progress:(phase,count,total)=>{if(phase==='Uploading')seen.push(count);}});
 const batches=server.calls.filter(c=>c.path===SYNC);
 t.diagnostic(`1,000-node sync: ${server.calls.length} requests (${batches.length} sync batches)`);
 assert.equal(server.calls.length,6);assert.equal(out.batches,5);same(seen,[0,200,400,600,800,1000]);
 assert.ok(batches.every(c=>c.body.upserts.length<=200&&JSON.stringify(c.body.upserts).length<=250000));
 const g=fixture();for(let n=3;n<=40;n++)g.root.children.push(node('1:'+n,'TEXT',{parent:g.root,characters:'x'.repeat(20000),getStyledTextSegments:()=>[]}));
 const big=mockServer();await P.sync(big.fetch,CFG,await P.capture(g.api,g.root,'FILE'));
 const bigBatches=big.calls.filter(c=>c.path===SYNC);assert.ok(bigBatches.length>1);
 assert.ok(bigBatches.every(c=>c.body.upserts.length===1||JSON.stringify(c.body.upserts).length<=250000));
});
test('deletions go in the first batch; the record cap grows past 200 when a sync would exceed MAX_UPLOAD_BATCHES',async()=>{
 const f=fixture();for(let n=3;n<=1000;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'));
 f.root.children.splice(500,300);f.child.width=1;server.calls.length=0;
 await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'));
 const batches=server.calls.filter(c=>c.path===SYNC);assert.equal(batches.length,1);assert.equal(batches[0].body.deletedNodeIds.length,300);
 const g=fixture();for(let n=3;n<=1000;n++)g.root.children.push(node('1:'+n,'RECTANGLE',{parent:g.root}));
 const capped=mockServer();const out=await P.sync(capped.fetch,CFG,await P.capture(g.api,g.root,'FILE'),{maxBatches:2});
 assert.equal(out.batches,2);same(capped.calls.filter(c=>c.path===SYNC).map(c=>c.body.upserts.length),[500,500]);
});
test('cancellation during scanning uploads nothing; cancellation before upload posts nothing',async()=>{
 const f=fixture();for(let n=3;n<=301;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();const r=runtime(f,server,SETTINGS);
 const post=r.api.ui.postMessage;r.api.ui.postMessage=m=>{post(m);if(m.type==='progress'&&m.phase==='Scanning')r.api.ui.onmessage({type:'cancel'});};
 await r.send({type:'upload',fileUrl:FILE});
 assert.match(r.messages.find(m=>m.type==='error').message,/cancelled/);assert.equal(server.calls.length,0);
 r.api.ui.postMessage=post;
 const snapshot=await P.capture(f.api,f.root,'FILE');let cancelled=false;
 await assert.rejects(P.sync(server.fetch,CFG,snapshot,{cancelled:()=>cancelled,progress:phase=>{if(phase==='Comparing')cancelled=true;}}),/cancelled/);
 same(server.calls.map(c=>c.method),['GET']);assert.equal(server.nodes.size,0);
 cancelled=false;server.calls.length=0;
 await assert.rejects(P.sync(server.fetch,CFG,snapshot,{batchChars:1000,cancelled:()=>cancelled,progress:(phase,count)=>{if(phase==='Uploading'&&count>0)cancelled=true;}}),/cancelled/);
 assert.equal(server.calls.filter(c=>c.path===SYNC).length,1);
});
test('blocking property read failures prevent upload; component metadata warnings do not',async()=>{
 const f=fixture();Object.defineProperty(f.child,'width',{get(){throw new Error('Failed layout read');}});
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.match(r.messages.find(m=>m.type==='error').message,/could not read width/);assert.equal(server.calls.length,0);
 const g=fixture();const inst=node('I1:3;2:4','INSTANCE',{parent:g.root,children:[],getMainComponentAsync:async()=>({id:'3:1',key:'K',name:'Icon',remote:true})});
 Object.defineProperty(inst,'componentProperties',{get(){throw new Error('Component properties unavailable for this nested instance');}});g.root.children.push(inst);
 const r2=runtime(g,mockServer(),SETTINGS);await r2.send({type:'upload',fileUrl:FILE});
 assert.ok(!r2.messages.some(m=>m.type==='error'));const done=r2.messages.find(m=>m.type==='synced');
 const metadata=done.warnings.filter(w=>!w.startsWith('[main component]'));
 assert.equal(metadata.length,1);assert.ok(metadata[0].startsWith('[component metadata]'));
});
test('unresolvable style and variable definitions warn but do not block the upload',async()=>{
 const f=fixture();f.child.fillStyleId='S:unpublished,1:2';
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),'no error');assert.ok(server.calls.length>0,'uploaded');
 const done=r.messages.find(m=>m.type==='synced');
 assert.ok(done.warnings.some(w=>w.startsWith('[token] ')&&/style S:unpublished,1:2 could not be resolved/.test(w)));
});
const verifyPhases=r=>[...new Set(r.messages.filter(m=>m.type==='progress'&&/^Verifying scan/.test(m.phase)).map(m=>m.phase))];
test('a one-off edit during verification is retried: the next pair of passes matches and is uploaded',async()=>{
 const f=fixture();for(let n=3;n<=201;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();const r=runtime(f,server,SETTINGS);
 const post=r.api.ui.postMessage;let edited=false;r.api.ui.postMessage=m=>{post(m);if(!edited&&m.type==='progress'&&m.phase==='Verifying scan'){edited=true;f.root.children.at(-1).width=999;}};
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(verifyPhases(r),['Verifying scan','Verifying scan (retry 1)']);
 assert.equal(server.nodes.get('FILE|1:201').attrs.width,999);
});
for(const kind of ['style','variable'])test(`a library ${kind} that resolves only after its first read succeeds after one retry`,async()=>{
 const f=fixture();let reads=0;
 if(kind==='style'){f.child.fillStyleId='S:lib,1:9';f.api.getStyleByIdAsync=async()=>++reads===1?null:{name:'Brand/Red',type:'PAINT',key:'SK',paints:[{type:'SOLID',color:{r:1,g:0,b:0}}]};}
 else{f.child.boundVariables={fills:[{type:'VARIABLE_ALIAS',id:'V:lib'}]};f.api.variables={getVariableByIdAsync:async()=>++reads===1?null:{name:'color/red',key:'VK',variableCollectionId:'VC:1',codeSyntax:{},resolveForConsumer:()=>({value:{r:1,g:0,b:0},resolvedType:'COLOR'}),resolvedType:'COLOR',valuesByMode:{m:{r:1,g:0,b:0}}},
  getVariableCollectionByIdAsync:async()=>({key:'CK',name:'Brand',modes:[{modeId:'m',name:'Default'}]})};}
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(verifyPhases(r),['Verifying scan','Verifying scan (retry 1)']);assert.equal(reads,kind==='style'?3:4);// + one token read
 const attrs=server.nodes.get('FILE|1:2').attrs;
 if(kind==='style')assert.equal(attrs.styleDefinitions['S:lib,1:9'].name,'Brand/Red');else assert.equal(attrs.resolvedVariables['V:lib'].name,'color/red');
 const done=r.messages.find(m=>m.type==='synced');assert.ok(!done.warnings.some(w=>w.startsWith('[token] ')),done.warnings.join(' '));
});
test('a value that changes on every pass fails after the retries, naming the node and up to 3 changed props',async()=>{
 const f=fixture();let n=0;for(const k of ['width','height','opacity','fills'])Object.defineProperty(f.child,k,{get(){n++;return k==='fills'?[{type:'SOLID',color:{r:n/1000,g:0,b:0}}]:n;}});
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.equal(P.VERIFY_RETRIES,2);
 same(verifyPhases(r),['Verifying scan','Verifying scan (retry 1)','Verifying scan (retry 2)']);
 assert.equal(r.messages.find(m=>m.type==='error').message,'Design kept changing while scanning: "RECTANGLE 1:2" (1:2) fills, height, opacity. If you aren\'t editing, a library style or font may still be loading — try again.');
 assert.equal(server.calls.length,0);
});
test('a layer removed while scanning still fails immediately, without retrying',async()=>{
 const f=fixture();let reads=0;Object.defineProperty(f.child,'removed',{get(){return ++reads>1;}});
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.equal(r.messages.find(m=>m.type==='error').message,'Design changed during scanning. Try again when editing is paused.');
 same(verifyPhases(r),[]);assert.equal(server.calls.length,0);
});
test('scanDifference names appearing / disappearing layers, counts the rest, and compares warnings',async()=>{
 const f=fixture();const a=await P.capture(f.api,f.root,'FILE');
 f.root.children.push(node('1:3','RECTANGLE',{parent:f.root}));const b=await P.capture(f.api,f.root,'FILE');
 assert.equal(P.scanDifference(a,a),null);
 assert.equal(P.scanDifference(a,b),'"SECTION 1:1" (1:1) childOrder (and 1 more layer)');
 assert.equal(P.scanDifference({...b,nodes:{...b.nodes,'1:1':a.nodes['1:1']}},a),'"RECTANGLE 1:3" (1:3) disappeared');
 assert.equal(P.scanDifference(a,{...a,warnings:['x']}),'the property-read warnings changed (x)');
});

/* ---- Main-component resolution (lazy, transitive, deduped). ---- */
/* Two pages: the scope lives on page 0:1; main components live on page 0:2, which is only
   reachable through getMainComponentAsync / getNodeByIdAsync (no loadAllPagesAsync). */
function library(f) {
 const page=node('0:1','PAGE',{children:[f.root]});f.root.parent=page;
 const components=node('0:2','PAGE',{children:[]});const loads=[];
 const registry=new Map(f.registry);
 const define=(id,name,build)=>{const main=node(id,'COMPONENT',{parent:components,children:[],key:'K'+id,name,remote:false,componentPropertyDefinitions:{}});
  components.children.push(main);registry.set(id,main);if(build)build(main);return main;};
 const instance=(id,parent,main)=>{const inst=node(id,'INSTANCE',{parent,children:[],componentProperties:{},getMainComponentAsync:async()=>main});parent.children.push(inst);return inst;};
 const api={...f.api,getNodeByIdAsync:async id=>{loads.push(id);return registry.get(id)||null;}};
 for(const n of [...registry.values()])n.parent=n.parent||null;
 return {page,components,registry,define,instance,api,loads};
}
test('instance whose main lives on another page: the main is lazily loaded and its non-instance nodes are uploaded, transitively',async()=>{
 const f=fixture();const lib=library(f);
 const icon=lib.define('9:1','Icon',m=>{const glyph=node('9:2','VECTOR',{parent:m});m.children.push(glyph);lib.registry.set(glyph.id,glyph);});
 const button=lib.define('8:1','Button',m=>{const label=node('8:2','TEXT',{parent:m,characters:'Go',getStyledTextSegments:()=>[],fontSize:12});m.children.push(label);lib.registry.set(label.id,label);});
 // Button contains an instance of Icon (nested main); the scope contains two instances of Button.
 lib.instance('8:3',button,icon);
 lib.instance('1:5',f.root,button);lib.instance('1:6',f.root,button);
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');
 same(done.mains,{resolved:2,scanned:2,present:0,stale:0,unresolved:0,scannedNodes:5,librarySkipped:0});// Button(3 incl. nested instance)+Icon(2)
 same(server.calls.map(c=>[c.method,c.path]),[['GET',HASHES],['POST',EXISTS],['POST',EXISTS],['POST',SYNC],['GET',HASHES],['GET',NEEDED]]);
 same(server.calls[1].body,{fileKey:'FILE',nodeIds:['8:1']});same(server.calls[2].body,{fileKey:'FILE',nodeIds:['9:1']});
 same([...server.nodes.keys()].sort(),['FILE|1:1','FILE|1:2','FILE|1:5','FILE|1:6','FILE|8:1','FILE|8:2','FILE|8:3','FILE|9:1','FILE|9:2']);
 for(const [id,main,parent] of [['1:5','8:1','1:1'],['1:6','8:1','1:1'],['8:3','9:1','8:1']]){const row=server.nodes.get('FILE|'+id);assert.equal(row.isInstance,true);assert.equal(row.mainComponentId,main);assert.equal(row.parentId,parent);}
 same(server.nodes.get('FILE|8:2').path,['8:1']);assert.equal(server.nodes.get('FILE|8:1').parentId,null);same(server.nodes.get('FILE|8:1').path,[]);same(server.nodes.get('FILE|8:3').path,['8:1']);
 same(lib.loads,['8:1','9:1']);// one lazy load per unique main; two Button instances -> one scan
 assert.ok(r.messages.some(m=>m.type==='progress'&&m.phase==='Checking main components'));
 assert.equal(done.warnings.length,0);
 // Second sync: both mains are present -> nothing re-scanned, nothing re-uploaded.
 lib.loads.length=0;server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 const again=r.messages.find(m=>m.type==='synced');same(again.mains,{resolved:1,scanned:0,present:1,stale:0,unresolved:0,scannedNodes:0,librarySkipped:0});// Icon is only reachable through Button, which is present
 same(server.calls.map(c=>c.path),[HASHES,EXISTS,HASHES,NEEDED]);same(lib.loads,[]);
 // Editing the present main is NOT picked up here (its own scope sync does that); a deleted row is re-scanned.
 server.nodes.get('FILE|8:1').deletedAt='now';server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 same(r.messages.find(m=>m.type==='synced').mains,{resolved:2,scanned:1,present:1,stale:0,unresolved:0,scannedNodes:3,librarySkipped:0});same(lib.loads,['8:1']);// Button re-scanned, Icon found present
});
test('a main already present in the DB is not re-scanned; mains inside the scope are not re-checked',async()=>{
 const f=fixture();const lib=library(f);
 const button=lib.define('8:1','Button');lib.instance('1:5',f.root,button);
 const local=node('1:7','COMPONENT',{parent:f.root,children:[],key:'KL',componentPropertyDefinitions:{}});f.root.children.push(local);lib.instance('1:8',f.root,local);
 const server=mockServer();
 await P.sync(server.fetch,CFG,{fileKey:'FILE',scopeId:'8:1',ancestors:[],nodes:{'8:1':{id:'8:1',name:'Button',type:'COMPONENT',props:{parentId:null}}},mains:{}});
 server.calls.length=0;
 const r=runtime({...f,api:lib.api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 const done=r.messages.find(m=>m.type==='synced');
 same(done.mains,{resolved:2,scanned:0,present:1,stale:0,unresolved:0,scannedNodes:0,librarySkipped:0});
 same(server.calls.find(c=>c.path===EXISTS).body.nodeIds,['8:1']);same(lib.loads,[]);
 same(server.calls.find(c=>c.path===SYNC).body.upserts.map(u=>u.nodeId).sort(),['1:1','1:2','1:5','1:7','1:8']);
});
test('a main stored before instance support is re-scanned and backfills its instance placements; current mains are skipped',async()=>{
 const f=fixture();const lib=library(f);
 const icon=lib.define('9:1','Icon',m=>{const glyph=node('9:2','VECTOR',{parent:m});m.children.push(glyph);lib.registry.set(glyph.id,glyph);});
 const button=lib.define('8:1','Button',m=>{const label=node('8:2','TEXT',{parent:m,characters:'Go',getStyledTextSegments:()=>[],fontSize:12});m.children.push(label);lib.registry.set(label.id,label);});
 lib.instance('8:3',button,icon);// Button holds an instance of Icon
 lib.instance('1:5',f.root,button);lib.instance('1:6',f.root,button);// two placements of the same main in the scope
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 // Rewrite Button as a pre-instance-support capture: older capture version, nested placement never recorded.
 server.nodes.get('FILE|8:1').captureVersion=1;server.nodes.delete('FILE|8:3');
 lib.loads.length=0;server.calls.length=0;
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');
 same(done.mains,{resolved:2,scanned:1,present:1,stale:1,unresolved:0,scannedNodes:3,librarySkipped:0});// stale Button re-scanned; Icon present and current
 same(lib.loads,['8:1']);// one load for the two Button placements (dedup)
 same(server.calls.map(c=>c.path),[HASHES,EXISTS,EXISTS,SYNC,HASHES,NEEDED]);
 same(server.calls[1].body.nodeIds,['8:1']);same(server.calls[2].body.nodeIds,['9:1']);// Icon is re-checked only because Button was re-scanned
 const placement=server.nodes.get('FILE|8:3');// the missing instance placement is backfilled
 assert.equal(placement.isInstance,true);assert.equal(placement.mainComponentId,'9:1');assert.equal(placement.parentId,'8:1');
 assert.equal(server.nodes.get('FILE|8:1').captureVersion,CAPTURE_VERSION);
 // Third sync: everything is current again, so nothing is re-scanned.
 lib.loads.length=0;server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 same(r.messages.find(m=>m.type==='synced').mains,{resolved:1,scanned:0,present:1,stale:0,unresolved:0,scannedNodes:0,librarySkipped:0});
 same(server.calls.map(c=>c.path),[HASHES,EXISTS,HASHES,NEEDED]);same(lib.loads,[]);
});
test('a problem while re-uploading a stale main is shown as title and hint; the stale row is left as it was',async()=>{
 const f=fixture();const lib=library(f);lib.instance('1:5',f.root,lib.define('8:1','Button'));
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});server.nodes.get('FILE|8:1').captureVersion=1;
 const fetch=server.fetch;let rejected=0;
 server.fetch=async(url,init)=>{if(new URL(url).pathname!==SYNC)return fetch(url,init);rejected++;const body=problemBody('invalid_body','upserts[0].attrs is too large.');return {ok:false,status:400,json:async()=>body};};
 const stale=runtime({...f,api:lib.api},{fetch:(...a)=>server.fetch(...a)},SETTINGS);server.calls.length=0;lib.loads.length=0;
 await stale.send({type:'upload',fileUrl:FILE});
 same(lib.loads,['8:1']);assert.equal(rejected,1);same(server.calls.map(c=>c.path),[HASHES,EXISTS]);
 assert.equal(stale.messages.find(m=>m.type==='error').message,'Sync failed (400): Invalid request body. Check the body against GET /v3/openapi.json.');
 assert.equal(stale.messages.some(m=>m.type==='synced'),false);assert.equal(server.nodes.get('FILE|8:1').captureVersion,1);
});
test('a stale main reached through a cycle is re-scanned once per run',async()=>{
 const f=fixture();const lib=library(f);
 const a=lib.define('7:1','A'),b=lib.define('7:2','B');
 lib.instance('7:3',a,b);lib.instance('7:4',b,a);// A -> B -> A
 lib.instance('1:5',f.root,a);
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 for(const id of ['7:1','7:2'])server.nodes.get('FILE|'+id).captureVersion=1;
 lib.loads.length=0;server.calls.length=0;
 await r.send({type:'upload',fileUrl:FILE});
 const done=r.messages.find(m=>m.type==='synced');
 same(done.mains,{resolved:2,scanned:2,present:0,stale:2,unresolved:0,scannedNodes:4,librarySkipped:0});
 same(lib.loads,['7:1','7:2']);// A re-scanned once even though B references it again
});
test('a reference cycle between mains terminates with one scan per main',async()=>{
 const f=fixture();const lib=library(f);
 const a=lib.define('7:1','A'),b=lib.define('7:2','B');
 lib.instance('7:3',a,b);lib.instance('7:4',b,a);lib.instance('7:5',b,a);// A -> B -> A (twice)
 lib.instance('1:5',f.root,a);
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');same(done.mains,{resolved:2,scanned:2,present:0,stale:0,unresolved:0,scannedNodes:5,librarySkipped:0});
 same(lib.loads,['7:1','7:2']);same([...server.nodes.keys()].sort(),['FILE|1:1','FILE|1:2','FILE|1:5','FILE|7:1','FILE|7:2','FILE|7:3','FILE|7:4','FILE|7:5']);
 assert.equal(server.calls.filter(c=>c.path===EXISTS).length,2);
});
test('remote library mains fall back to importComponentByKeyAsync; unresolvable mains warn without blocking',async()=>{
 const f=fixture();const lib=library(f);
 const remoteMain=node('R:1','COMPONENT',{children:[],key:'LIB',name:'Chip',remote:true,componentPropertyDefinitions:{}});
 const text=node('R:2','TEXT',{parent:remoteMain,characters:'x',getStyledTextSegments:()=>[],fontSize:10});remoteMain.children.push(text);
 lib.instance('1:5',f.root,{id:'R:1',key:'LIB',name:'Chip',remote:true,type:'COMPONENT'});// getMainComponentAsync stub, not traversable
 lib.instance('1:6',f.root,{id:'R:9',key:'GONE',name:'Missing',remote:true,type:'COMPONENT'});
 const imports=[];const api={...lib.api,importComponentByKeyAsync:async key=>{imports.push(key);if(key==='LIB')return remoteMain;throw new Error('not found');}};
 const server=mockServer();const r=runtime({...f,api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');same(done.mains,{resolved:2,scanned:1,present:0,stale:0,unresolved:1,scannedNodes:2,librarySkipped:0});
 same(imports,['LIB','GONE']);same([...server.nodes.keys()].sort(),['FILE|1:1','FILE|1:2','FILE|1:5','FILE|1:6','FILE|R:1','FILE|R:2']);
 assert.equal(server.nodes.get('FILE|1:6').mainComponentId,'R:9');// placement is recorded even when its main could not be loaded
 assert.equal(done.warnings.length,1);assert.match(done.warnings[0],/^\[main component\] R:9: main component "Missing" could not be loaded/);
});
test('unreadable properties inside a main block the upload; cancellation while resolving uploads nothing',async()=>{
 const f=fixture();const lib=library(f);
 const main=lib.define('8:1','Button',m=>{const bad=node('8:2','RECTANGLE',{parent:m});Object.defineProperty(bad,'width',{get(){throw new Error('boom');}});m.children.push(bad);});
 lib.instance('1:5',f.root,main);
 let server=mockServer();let r=runtime({...f,api:lib.api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.match(r.messages.find(m=>m.type==='error').message,/Main components not uploaded.*could not read width/);
 assert.equal(server.calls.filter(c=>c.path===SYNC).length,0);
 const g=fixture();const lib2=library(g);lib2.instance('1:5',g.root,lib2.define('8:1','Button'));
 server=mockServer();r=runtime({...g,api:lib2.api},server,SETTINGS);
 const post=r.api.ui.postMessage;r.api.ui.postMessage=m=>{post(m);if(m.type==='progress'&&m.phase==='Checking main components')r.api.ui.onmessage({type:'cancel'});};
 await r.send({type:'upload',fileUrl:FILE});
 assert.match(r.messages.find(m=>m.type==='error').message,/cancelled/);assert.equal(server.calls.filter(c=>c.path===SYNC).length,0);
});
test('existence checks are chunked to 1,000 ids per request',async()=>{
 const f=fixture();const lib=library(f);const server=mockServer();
 const mains={};for(let n=1;n<=1500;n++)mains['M:'+n]={id:'M:'+n,key:'K'+n,name:'M'+n,remote:false};
 const out=await P.resolveMains(lib.api,server.fetch,CFG,{fileKey:'FILE',nodes:{},mains});
 const checks=server.calls.filter(c=>c.path===EXISTS);assert.equal(checks.length,2);
 assert.equal(checks[0].body.nodeIds.length,1000);assert.equal(checks[1].body.nodeIds.length,500);
 assert.equal(out.counts.unresolved,1500);assert.equal(out.warnings.length,1500);assert.equal(out.upserts.length,0);
});

test('main-component checks report ids checked of ids to check',async()=>{
 const f=fixture();const lib=library(f);const server=mockServer();
 const mains={};for(let n=1;n<=1500;n++)mains['M:'+n]={id:'M:'+n,key:'K'+n,name:'M'+n,remote:false};
 const seen=[];await P.resolveMains(lib.api,server.fetch,CFG,{fileKey:'FILE',nodes:{},mains},{progress:(phase,count,total)=>seen.push([phase,count,total])});
 same(seen.filter(p=>p[0]==='Checking main components'),[['Checking main components',1000,1500],['Checking main components',1500,1500]]);
});
test('uploading reports nodes sent of the planned upserts + deletions, from 0 to the total',async()=>{
 const f=fixture();for(let n=3;n<=60;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();let snapshot=await P.capture(f.api,f.root,'FILE');
 const uploads=async()=>{const seen=[];const out=await P.sync(server.fetch,CFG,snapshot,{batchChars:1000,progress:(phase,count,total)=>{if(phase==='Uploading')seen.push([count,total]);}});return {seen,out};};
 let {seen,out}=await uploads();
 assert.ok(out.batches>1);assert.equal(seen.length,out.batches+1);
 same(seen[0],[0,60]);same(seen.at(-1),[60,60]);assert.ok(seen.every((p,i)=>p[1]===60&&(i===0||p[0]>seen[i-1][0])));
 f.root.children.splice(10,5);f.child.width=120;snapshot=await P.capture(f.api,f.root,'FILE');
 ({seen,out}=await uploads());assert.equal(out.deleted,5);
 const total=out.changed+out.added+out.deleted;same(seen[0],[0,total]);same(seen.at(-1),[total,total]);
 snapshot=await P.capture(f.api,f.root,'FILE');({seen,out}=await uploads());
 same(seen,[]);assert.equal(out.batches,0);// nothing to upload -> no Uploading progress
});
test('runtime sends the plugin version and progress totals where known',async()=>{
 const f=fixture();for(let n=3;n<=250;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();const r=runtime(f,server,SETTINGS);
 same(r.messages.find(m=>m.type==='version'),{type:'version',version:PLUGIN_VERSION});
 await r.send({type:'upload',fileUrl:FILE});
 const progress=r.messages.filter(m=>m.type==='progress');
 assert.ok(progress.filter(m=>m.phase==='Scanning').every(m=>!('total' in m)));
 assert.ok(progress.filter(m=>m.phase==='Verifying scan').every(m=>m.total===250));
 const up=progress.filter(m=>m.phase==='Uploading');same(up.at(-1),{type:'progress',phase:'Uploading',count:250,total:250});
});

/* ---- First-scan baseline ("code already matches this design"). ---- */
test('markImplemented is sent on every scope and main batch of the run and baselined is summed across batches',async()=>{
 const f=fixture();const lib=library(f);
 const button=lib.define('8:1','Button',m=>{const label=node('8:2','TEXT',{parent:m,characters:'Go',getStyledTextSegments:()=>[],fontSize:12});m.children.push(label);lib.registry.set(label.id,label);});
 lib.instance('1:5',f.root,button);
 for(let n=10;n<30;n++){const c=node('1:'+n,'RECTANGLE',{parent:f.root});f.root.children.push(c);f.registry.set(c.id,c);}
 const server=mockServer();
 const out=await P.sync(server.fetch,CFG,await P.capture(lib.api,f.root,'FILE'),{api:lib.api,markImplemented:true,batchChars:1500});
 const batches=server.calls.filter(c=>c.path===SYNC);
 assert.ok(batches.length>2,String(batches.length));assert.equal(batches.length,out.batches);
 assert.ok(batches.every(c=>c.body.markImplemented===true));
 assert.ok(batches.some(c=>c.body.upserts.some(u=>u.nodeId==='8:1')),'resolved-main upserts are batched with the flag');
 assert.equal(out.markImplemented,true);assert.equal(out.result.upserted,25);assert.equal(out.result.baselined,25);assert.equal(out.result.dirty,0);
 assert.ok([...server.nodes.values()].every(r=>!r.dirty&&r.implementedCommit==='baseline'));
 // Re-sync with an edit and a new node, flag still on: the edit stays queued, only the never-seen node is baselined.
 f.child.width=321;const fresh=node('1:40','RECTANGLE',{parent:f.root});f.root.children.push(fresh);f.registry.set(fresh.id,fresh);
 server.calls.length=0;const again=await P.sync(server.fetch,CFG,await P.capture(lib.api,f.root,'FILE'),{api:lib.api,markImplemented:true,batchChars:1500});
 assert.ok(server.calls.filter(c=>c.path===SYNC).every(c=>c.body.markImplemented===true));
 assert.equal(again.result.baselined,1);assert.equal(server.nodes.get('FILE|1:2').dirty,true);assert.equal(server.nodes.get('FILE|1:40').dirty,false);
});
test('markImplemented is false on every batch when not requested; baselined is not reported',async()=>{
 const f=fixture();for(let n=10;n<30;n++)f.root.children.push(node('1:'+n,'RECTANGLE',{parent:f.root}));
 const server=mockServer();const out=await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'),{batchChars:1500});
 const batches=server.calls.filter(c=>c.path===SYNC);assert.ok(batches.length>1);
 assert.ok(batches.every(c=>c.body.markImplemented===false));
 assert.equal(out.markImplemented,false);assert.equal(out.result.baselined,undefined);assert.equal(out.result.dirty,22);
});
test('runtime passes the per-run checkbox choice through and never writes it to clientStorage',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server);
 await r.send({type:'upload',fileUrl:FILE,baseUrl:'https://api.example.test',token:'secret',markImplemented:true});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 let done=r.messages.find(m=>m.type==='synced');assert.equal(done.markImplemented,true);assert.equal(done.result.baselined,2);assert.equal(done.result.dirty,0);
 assert.equal(server.calls.find(c=>c.path===SYNC).body.markImplemented,true);
 same([...r.storage.keys()],['fds_upload_settings_v1']);same(r.storage.get('fds_upload_settings_v1'),{baseUrl:'https://api.example.test',token:'secret'});
 await r.send({type:'save-settings',baseUrl:'https://api.example.test',token:'secret',markImplemented:true});
 same([...r.storage.keys()],['fds_upload_settings_v1']);same(r.storage.get('fds_upload_settings_v1'),{baseUrl:'https://api.example.test',token:'secret'});
 // Omitted (unchecked) on the next run: the flag goes out as false.
 f.child.width=222;server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 done=r.messages.find(m=>m.type==='synced');assert.equal(done.markImplemented,false);assert.equal(done.result.dirty,1);
 assert.equal(server.calls.find(c=>c.path===SYNC).body.markImplemented,false);
});
const BATCH_KEYS=['deletedNodeIds','fileKey','fileName','markImplemented','rootNodeId','upserts'];
test('every scope and resolved-main batch carries fileName and rootNodeId; the rest of the payload is unchanged',async()=>{
 const f=fixture();const lib=library(f);
 const button=lib.define('8:1','Button',m=>{const label=node('8:2','TEXT',{parent:m,characters:'Go',getStyledTextSegments:()=>[],fontSize:12});m.children.push(label);lib.registry.set(label.id,label);});
 lib.instance('1:5',f.root,button);
 for(let n=10;n<30;n++){const c=node('1:'+n,'RECTANGLE',{parent:f.root});f.root.children.push(c);f.registry.set(c.id,c);}
 const snapshot=await P.capture(lib.api,f.root,'FILE');
 const withMeta=mockServer();await P.sync(withMeta.fetch,CFG,snapshot,{api:lib.api,fileName:'Design file',batchChars:1500});
 const without=mockServer();await P.sync(without.fetch,CFG,snapshot,{api:lib.api,batchChars:1500});
 const batches=withMeta.calls.filter(c=>c.path===SYNC),plain=without.calls.filter(c=>c.path===SYNC);
 assert.ok(batches.length>2,String(batches.length));
 assert.ok(batches.some(c=>c.body.upserts.some(u=>u.nodeId==='8:1')),'resolved-main upserts are batched with the metadata');
 for(const [i,c] of batches.entries()){
  same(Object.keys(c.body).sort(),BATCH_KEYS);assert.equal(c.body.fileName,'Design file');assert.equal(c.body.rootNodeId,'1:1');
  const {fileName,rootNodeId,...rest}=c.body;const {rootNodeId:plainRoot,...plainRest}=plain[i].body;
  assert.equal(plainRoot,'1:1');assert.equal(plain[i].body.fileName,undefined);same(rest,plainRest);
 }
 same(withMeta.calls.filter(c=>c.path!==SYNC),without.calls.filter(c=>c.path!==SYNC));
});
test('runtime sends figma.root.name and the selected scope id with every batch',async()=>{
 const f=fixture();const lib=library(f);lib.instance('1:5',f.root,lib.define('8:1','Button'));
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const batches=server.calls.filter(c=>c.path===SYNC);assert.equal(batches.length,1);
 assert.ok(batches.some(c=>c.body.upserts.some(u=>u.nodeId==='8:1')));
 assert.ok(batches.every(c=>C.stable(Object.keys(c.body).sort())===C.stable(BATCH_KEYS.concat('scopeKind').sort())&&c.body.fileName==='Design file'&&c.body.rootNodeId==='1:1'&&c.body.scopeKind==='none'));
 assert.ok(server.calls.filter(c=>c.path!==SYNC).every(c=>!c.body||(c.body.fileName===undefined&&c.body.rootNodeId===undefined)));
});

/* ---- Library components: the file's trackLibraryComponents setting and the library flag. ---- */
function libraryScope(){
 const f=fixture();const lib=library(f);
 const button=lib.define('8:1','Button',m=>{const label=node('8:2','TEXT',{parent:m,characters:'Go',getStyledTextSegments:()=>[],fontSize:12});m.children.push(label);lib.registry.set(label.id,label);});
 const set=node('R:0','COMPONENT_SET',{children:[],key:'LIBSET',name:'Chips',remote:true,componentPropertyDefinitions:{}});
 const chip=node('R:1','COMPONENT',{parent:set,children:[],key:'LIB',name:'Chip',remote:true,variantProperties:{Size:'S'}});set.children.push(chip);
 const text=node('R:2','TEXT',{parent:chip,characters:'x',getStyledTextSegments:()=>[],fontSize:10});chip.children.push(text);
 lib.instance('1:5',f.root,button);lib.instance('1:6',f.root,chip);lib.instance('1:7',f.root,chip);
 const imports=[];const api={...lib.api,importComponentByKeyAsync:async key=>{imports.push(key);return key==='LIB'?chip:null;}};
 return {f,lib,api,imports};
}
test('trackLibraryComponents on: remote mains are imported and every record under them carries library: true',async()=>{
 const {f,api,imports}=libraryScope();const server=mockServer({settings:{trackLibraryComponents:true}});
 const r=runtime({...f,api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.trackLibraryComponents,true);
 same(done.mains,{resolved:2,scanned:2,present:0,stale:0,unresolved:0,scannedNodes:4,librarySkipped:0});
 same(imports,[]);// the instance already handed us the remote main; no import needed
 const upserts=server.calls.filter(c=>c.path===SYNC).flatMap(c=>c.body.upserts);
 same(upserts.filter(u=>u.library).map(u=>u.nodeId).sort(),['R:1','R:2']);
 assert.ok(upserts.filter(u=>!u.library).every(u=>!('library' in u)),'library is only sent when true');
 same([...server.nodes.values()].filter(n=>n.library).map(n=>n.nodeId).sort(),['R:1','R:2']);
 // `settings` is not a node: a repeat sync uploads and deletes nothing.
 server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 const again=r.messages.find(m=>m.type==='synced');assert.equal(again.deleted,0);assert.equal(again.added+again.changed,0);
 assert.ok(server.calls.filter(c=>c.path===SYNC).every(c=>!c.body.deletedNodeIds.includes('settings')));
});
test('trackLibraryComponents off: remote mains are not imported or scanned; placements keep their full reference; local mains still scanned',async()=>{
 const {f,lib,api,imports}=libraryScope();const server=mockServer({settings:{trackLibraryComponents:false}});
 const r=runtime({...f,api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.trackLibraryComponents,false);
 same(done.mains,{resolved:1,scanned:1,present:0,stale:0,unresolved:0,scannedNodes:2,librarySkipped:1});
 same(imports,[]);same(done.warnings,[]);assert.ok(!lib.loads.some(id=>id.startsWith('R:')),'remote mains are not loaded');
 assert.ok(server.calls.filter(c=>c.path===EXISTS).every(c=>!c.body.nodeIds.includes('R:1')),'remote mains are not checked');
 same([...server.nodes.keys()].sort(),['FILE|1:1','FILE|1:2','FILE|1:5','FILE|1:6','FILE|1:7','FILE|8:1','FILE|8:2']);
 const placement=server.nodes.get('FILE|1:6');assert.equal(placement.mainComponentId,'R:1');assert.equal(placement.library,false);
 same(placement.attrs.componentReference,{id:'R:1',key:'LIB',name:'Chip',remote:true,set:{id:'R:0',key:'LIBSET',name:'Chips'}});
});
test('settings missing from the hashes response (older server): library components are tracked as before',async()=>{
 const {f,api,imports}=libraryScope();const server=mockServer({settings:null});
 const out=await P.sync(server.fetch,CFG,await P.capture(api,f.root,'FILE'),{api});
 assert.equal(out.trackLibraryComponents,true);same(imports,['LIB']);assert.equal(out.mains.librarySkipped,0);
 same([...server.nodes.values()].filter(n=>n.library).map(n=>n.nodeId).sort(),['R:1','R:2']);
 for(const settings of [{},{trackLibraryComponents:'no'}]){
  const again=libraryScope();const s2=mockServer({settings});
  assert.equal((await P.sync(s2.fetch,CFG,await P.capture(again.api,again.f.root,'FILE'),{api:again.api})).trackLibraryComponents,true);
 }
});
test('planDelta flags records under a remote main inside the scope and leaves library records out of the layer counts',async()=>{
 const f=fixture();
 const set=node('R:0','COMPONENT_SET',{parent:f.root,children:[],key:'S',name:'Chips',remote:true,componentPropertyDefinitions:{}});
 const chip=node('R:1','COMPONENT',{parent:set,children:[],key:'LIB',name:'Chip',remote:true});set.children.push(chip);
 const local=node('3:1','COMPONENT',{parent:f.root,children:[],key:'L',name:'Local',remote:false});f.root.children.push(set,local);
 const plan=P.planDelta(await P.capture(f.api,f.root,'FILE'),{});
 same(plan.upserts.filter(u=>u.library).map(u=>u.nodeId),['R:0','R:1']);same(plan.layers,{tracked:3,added:3});
 same(P.planDelta(await P.capture(f.api,f.root,'FILE'),{},{library:true}).layers,{tracked:0,added:0});
});
test('the library-not-tracked count is deduplicated across instances and nested mains',async()=>{
 const f=fixture();const lib=library(f);const server=mockServer({settings:{trackLibraryComponents:false}});
 const remote=id=>({id,key:'K'+id,name:'Lib '+id,remote:true,type:'COMPONENT'});
 const card=lib.define('8:1','Card');lib.instance('8:3',card,remote('R:1'));lib.instance('8:4',card,remote('R:2'));
 lib.instance('1:5',f.root,card);lib.instance('1:6',f.root,remote('R:1'));lib.instance('1:7',f.root,remote('R:1'));
 const out=await P.sync(server.fetch,CFG,await P.capture(lib.api,f.root,'FILE'),{api:lib.api});
 same(out.mains,{resolved:1,scanned:1,present:0,stale:0,unresolved:0,scannedNodes:3,librarySkipped:2});
});

/* ---- "Already built?" prompt. ---- */
function rectangles(f,from,to){for(let n=from;n<to;n++){const c=node('1:'+n,'RECTANGLE',{parent:f.root});f.root.children.push(c);f.registry.set(c.id,c);}}
test('the prompt thresholds are named constants: at least 25 new layers and at least half of the scope',()=>{
 assert.equal(P.NEW_LAYERS_MIN,25);assert.equal(P.NEW_LAYERS_SHARE,0.5);
});
test('prompt asks only for at least 25 never-seen layers that are at least half of the scope',async()=>{
 const run=async(f,server)=>{const asked=[];await P.sync(server.fetch,CFG,await P.capture(f.api,f.root,'FILE'),{confirmNewLayers:async l=>{asked.push(l);return 'new';}});return asked;};
 let f=fixture();rectangles(f,10,32);// 24 layers
 same(await run(f,mockServer()),[]);
 f=fixture();rectangles(f,10,33);// 25 layers
 const server=mockServer();same(await run(f,server),[{added:25,total:25}]);
 rectangles(f,100,124);same(await run(f,server),[]);// 24 new of 49
 rectangles(f,200,248);same(await run(f,server),[]);// 48 new of 97: 25+ but under half
 rectangles(f,300,397);same(await run(f,server),[{added:97,total:194}]);// exactly half
});
function bigScope(){const f=fixture();rectangles(f,10,38);return f;}// 30 layers (root + child + 28), all new
for(const [choice,markImplemented] of [['implemented',true],['new',false]])
test(`prompt choice "${choice}" uploads with markImplemented: ${markImplemented}`,async()=>{
 const f=bigScope();const server=mockServer();const r=runtime(f,server,SETTINGS);r.choice=choice;
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const ask=r.messages.find(m=>m.type==='confirm-new-layers');assert.equal(ask.added,30);assert.equal(ask.total,30);assert.equal(typeof ask.id,'number');
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.markImplemented,markImplemented);
 const syncs=server.calls.filter(c=>c.path===SYNC);assert.ok(syncs.length>0);
 assert.ok(syncs.every(c=>c.body.markImplemented===markImplemented||(!markImplemented&&!c.body.markImplemented)));
 assert.equal(done.result.dirty,markImplemented?0:30);
});
test('prompt choice "cancel" stops before uploading: notice, no sync call, nothing stored',async()=>{
 const f=bigScope();const server=mockServer();const r=runtime(f,server,SETTINGS);r.choice='cancel';
 await r.send({type:'upload',fileUrl:FILE});
 same(r.messages.filter(m=>m.type==='notice'||m.type==='error').map(m=>[m.type,m.message]),[['notice','Sync cancelled. Nothing was uploaded.']]);
 assert.ok(!r.messages.some(m=>m.type==='synced'));same(server.calls.map(c=>c.path),[HASHES]);assert.equal(server.nodes.size,0);
 assert.equal(r.messages.filter(m=>m.type==='busy').pop().value,false);
});
test('Cancel while the prompt is open cancels the sync, and the plugin is ready for the next upload',async()=>{
 const f=bigScope();const server=mockServer();const r=runtime(f,server,SETTINGS);r.choice=null;
 const asked=new Promise(res=>{const post=r.api.ui.postMessage;r.api.ui.postMessage=m=>{post(m);if(m.type==='confirm-new-layers')res(m);};});
 const run=r.api.ui.onmessage({type:'upload',fileUrl:FILE});
 await asked;await r.api.ui.onmessage({type:'cancel'});await run;
 assert.ok(r.messages.some(m=>m.type==='notice'&&/Nothing was uploaded/.test(m.message)));same(server.calls.map(c=>c.path),[HASHES]);
 r.choice='new';await r.send({type:'upload',fileUrl:FILE});assert.ok(r.messages.some(m=>m.type==='synced'));
});
test('no prompt when "Code already matches this design" is ticked, nor for small or repeat syncs',async()=>{
 let f=bigScope();let server=mockServer();let r=runtime(f,server,SETTINGS);r.choice=null;
 await r.send({type:'upload',fileUrl:FILE,markImplemented:true});
 assert.ok(!r.messages.some(m=>m.type==='confirm-new-layers'));assert.equal(r.messages.find(m=>m.type==='synced').markImplemented,true);
 await r.send({type:'upload',fileUrl:FILE});// nothing new now
 assert.ok(!r.messages.some(m=>m.type==='confirm-new-layers'));assert.ok(r.messages.some(m=>m.type==='synced'));
});
test('main-component and library records do not count toward the prompt',async()=>{
 const f=fixture();const lib=library(f);rectangles(f,10,31);// 23 scope layers + instance below = 24
 const big=lib.define('8:1','Big',m=>{for(let n=0;n<40;n++){const c=node('8:'+(100+n),'RECTANGLE',{parent:m});m.children.push(c);lib.registry.set(c.id,c);}});
 lib.instance('1:5',f.root,big);
 const server=mockServer();const asked=[];
 const out=await P.sync(server.fetch,CFG,await P.capture(lib.api,f.root,'FILE'),{api:lib.api,confirmNewLayers:async l=>{asked.push(l);return 'new';}});
 same(asked,[]);assert.equal(out.mains.scannedNodes,41);
});
/* ---- Design tokens: every used + local variable (and its aliases) as a node of the `tokens` scope. ---- */
const K=c=>c.repeat(40),T=c=>'token:'+K(c),COL=c=>'tokens:'+K(c);
const rgb=(r,g,b,a)=>a===undefined?{r,g,b}:{r,g,b,a};
function tokenFile(f){
 const cols=new Map(),vars=new Map(),locals=[];
 const collection=(id,key,name,modes,remote=false)=>{const c={id,key:K(key),name,remote,modes:modes.map((n,i)=>({modeId:id+'/'+i,name:n}))};cols.set(id,c);return c;};
 const variable=(id,key,name,col,values,extra={})=>{const c=cols.get(col);const type=extra.resolvedType||'COLOR';
  const v={id,key:K(key),name,resolvedType:type,description:'',scopes:['ALL_SCOPES'],codeSyntax:{},variableCollectionId:col,remote:c.remote,
   valuesByMode:Object.fromEntries(values.map((x,i)=>[c.modes[i].modeId,x])),resolveForConsumer:()=>({value:values[0],resolvedType:type}),...extra};
  vars.set(id,v);if(!c.remote)locals.push(id);return v;};
 const set=(id,mode,value)=>{const v=vars.get(id);const c=cols.get(v.variableCollectionId);v.valuesByMode[c.modes.find(m=>m.name===mode).modeId]=value;};
 f.api.variables={getVariableByIdAsync:async id=>vars.get(id)||null,getVariableCollectionByIdAsync:async id=>cols.get(id)||null,
  getLocalVariablesAsync:async()=>locals.filter(id=>vars.has(id)).map(id=>vars.get(id))};
 return {cols,vars,collection,variable,set};
}
const alias=id=>({type:'VARIABLE_ALIAS',id});
/* Local Semantic (Light/Dark) + Numbers; remote Primitives with a used, an aliased (chain gray -> base) and an unused variable. */
function tokenScene(f){
 const t=tokenFile(f);
 t.collection('C:sem','a','Semantic',['Light','Dark']);t.collection('C:num','c','Numbers',['Default']);t.collection('C:pri','b','Primitives',['Mode 1'],true);
 t.variable('V:base','5','gray/base','C:pri',[rgb(1,1,1)]);t.variable('V:gray','3','gray/900','C:pri',[alias('V:base')]);
 t.variable('V:unused','6','gray/100','C:pri',[rgb(.9,.9,.9)]);t.variable('V:used','7','brand/red','C:pri',[rgb(1,0,0,.5)]);
 t.variable('V:active','1','bg/active','C:sem',[rgb(1,1,1),rgb(32/255,37/255,39/255)],{codeSyntax:{WEB:'--bg-active'},description:'Pressed'});
 t.variable('V:hover','2','bg/hover','C:sem',[rgb(1,1,1),alias('V:gray')]);
 t.variable('V:space','8','space/unit','C:num',[1.23456],{resolvedType:'FLOAT',scopes:['GAP']});
 t.variable('V:font','9','font/family','C:num',['Inter'],{resolvedType:'STRING'});
 t.variable('V:flag','d','flag/beta','C:num',[true],{resolvedType:'BOOLEAN'});
 f.child.boundVariables={fills:[alias('V:used')]};
 return t;
}
const TOKEN_IDS=[T('1'),T('2'),T('3'),T('5'),T('7'),T('8'),T('9'),T('d')];
const tokenSyncs=server=>server.calls.filter(c=>c.path===SYNC&&c.body.rootNodeId==='tokens');
const tokenCounts=t=>({tracked:t.tracked,changed:t.changed,added:t.added,unchanged:t.unchanged,deleted:t.deleted});
test('tokens: used, local and transitively aliased variables are collected with every mode value, normalized; unused library variables are not',async()=>{
 const f=fixture();tokenScene(f);
 const scan=await P.capture(f.api,f.root,'FILE');
 const c=await P.collectTokens(f.api,Object.values(scan.nodes).map(n=>n.props));
 same(Object.keys(c.nodes).sort(),[...TOKEN_IDS,COL('a'),COL('b'),COL('c')].sort());
 same(c.nodes[T('1')],{nodeId:T('1'),parentId:COL('a'),path:['tokens',COL('a')],nodeType:'VARIABLE',name:'bg/active',
  attrs:{name:'bg/active',resolvedType:'COLOR',description:'Pressed',scopes:['ALL_SCOPES'],codeSyntax:{WEB:'--bg-active'},variableId:'V:active',remote:false,'value:Light':'#ffffff','value:Dark':'#202527'}});
 same(c.nodes[COL('a')],{nodeId:COL('a'),parentId:'tokens',path:['tokens'],nodeType:'VARIABLE_COLLECTION',name:'Semantic',attrs:{name:'Semantic',modes:['Light','Dark'],remote:false}});
 same(c.nodes[COL('b')].attrs,{name:'Primitives',modes:['Mode 1'],remote:true});
 same(c.nodes[T('2')].attrs['value:Dark'],{alias:T('3'),name:'gray/900'});
 same(c.nodes[T('3')].attrs['value:Mode 1'],{alias:T('5'),name:'gray/base'});// chain followed into the library
 assert.equal(c.nodes[T('5')].attrs['value:Mode 1'],'#ffffff');
 assert.equal(c.nodes[T('7')].attrs['value:Mode 1'],'#ff000080');assert.equal(c.nodes[T('7')].attrs.remote,true);// used by a layer only
 assert.equal(c.nodes[T('8')].attrs['value:Default'],1.2346);same(c.nodes[T('8')].attrs.scopes,['GAP']);
 assert.equal(c.nodes[T('9')].attrs['value:Default'],'Inter');assert.equal(c.nodes[T('d')].attrs['value:Default'],true);
 assert.equal(c.nodes[T('6')],undefined);
 same(c.warnings,[]);same([...c.gone],[]);
});
test('tokens: unreadable values are recorded as { $unreadable: true } with a non-blocking [token] warning',async()=>{
 const f=fixture();const t=tokenScene(f);
 t.set('V:hover','Light',alias('V:missing'));delete t.vars.get('V:active').valuesByMode['C:sem/1'];
 Object.defineProperty(t.vars.get('V:flag'),'valuesByMode',{get(){throw new Error('no access');}});
 const scan=await P.capture(f.api,f.root,'FILE');
 const c=await P.collectTokens(f.api,Object.values(scan.nodes).map(n=>n.props));
 same(c.nodes[T('2')].attrs['value:Light'],{$unreadable:true});same(c.nodes[T('1')].attrs['value:Dark'],{$unreadable:true});
 same(c.nodes[T('d')].attrs['value:Default'],{$unreadable:true});
 assert.ok(c.warnings.length>=3&&c.warnings.every(w=>w.startsWith('[token] ')),c.warnings.join(' | '));
 const server=mockServer();const r=runtime(f,server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');assert.ok(done.warnings.some(w=>w.startsWith('[token] ')));
 same(server.nodes.get('FILE|'+T('2')).attrs['value:Light'],{$unreadable:true});
});
test('tokens: a sync uploads the tokens scope as a second pass; a re-sync re-sends only the root; a Dark-mode edit dirties only that token',async()=>{
 const f=fixture();const t=tokenScene(f);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(server.calls.map(c=>[c.path,c.query.under||c.body.rootNodeId]),[[HASHES,'1:1'],[SYNC,'1:1'],[HASHES,'tokens'],[SYNC,'tokens'],[NEEDED,'1:1']]);
 const done=r.messages.find(m=>m.type==='synced');
 same(tokenCounts(done.tokens),{tracked:8,changed:0,added:8,unchanged:0,deleted:0});assert.equal(done.tokens.batches,1);
 same(tokenSyncs(server)[0].body.upserts.map(u=>u.nodeId),['tokens',COL('a'),COL('b'),COL('c'),...TOKEN_IDS]);
 assert.equal(server.nodes.get('FILE|tokens').nodeType,'TOKENS');assert.equal(server.nodes.get('FILE|tokens').parentId,null);
 same(server.nodes.get('FILE|'+T('1')).path,['tokens',COL('a')]);assert.equal(server.nodes.get('FILE|'+T('1')).dirty,true);
 const up=r.messages.filter(m=>m.type==='progress'&&m.phase==='Uploading tokens');same(up.map(m=>[m.count,m.total]),[[0,12],[12,12]]);
 // Layers keep storing the consumer value; the token scope is separate from the layer scope.
 assert.equal(server.nodes.get('FILE|1:2').attrs.resolvedVariables['V:used'].name,'brand/red');
 for(const row of server.nodes.values()){row.implementedHash=row.contentHash;row.dirty=false;}
 r.messages.length=0;server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 const again=r.messages.find(m=>m.type==='synced');same(tokenCounts(again.tokens),{tracked:8,changed:0,added:0,unchanged:8,deleted:0});
 same(tokenSyncs(server).map(c=>[c.body.upserts.map(u=>u.nodeId),c.body.deletedNodeIds]),[[['tokens'],[]]]);
 t.set('V:active','Dark',rgb(43/255,48/255,51/255));
 r.messages.length=0;server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 const edited=r.messages.find(m=>m.type==='synced');same(tokenCounts(edited.tokens),{tracked:8,changed:1,added:0,unchanged:7,deleted:0});
 assert.equal(edited.changed,0);// no layer is dirtied by a token value change
 same(tokenSyncs(server)[0].body.upserts.map(u=>u.nodeId),['tokens',T('1')]);
 same([...server.nodes.values()].filter(row=>row.dirty).map(row=>row.nodeId),[T('1')]);
 assert.equal(server.nodes.get('FILE|'+T('1')).attrs['value:Dark'],'#2b3033');
});
test('tokens: only variables gone from Figma are deleted; unreferenced variables stay; a collection goes once all its tokens are gone',async()=>{
 const f=fixture();const t=tokenScene(f);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 f.child.boundVariables=undefined;t.vars.delete('V:font');// brand/red is no longer used but still exists; font/family is deleted
 server.calls.length=0;r.messages.length=0;await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(tokenSyncs(server)[0].body.deletedNodeIds,[T('9')]);
 assert.equal(server.nodes.get('FILE|'+T('7')).deletedAt,null);assert.equal(server.nodes.get('FILE|'+T('9')).deletedAt,'now');
 same(tokenCounts(r.messages.find(m=>m.type==='synced').tokens),{tracked:7,changed:0,added:0,unchanged:7,deleted:1});
 t.vars.delete('V:space');t.vars.delete('V:flag');
 server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 same(tokenSyncs(server)[0].body.deletedNodeIds,[T('8'),T('d'),COL('c')]);
 assert.equal(server.nodes.get('FILE|'+COL('a')).deletedAt,null);
});
test('tokens: a stored variable that cannot be checked is kept, and so is its collection',async()=>{
 const f=fixture();const t=tokenScene(f);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 const get=f.api.variables.getVariableByIdAsync;t.vars.delete('V:font');t.vars.delete('V:space');t.vars.delete('V:flag');
 f.api.variables.getVariableByIdAsync=async id=>{if(id==='V:flag')throw new Error('offline');return get(id);};
 server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 same(tokenSyncs(server)[0].body.deletedNodeIds,[T('8'),T('9')]);
});
test('tokens: a token collected in this sync is never deleted, even when its stored id is stale',async()=>{
 const f=fixture();tokenScene(f);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 server.nodes.get('FILE|'+T('7')).attrs.variableId='V:stale-used';server.nodes.get('FILE|'+T('1')).attrs.variableId='V:stale-active';
 server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 same(tokenSyncs(server)[0].body.deletedNodeIds,[]);
 for(const id of [T('1'),T('7')])assert.equal(server.nodes.get('FILE|'+id).deletedAt,null,id);
});
test('tokens: library tokens not collected are never deleted, nor their collection, even when their stored ids no longer resolve',async()=>{
 const f=fixture();const t=tokenScene(f);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 // Nothing reaches Primitives any more; brand/red's stored id is a stale import and gray/base is gone from the library.
 f.child.boundVariables=undefined;t.set('V:hover','Dark',rgb(0,0,0));
 server.nodes.get('FILE|'+T('7')).attrs.variableId='V:stale-used';t.vars.delete('V:base');
 server.calls.length=0;r.messages.length=0;await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(tokenSyncs(server)[0].body.deletedNodeIds,[]);
 for(const id of [T('3'),T('5'),T('7'),COL('b')])assert.equal(server.nodes.get('FILE|'+id).deletedAt,null,id);
});
test('tokens: a local token is deleted only when it is absent from the listed local variables',async()=>{
 const f=fixture();const t=tokenScene(f);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 t.vars.delete('V:font');f.api.variables.getLocalVariablesAsync=async()=>{throw new Error('offline');};
 server.calls.length=0;r.messages.length=0;await r.send({type:'upload',fileUrl:FILE});
 same(tokenSyncs(server)[0].body.deletedNodeIds,[]);assert.equal(server.nodes.get('FILE|'+T('9')).deletedAt,null);
 assert.ok(r.messages.find(m=>m.type==='synced').warnings.some(w=>/local variables could not be listed/.test(w)));
});
test('tokens: an older server without the token map gets no token deletions',async()=>{
 const f=fixture();const t=tokenScene(f);const server=mockServer({tokensMap:false});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});t.vars.delete('V:font');
 server.calls.length=0;r.messages.length=0;await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(tokenSyncs(server)[0].body.deletedNodeIds,[]);assert.equal(server.nodes.get('FILE|'+T('9')).deletedAt,null);
 same(tokenSyncs(server)[0].body.upserts.map(u=>u.nodeId),['tokens']);
});
test('tokens: markImplemented baselines never-seen tokens too; the already-built prompt counts layers only',async()=>{
 const f=fixture();const t=tokenScene(f);
 for(let i=0;i<40;i++)t.variable('V:x'+i,'e'+String(i).padStart(2,'0').replace(/./g,'')+i,'x/'+i,'C:num',[i],{resolvedType:'FLOAT',key:'x'.repeat(30)+String(i).padStart(10,'0')});
 const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='confirm-new-layers'),'48 new tokens never trigger the layer prompt');
 assert.equal(r.messages.find(m=>m.type==='synced').tokens.tracked,48);
 for(const row of server.nodes.values())if(row.nodeId.startsWith('token'))server.nodes.delete('FILE|'+row.nodeId);
 r.messages.length=0;server.calls.length=0;await r.send({type:'upload',fileUrl:FILE,markImplemented:true});
 assert.equal(tokenSyncs(server)[0].body.markImplemented,true);
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.tokens.result.baselined,48+3+1);
 assert.ok([...server.nodes.values()].filter(row=>row.nodeId.startsWith('token')).every(row=>!row.dirty));
});
test('tokens: uploads are batched like layers, every batch with rootNodeId "tokens", deletions in the first',async()=>{
 const f=fixture();const t=tokenScene(f);
 for(let i=0;i<60;i++)t.variable('V:x'+i,'x','x/'+i,'C:num',['value '+i],{resolvedType:'STRING',key:'x'.repeat(30)+String(i).padStart(10,'0')});
 const server=mockServer();const snapshot=await P.capture(f.api,f.root,'FILE');
 await P.sync(server.fetch,CFG,snapshot,{api:f.api});t.vars.delete('V:font');
 server.calls.length=0;t.set('V:x0','Default','edited');for(let i=1;i<60;i++)t.set('V:x'+i,'Default','edited '+i);
 const phases=[];const result=await P.sync(server.fetch,CFG,snapshot,{api:f.api,batchChars:1500,progress:(phase,count,total)=>phases.push([phase,count,total])});
 const batches=tokenSyncs(server);assert.ok(batches.length>2,String(batches.length));assert.equal(result.tokens.batches,batches.length);
 same(batches.map(c=>c.body.deletedNodeIds.length),[1,...batches.slice(1).map(()=>0)]);
 assert.ok(batches.every(c=>c.body.fileName===undefined||typeof c.body.fileName==='string'));
 assert.equal(batches.reduce((n,c)=>n+c.body.upserts.length,0),61);// root + 60 edited
 const up=phases.filter(p=>p[0]==='Uploading tokens');same(up[0],['Uploading tokens',0,62]);same(up.at(-1),['Uploading tokens',62,62]);
 assert.ok(up.every((p,i)=>!i||p[1]>up[i-1][1]));
});
test('tokens: a file without variables uploads no tokens',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 same(tokenSyncs(server),[]);same(tokenCounts(r.messages.find(m=>m.type==='synced').tokens),{tracked:0,changed:0,added:0,unchanged:0,deleted:0});
});
test('tokens: variables bound inside a scanned main component are collected',async()=>{
 const f=fixture();const t=tokenScene(f);f.child.boundVariables=undefined;const lib=library(f);
 const button=lib.define('8:1','Button',m=>{const label=node('8:2','RECTANGLE',{parent:m,boundVariables:{fills:[alias('V:used')]}});m.children.push(label);lib.registry.set(label.id,label);});
 lib.instance('1:5',f.root,button);
 const server=mockServer();const r=runtime({...f,api:lib.api},server,SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 assert.ok(server.nodes.get('FILE|'+T('7')),'brand/red is used only inside the main');
});

/* ---- Screen references: configured screens are exported at 1x and uploaded after the layer and token passes. ---- */
const REF=id=>'/v3/files/FILE/screens/'+encodeURIComponent(id)+'/reference';
const refPuts=server=>server.calls.filter(c=>c.method==='PUT');
/* Adds exportable screens under the fixture root; `exports` records every exportAsync call in order. */
function screenScene(f,specs) {
 const exports=[];
 for(const [id,extra={}] of specs){
  const s=node(id,extra.type||'FRAME',{parent:f.root,children:[],width:extra.width||390,height:extra.height||844,...extra.props,
   exportAsync:async settings=>{exports.push({id,settings});if(extra.fail)throw new Error(extra.fail);return extra.bytes||new Uint8Array([137,80,78,71,id.length]);}});
  f.root.children.push(s);f.registry.set(id,s);
 }
 return exports;
}
const b64=bytes=>Buffer.from(bytes).toString('base64');
test('screens: an empty references-needed list exports and uploads nothing',async()=>{
 const f=fixture();const exports=screenScene(f,[['1:5']]);const server=mockServer({screens:[]});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');
 same(done.references,{needed:0,updated:0,skipped:0,warnings:[]});
 assert.equal(exports.length,0);same(refPuts(server),[]);
 assert.equal(server.calls.filter(c=>c.path===NEEDED).length,1);same(server.calls.find(c=>c.path===NEEDED).query,{under:'1:1'});
 assert.ok(!r.messages.some(m=>m.type==='progress'&&m.phase==='Exporting check targets'));
});
test('screens: two configured screens are exported as 1x PNGs and uploaded one at a time with their designVersion',async()=>{
 const f=fixture();const exports=screenScene(f,[['1:5'],['1:6',{type:'COMPONENT'}],['1:7']]);
 const server=mockServer({screens:[{nodeId:'1:5',designVersion:'v-five'},{nodeId:'1:6',designVersion:'v-six'}]});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(exports.map(e=>e.id),['1:5','1:6']);
 assert.ok(exports.every(e=>C.stable(e.settings)===C.stable({format:'PNG',constraint:{type:'SCALE',value:1}})));
 const puts=refPuts(server);same(puts.map(c=>c.path),[REF('1:5'),REF('1:6')]);
 same(puts.map(c=>c.body),[{designVersion:'v-five',image:b64([137,80,78,71,3]),nodeMap:[]},{designVersion:'v-six',image:b64([137,80,78,71,3]),nodeMap:[]}]);
 assert.ok(puts.every(c=>c.auth==='Bearer secret'&&c.client==='plugin/'+PLUGIN_VERSION));
 // The reference pass runs after the layer and token passes.
 const order=server.calls.map(c=>c.path);assert.ok(order.lastIndexOf(SYNC)<order.indexOf(NEEDED));
 same(r.messages.filter(m=>m.type==='progress'&&m.phase==='Exporting check targets').map(m=>[m.count,m.total]),[[0,2],[1,2],[2,2]]);
 const done=r.messages.find(m=>m.type==='synced');same(done.references,{needed:2,updated:2,skipped:0,warnings:[]});
});
test('screens: figma.base64Encode is used when the runtime provides it',async()=>{
 const f=fixture();screenScene(f,[['1:5']]);f.api.base64Encode=bytes=>'encoded:'+bytes.length;
 const server=mockServer({screens:[{nodeId:'1:5',designVersion:'v1'}]});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 same(refPuts(server).map(c=>c.body.image),['encoded:5']);
});
test('screens: missing, wrong-type, oversize and failed exports are skipped with non-blocking warnings; the rest upload',async()=>{
 const f=fixture();
 const exports=screenScene(f,[['1:5'],['1:6',{width:8193,height:600}],['1:7',{props:{absoluteRenderBounds:{x:0,y:0,width:400,height:9000}}}],
  ['1:8',{bytes:new Uint8Array(P.EXPORT_MAX_BYTES+1)}],['1:9',{type:'GROUP'}],['1:10',{fail:'Export failed'}]]);
 const list=['1:404','1:6','1:7','1:8','1:9','1:10','1:5'].map(nodeId=>({nodeId,designVersion:'v:'+nodeId}));
 const server=mockServer({screens:list});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(exports.map(e=>e.id),['1:8','1:10','1:5']);// oversize sides are refused before exporting
 same(refPuts(server).map(c=>[c.path,c.body.designVersion]),[[REF('1:5'),'v:1:5']]);
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.references.updated,1);assert.equal(done.references.skipped,6);
 const warnings=done.warnings.filter(w=>w.startsWith('[screen] '));assert.equal(warnings.length,6);
 assert.match(warnings[0],/1:404: screen no longer exists/);
 assert.match(warnings[1],/\(1:6\) is 8193 × 600 px, over 8192 px per side/);
 assert.match(warnings[2],/\(1:7\) is 400 × 9000 px/);
 assert.match(warnings[3],/\(1:8\) exports to 5\.0 MB, over 5 MB/);
 assert.match(warnings[4],/1:9: screen is a GROUP, not a frame, component or instance/);
 assert.match(warnings[5],/\(1:10\) could not be exported: Export failed/);
 same(r.messages.filter(m=>m.type==='progress'&&m.phase==='Exporting check targets').at(-1),{type:'progress',phase:'Exporting check targets',count:7,total:7});
});
test('screens: an older server without the screen routes (404) is a silent no-op',async()=>{
 const f=fixture();const exports=screenScene(f,[['1:5']]);const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.references,null);
 assert.equal(exports.length,0);same(refPuts(server),[]);assert.ok(!done.warnings.some(w=>w.startsWith('[screen] ')));
});
test('screens: other errors listing the screens fail the sync with the problem text',async()=>{
 const f=fixture();screenScene(f,[['1:5']]);const server=mockServer({screens:[]});
 const fetch=async(url,init)=>new URL(url).pathname===NEEDED?{ok:false,status:500,json:async()=>({title:'Internal error',status:500,code:'internal'})}:server.fetch(url,init);
 const r=runtime(f,{...server,fetch},SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.match(r.messages.find(m=>m.type==='error').message,/Sync failed \(500\): Internal error\./);
});
test('screens: Cancel between exports stops before the next export',async()=>{
 const f=fixture();const exports=screenScene(f,[['1:5'],['1:6'],['1:7']]);
 const server=mockServer({screens:['1:5','1:6','1:7'].map(nodeId=>({nodeId,designVersion:'v'}))});const r=runtime(f,server,SETTINGS);
 const post=r.api.ui.postMessage;r.api.ui.postMessage=m=>{post(m);if(m.type==='progress'&&m.phase==='Exporting check targets'&&m.count===1)r.api.ui.onmessage({type:'cancel'});};
 await r.send({type:'upload',fileUrl:FILE});
 assert.match(r.messages.find(m=>m.type==='error').message,/cancelled/);
 same(exports.map(e=>e.id),['1:5']);same(refPuts(server).map(c=>c.path),[REF('1:5')]);
 assert.equal(r.messages.filter(m=>m.type==='busy').at(-1).value,false);
});
test('screens: a file that stores no images stops the pass with one warning',async()=>{
 const f=fixture();const exports=screenScene(f,[['1:5'],['1:6']]);
 const server=mockServer({screens:['1:5','1:6'].map(nodeId=>({nodeId,designVersion:'v'})),refuseImages:true});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(exports.map(e=>e.id),['1:5']);assert.equal(refPuts(server).length,1);
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.references.updated,0);assert.equal(done.references.skipped,2);
 same(done.warnings.filter(w=>w.startsWith('[screen] ')),['[screen] This file does not store images (file setting), so no screen references were uploaded.']);
});
test('screens: P.sync skips the reference pass without the Figma api or with references: false',async()=>{
 const f=fixture();screenScene(f,[['1:5']]);const server=mockServer({screens:[{nodeId:'1:5',designVersion:'v'}]});
 const snapshot=await P.capture(f.api,f.root,'FILE');
 let out=await P.sync(server.fetch,CFG,snapshot);assert.equal(out.references,null);
 out=await P.sync(server.fetch,CFG,snapshot,{api:f.api,tokens:false,references:false});assert.equal(out.references,null);
 assert.ok(!server.calls.some(c=>c.path===NEEDED));
 out=await P.sync(server.fetch,CFG,snapshot,{api:f.api,tokens:false});assert.equal(out.references.updated,1);
});

/* ---- Scope kinds: what the section contains, saved as shared plugin data and sent with the sync. ---- */
const kindOf=n=>n.getSharedPluginData('rds','scopeKind');
test('scope kind: the first sync asks once, saves the answer on the section and sends it with every batch',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server,SETTINGS);r.kind='screens';
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const asked=r.messages.filter(m=>m.type==='confirm-scope-kind');assert.equal(asked.length,1);
 assert.equal(asked[0].name,f.root.name);assert.equal(asked[0].scopeId,'1:1');
 assert.equal(kindOf(f.root),'screens');assert.ok(r.messages.some(m=>m.type==='scope'&&m.scopeKind==='screens'));
 const batches=server.calls.filter(c=>c.path===SYNC);assert.ok(batches.length>=1);assert.ok(batches.every(c=>c.body.scopeKind==='screens'));
 assert.equal(server.kinds.get('FILE|1:1'),'screens');assert.equal(r.messages.find(m=>m.type==='synced').scopeKind,'screens');
 // Declared: not asked again; nothing changed and the kind is already stored, so no batch is sent.
 server.calls.length=0;await r.send({type:'upload',fileUrl:FILE});
 assert.equal(r.messages.filter(m=>m.type==='confirm-scope-kind').length,0);assert.equal(server.calls.filter(c=>c.path===SYNC).length,0);
 // Editable any time: saved on the section at once; the next sync sends it even with no layer changes.
 server.calls.length=0;await r.send({type:'set-scope-kind',kind:'components'});
 assert.equal(kindOf(f.root),'components');assert.ok(r.messages.some(m=>m.type==='scope'&&m.scopeKind==='components'));same(server.calls,[]);
 await r.send({type:'upload',fileUrl:FILE});
 const sent=server.calls.filter(c=>c.path===SYNC);assert.equal(sent.length,1);
 same(sent[0].body.upserts,[]);same(sent[0].body.deletedNodeIds,[]);assert.equal(sent[0].body.scopeKind,'components');
 assert.equal(server.kinds.get('FILE|1:1'),'components');
 await r.send({type:'set-scope-kind',kind:'pages'});
 assert.ok(r.messages.some(m=>m.type==='error'));assert.equal(kindOf(f.root),'components');
});
test('scope kind: cancelling the first-sync prompt uploads nothing and leaves the section undeclared',async()=>{
 const f=fixture();const server=mockServer();const r=runtime(f,server,SETTINGS);r.kind='cancel';
 await r.send({type:'upload',fileUrl:FILE});
 same(server.calls,[]);assert.equal(kindOf(f.root),'');
 assert.equal(r.messages.find(m=>m.type==='notice').message,'Sync cancelled. Nothing was uploaded.');
});
test('scope kind: a kind already saved on the section (it travels with the file) is sent without asking',async()=>{
 const f=fixture();f.root.setSharedPluginData('rds','scopeKind','components');const server=mockServer();const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.equal(r.messages.filter(m=>m.type==='confirm-scope-kind').length,0);
 assert.ok(server.calls.filter(c=>c.path===SYNC).every(c=>c.body.scopeKind==='components'));assert.equal(server.kinds.get('FILE|1:1'),'components');
});
/* An exportable target outside the scanned scope, with nested layers and Figma-style absolute boxes. */
function mappedTarget(f){
 const exports=[];const box=(x,y,width,height)=>({absoluteBoundingBox:{x,y,width,height}});
 const target=node('2:1','FRAME',{children:[],...box(100.4,200.6,390,844),width:390,height:844,
  exportAsync:async settings=>{exports.push(settings);return new Uint8Array([137,80,78,71]);}});
 const rect=node('2:2','RECTANGLE',{parent:target,...box(110.6,210.2,50.5,20.4)});
 const hidden=node('2:3','GROUP',{parent:target,visible:false,children:[],...box(120,220,10,10)});
 hidden.children.push(node('2:4','RECTANGLE',{parent:hidden,...box(120,220,10,10)}));
 const instance=node('2:5','INSTANCE',{parent:target,children:[],...box(100.4,300,80,40)});
 const label=node('I2:5;4:2','FRAME',{parent:instance,children:[],...box(104.4,304.6,10,10)});
 const nested=node('I2:5;4:3;6:7','TEXT',{parent:label,...box(110.4,310.6,5,5)});
 const hiddenSub=node('I2:5;4:9','TEXT',{parent:instance,visible:false,...box(104,304,1,1)});
 label.children.push(nested);instance.children.push(label,hiddenSub);target.children.push(rect,hidden,instance);
 f.registry.set(target.id,target);
 return exports;
}
const MAPPED=[
 {nodeId:'2:1',x:0,y:0,width:390,height:844,depth:0},
 {nodeId:'2:2',x:10,y:10,width:51,height:20,depth:1},
 {nodeId:'2:5',x:0,y:99,width:80,height:40,depth:1},
 {nodeId:'I2:5;4:2',mainNodeId:'4:2',x:4,y:104,width:10,height:10,depth:2},
 {nodeId:'I2:5;4:3;6:7',mainNodeId:'6:7',x:10,y:110,width:5,height:5,depth:3}];
test('check targets: an auto target from references-needed is exported once at 1x and uploaded with its node map',async()=>{
 const f=fixture();const exports=mappedTarget(f);screenScene(f,[['1:5']]);
 const server=mockServer({screens:[{nodeId:'2:1',designVersion:'v-auto',level:'auto'}]});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 same(exports,[{format:'PNG',constraint:{type:'SCALE',value:1}}]);
 const puts=refPuts(server);same(puts.map(c=>c.path),[REF('2:1')]);
 assert.equal(puts[0].body.designVersion,'v-auto');same(puts[0].body.nodeMap,MAPPED);
 same(r.messages.filter(m=>m.type==='progress'&&m.phase==='Exporting check targets').map(m=>[m.count,m.total]),[[0,1],[1,1]]);
 same(r.messages.find(m=>m.type==='synced').references,{needed:1,updated:1,skipped:0,warnings:[]});
});
test('node map: visible layers only, px-rounded boxes relative to the target, instance sublayers point at their main node',()=>{
 const f=fixture();mappedTarget(f);const map=P.nodeMap(f.registry.get('2:1'));
 same(map,{entries:MAPPED,capped:false});
 const big=node('3:1','FRAME',{children:[],absoluteBoundingBox:{x:0,y:0,width:10,height:10}});
 for(let i=0;i<P.NODE_MAP_MAX_ENTRIES+5;i++)big.children.push({id:'3:'+(i+2),type:'RECTANGLE',visible:true,absoluteBoundingBox:{x:i%7,y:0,width:1,height:1}});
 const capped=P.nodeMap(big);assert.equal(capped.capped,true);assert.equal(capped.entries.length,P.NODE_MAP_MAX_ENTRIES);
 same(P.nodeMap(node('3:0','FRAME',{absoluteTransform:[[1,0,5.6],[0,1,7.2]],width:20.4,height:9.5})).entries,[{nodeId:'3:0',x:0,y:0,width:20,height:10,depth:0}]);
});
test('older server: a refused scopeKind is resent without it (one [scope] warning); a refused nodeMap falls back to image-only uploads',async()=>{
 const f=fixture();screenScene(f,[['1:5'],['1:6']]);
 const server=mockServer({legacy:true,screens:[{nodeId:'1:5',designVersion:'v-five'},{nodeId:'1:6',designVersion:'v-six'}]});const r=runtime(f,server,SETTINGS);
 await r.send({type:'upload',fileUrl:FILE});
 assert.ok(!r.messages.some(m=>m.type==='error'),JSON.stringify(r.messages.find(m=>m.type==='error')));
 const batches=server.calls.filter(c=>c.path===SYNC);
 assert.equal(batches[0].body.scopeKind,'none');assert.ok(batches.slice(1).length>=1&&batches.slice(1).every(c=>c.body.scopeKind===undefined));
 const done=r.messages.find(m=>m.type==='synced');assert.equal(done.scopeKind,null);
 assert.equal(done.warnings.filter(w=>w.startsWith('[scope] ')).length,1);
 assert.equal(f.root.getPluginData('scopeKind'),'');
 const puts=refPuts(server);same(puts.map(c=>[c.path,Object.keys(c.body).sort().join()]),[[REF('1:5'),'designVersion,image,nodeMap'],[REF('1:5'),'designVersion,image'],[REF('1:6'),'designVersion,image']]);
 same(done.references,{needed:2,updated:2,skipped:0,warnings:[]});
});
test('a 400 that does not name scopeKind or nodeMap is not retried',async()=>{
 const f=fixture();screenScene(f,[['1:5']]);const server=mockServer({screens:[{nodeId:'1:5',designVersion:'v'}]});
 const fetch=server.fetch;server.fetch=async(url,init)=>{if(init.method!=='PUT')return fetch(url,init);server.calls.push({method:'PUT'});const body=problemBody('invalid_body','image: not a PNG.');return {ok:false,status:400,json:async()=>body};};
 const r=runtime(f,{fetch:(...a)=>server.fetch(...a)},SETTINGS);await r.send({type:'upload',fileUrl:FILE});
 assert.equal(refPuts(server).length,1);const done=r.messages.find(m=>m.type==='synced');assert.equal(done.references.skipped,1);
});
