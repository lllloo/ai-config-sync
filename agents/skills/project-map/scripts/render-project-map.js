#!/usr/bin/env node
'use strict';
/**
 * 驗證 project-map 資料並產生無外部相依的互動式 HTML（總覽 + 模組分頁）。
 *
 * 佈局在此處（產生階段）用 vendor 的 elkjs 算完，HTML 只帶算好的座標，
 * 因此產出頁面不含任何佈局程式碼與外部資源。
 */
const fs = require('fs');
const path = require('path');
const ELK = require('../vendor/elkjs/main.js');

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAP_FILE = 'project-map.json';
const SOURCES_FILE = path.join('evidence', 'sources.json');
const MODULES_DIR = 'modules';
const PALETTE = ['#73daca', '#7aa2f7', '#bb9af7', '#e0af68', '#f7768e', '#9ece6a',
                 '#2ac3de', '#ff9e64'];
const NODE_H = 54;

/** ELK 佈局參數：分層向下、正交路由（標籤內聯見 EDGE_LABEL_OPTIONS）。 */
const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.spacing.nodeNode': '26',
  'elk.layered.spacing.nodeNodeBetweenLayers': '54',
  'elk.spacing.edgeLabel': '6',
  'elk.spacing.edgeEdge': '14',
  'elk.spacing.edgeNode': '18',
};

/** 邊標籤選項：inline 為 label 級選項，設在 root 的 layoutOptions 不會繼承，必須掛在 label 上。 */
const EDGE_LABEL_OPTIONS = { 'elk.edgeLabels.inline': 'true' };

// -----------------------------------------------------------------------------
// 讀取與驗證
// -----------------------------------------------------------------------------

function readJson(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`找不到檔案：${file}`);
    return {};
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkIds(items, kind) {
  const seen = new Set();
  for (const item of items) {
    const value = item.id;
    if (!value || seen.has(value)) throw new Error(`${kind} id 缺失或重複：${value}`);
    if (!ID_RE.test(value)) throw new Error(`${kind} id 非 ASCII kebab-case：${value}`);
    seen.add(value);
  }
  return seen;
}

function validate(data, sources) {
  for (const key of ['schemaVersion', 'project', 'nodes', 'edges'])
    if (!(key in data)) throw new Error(`缺少必要欄位：${key}`);
  if (data.schemaVersion !== 2) throw new Error('僅支援 schemaVersion 2');
  for (const key of ['name', 'summary', 'updatedAt'])
    if (!(key in data.project)) throw new Error(`project 缺少欄位：${key}`);
  const nodeIds = checkIds(data.nodes, 'node');
  const edgeIds = checkIds(data.edges, 'edge');
  const groupIds = checkIds(data.groups || [], 'group');
  checkIds(data.flows || [], 'flow');
  const clash = [...nodeIds].filter(id => edgeIds.has(id));
  if (clash.length)
    throw new Error(`node 與 edge id 撞名（evidence 以 id 索引，不得重複）：${clash.sort()}`);
  for (const node of data.nodes) {
    for (const key of ['label', 'kind', 'summary'])
      if (!(key in node)) throw new Error(`node ${node.id} 缺少：${key}`);
    if (node.group && !groupIds.has(node.group))
      throw new Error(`node ${node.id} 引用不存在的 group：${node.group}`);
  }
  for (const edge of data.edges) {
    for (const key of ['from', 'to', 'label'])
      if (!(key in edge)) throw new Error(`edge ${edge.id} 缺少：${key}`);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      throw new Error(`edge ${edge.id} 引用不存在的 node`);
  }
  for (const flow of data.flows || [])
    for (const step of flow.steps || [])
      if (!nodeIds.has(step.node)) throw new Error(`flow ${flow.id} 引用不存在的 node`);
  validateSources(sources, new Set([...nodeIds, ...edgeIds]));
  return data;
}

function validateSources(sources, known) {
  const orphan = Object.keys(sources).filter(k => !known.has(k)).sort();
  if (orphan.length)
    throw new Error(`evidence/sources.json 有孤兒條目（無對應 node/edge）：${orphan}`);
  for (const [key, items] of Object.entries(sources)) {
    if (!Array.isArray(items)) throw new Error(`evidence ${key} 必須是陣列`);
    for (const entry of items) {
      const raw = entry.path || '';
      const parts = raw.replace(/\\/g, '/').split('/');
      if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || parts.includes('..'))
        throw new Error(`evidence ${key} 路徑不合法：${raw}`);
    }
  }
}

// -----------------------------------------------------------------------------
// 佈局（ELK）
// -----------------------------------------------------------------------------

/**
 * 產生端沒有瀏覽器可量測文字，改用字寬估算：CJK 與全形標點約一個字身，
 * 其餘（英數、空白、半形符號）約 0.55 個字身。與頁面的字級設定對齊即可，
 * 誤差只影響框寬的鬆緊，不影響佈局正確性。
 */
function textWidth(str, px) {
  let w = 0;
  for (const ch of String(str))
    w += /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? px : px * 0.55;
  return w;
}

function groupLabel(data, id) {
  const g = (data.groups || []).find(x => x.id === id);
  return (g && g.label) || id;
}

function nodeWidth(data, n) {
  const sub = n.kind + (n.group ? ' · ' + groupLabel(data, n.group) : '');
  return Math.max(158, textWidth(n.label, 13.5) + 32, textWidth(sub, 11) + 32);
}

/** 交給 ELK 算座標，回傳頁面用的 nodes／edges（含折線點與標籤位置）。 */
async function layout(data, nodes, edges) {
  const graph = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: nodes.map(n => ({ id: n.id, width: nodeWidth(data, n), height: NODE_H })),
    edges: edges.map(e => ({
      id: e.id, sources: [e.from], targets: [e.to],
      labels: [{ text: e.label, width: textWidth(e.label, 11.5) + 10, height: 16,
        layoutOptions: EDGE_LABEL_OPTIONS }],
    })),
  };
  const res = await new ELK().layout(graph);
  const pos = Object.fromEntries(res.children.map(c => [c.id, c]));
  const laidNodes = nodes.map(n => Object.assign({}, n, {
    x: pos[n.id].x, y: pos[n.id].y, w: pos[n.id].width, h: pos[n.id].height,
  }));
  const laidEdges = edges.map(e => {
    const r = res.edges.find(x => x.id === e.id);
    const s = (r && r.sections && r.sections[0]) || null;
    const pts = s ? [s.startPoint].concat(s.bendPoints || [], [s.endPoint]) : [];
    const lb = r && r.labels && r.labels[0];
    return Object.assign({}, e, {
      pts,
      lx: lb ? lb.x + lb.width / 2 : null,
      ly: lb ? lb.y + lb.height / 2 : null,
      lw: lb ? lb.width : 0,
    });
  });
  return { nodes: laidNodes, edges: laidEdges, w: res.width, h: res.height };
}

// -----------------------------------------------------------------------------
// 頁面樣板
// -----------------------------------------------------------------------------

const CSS = `:root{--bg:#0b1020;--panel:#141d33;--line:#5a6b91;--text:#eef3ff;--muted:#98a4bd;
--accent:#73daca;--stale:#f4bf75;--edge-label:#c3ccdf}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);
font:14px/1.55 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;
display:flex;flex-direction:column;overflow:hidden;
-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
header{padding:14px 22px 12px;border-bottom:1px solid #26324d;flex:none}
h1{margin:0;font-size:20px;letter-spacing:.2px}header p,.muted{color:var(--muted);margin:4px 0 0}
nav{padding:9px 22px;border-bottom:1px solid #26324d;display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:none}
nav a{color:var(--accent);text-decoration:none;border:1px solid #354564;background:#18233b;
border-radius:999px;padding:4px 12px;font-size:13px;white-space:nowrap}
nav a:hover{background:#20304f}
nav a.current{background:var(--accent);color:#0b1020;font-weight:600;border-color:var(--accent)}
nav span{color:var(--muted);font-size:13px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 344px;flex:1;min-height:0}
main{position:relative;min-width:0;display:flex;
background:radial-gradient(circle at 1px 1px,#18223c 1px,transparent 0) 0 0/24px 24px,
linear-gradient(170deg,#0c1226 0%,#090d1a 100%)}
.toolbar{position:absolute;top:12px;left:14px;right:14px;display:flex;gap:8px;align-items:flex-start;
flex-wrap:wrap;z-index:2;pointer-events:none}
.toolbar>*{pointer-events:auto}
button,select{background:#18233bee;color:var(--text);border:1px solid #354564;border-radius:8px;
padding:6px 11px;font:inherit;font-size:13px;cursor:pointer}
button:hover,select:hover{border-color:var(--accent)}
.legend{margin-left:auto;display:flex;gap:11px;flex-wrap:wrap;background:#101828ee;border:1px solid #26324d;
border-radius:8px;padding:7px 11px;font-size:12px;max-width:58%;justify-content:flex-end}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
.legend span{color:var(--muted);white-space:nowrap}
svg{flex:1;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
svg.panning{cursor:grabbing}
.hint{position:absolute;bottom:10px;left:16px;color:var(--muted);font-size:12px;opacity:.7;pointer-events:none}
aside{border-left:1px solid #26324d;background:#0e1526;padding:18px 20px;overflow:auto}
aside h2{margin:0 0 2px;font-size:17px;line-height:1.35}
aside h3{margin:18px 0 6px;font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;
color:var(--muted);font-weight:600}
aside ul{margin:0;padding-left:18px}aside li{margin:3px 0}
aside a{color:var(--accent)}code{color:var(--accent);font-size:12.5px;word-break:break-all}
.pill{display:inline-block;font-size:11.5px;border:1px solid #354564;border-radius:999px;
padding:1px 9px;color:var(--muted);margin:0 6px 6px 0}
.pill.stale{color:var(--stale);border-color:#5a4a2a}
.rel{border-left:2px solid #2b3a5c;padding:4px 0 4px 10px;margin:5px 0;font-size:13px;cursor:pointer}
.rel:hover{border-left-color:var(--accent);background:#141d3366}
.rel b{color:var(--text);font-weight:600}
.flow-step{border-left:2px solid var(--accent);padding:5px 0 5px 10px;margin:5px 0 5px 4px}
.stat{display:flex;gap:18px;margin-top:8px}
.stat div{font-size:11.5px;color:var(--muted)}
.stat b{display:block;font-size:20px;color:var(--text);font-weight:600;line-height:1.2}
.eg{transition:opacity .3s cubic-bezier(.4,0,.2,1)}
.edge{fill:none;stroke:var(--edge-stroke,var(--line));stroke-width:1.7;stroke-linecap:round;
transition:stroke-width .2s ease,opacity .2s ease;opacity:.75}
.eg:hover .edge{opacity:1;stroke-width:2.2}
.edge.stale{stroke:var(--stale);stroke-dasharray:6 4}
.edge.hot{stroke:var(--accent);stroke-width:2.8;opacity:1;marker-end:url(#arrow-hot)}
.elabel{font-size:11.5px;fill:var(--edge-label);text-anchor:middle;dominant-baseline:middle;
pointer-events:none;opacity:.72}
.ebg{fill:#0b1020;rx:4;pointer-events:none;opacity:.72}
g:hover .elabel,g:hover .ebg{opacity:1}
.ehit{stroke:transparent;stroke-width:16;fill:none;cursor:pointer}
.node{transition:opacity .3s cubic-bezier(.4,0,.2,1)}
.node rect.box{fill:url(#nodeFill);stroke:#3a4a6b;stroke-width:1.4;rx:10;
transition:stroke-width .18s ease,filter .18s ease;
filter:drop-shadow(0 3px 7px rgba(0,0,0,.5))}
.node:hover rect.box{filter:drop-shadow(0 5px 14px rgba(115,218,202,.22))}
.node.selected rect.box{filter:drop-shadow(0 5px 16px rgba(115,218,202,.3))}
.node text{pointer-events:none}
.node .lbl{fill:var(--text);font-size:13.5px;font-weight:600;dominant-baseline:middle}
.node .kind{fill:var(--muted);font-size:11px;dominant-baseline:middle;opacity:.85}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.node,.eg{animation:fadeIn .5s cubic-bezier(.4,0,.2,1) backwards}
.node{cursor:pointer}
.node:hover rect.box{stroke:var(--accent)}
.node.selected rect.box{stroke:var(--accent);stroke-width:2.4}
.node.stale rect.box{stroke-dasharray:5 4}
.node.external rect.box{fill:#101a2e;stroke-dasharray:4 3}
.dim{opacity:.1}
@media(max-width:900px){.layout{grid-template-columns:1fr;grid-template-rows:minmax(320px,55%) auto}
aside{border-left:0;border-top:1px solid #26324d}.legend{display:none}}`;

/** 頁面端只負責畫與互動：座標已由產生階段的 ELK 算完。 */
const SCRIPT = String.raw`
const D=JSON.parse(document.getElementById('project-data').textContent);
const NS='http://www.w3.org/2000/svg',svg=document.getElementById('graph'),
panel=document.getElementById('details');
const PALETTE=['#73daca','#7aa2f7','#bb9af7','#e0af68','#f7768e','#9ece6a','#2ac3de','#ff9e64'];
const groupColor={};(D.groups||[]).forEach((g,i)=>groupColor[g.id]=PALETTE[i%PALETTE.length]);
const groupLabel=id=>((D.groups||[]).find(g=>g.id===id)||{}).label||id;
const byId=Object.fromEntries(D.nodes.map(n=>[n.id,n]));
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function E(n,a){const x=document.createElementNS(NS,n);
for(const k in(a||{}))x.setAttribute(k,a[k]);return x}

const vp=E('g'),gEdges=E('g'),gNodes=E('g');vp.append(gEdges,gNodes);svg.append(vp);
const defs=E('defs');svg.append(defs);
const toneOf=id=>{const n=byId[id];return n&&n.group?groupColor[n.group]:'#5a6b91'};
function marker(id,fill){
  const m=E('marker',{id:id,viewBox:'0 0 10 10',refX:9,refY:5,
    markerWidth:5.5,markerHeight:5.5,orient:'auto'});
  m.append(E('path',{d:'M0 0L10 5L0 10z',fill:fill}));defs.append(m);return id}
marker('arrow','#5a6b91');marker('arrow-hot','#73daca');
(D.groups||[]).forEach(g=>marker('arrow-'+g.id,groupColor[g.id]));
(function(){const lg=E('linearGradient',{id:'nodeFill',x1:0,y1:0,x2:0,y2:1});
  lg.append(E('stop',{offset:'0%','stop-color':'#18223c'}),
            E('stop',{offset:'100%','stop-color':'#121a30'}));defs.append(lg)})();

/** ELK 的正交折線轉成帶圓角的路徑，轉角不會是生硬的直角。 */
function roundedPath(pts,r){
  if(!pts||pts.length<2)return'';
  let d='M'+pts[0].x+' '+pts[0].y;
  for(let i=1;i<pts.length-1;i++){
    const p=pts[i],a=pts[i-1],b=pts[i+1];
    const d1=Math.hypot(p.x-a.x,p.y-a.y),d2=Math.hypot(b.x-p.x,b.y-p.y);
    if(!d1||!d2)continue;
    const r1=Math.min(r,d1/2),r2=Math.min(r,d2/2);
    d+='L'+(p.x+(a.x-p.x)/d1*r1)+' '+(p.y+(a.y-p.y)/d1*r1)+
       'Q'+p.x+' '+p.y+' '+(p.x+(b.x-p.x)/d2*r2)+' '+(p.y+(b.y-p.y)/d2*r2)}
  const last=pts[pts.length-1];
  return d+'L'+last.x+' '+last.y}

const edgeEls={},nodeEls={};
D.edges.forEach((e,i)=>{
  const g=E('g',{class:'eg'}),d=roundedPath(e.pts,10);
  const path=E('path',{d:d,class:'edge'+(e.status==='stale'?' stale':'')});
  // 線色由來源 group 漸變到目標 group：看得出這條關係跨越哪兩個模組
  if(e.pts.length>1&&e.status!=='stale'){
    const a=e.pts[0],b=e.pts[e.pts.length-1],gid='eg-'+e.id;
    const lg=E('linearGradient',{id:gid,gradientUnits:'userSpaceOnUse',
      x1:a.x,y1:a.y,x2:b.x,y2:b.y});
    lg.append(E('stop',{offset:'0%','stop-color':toneOf(e.from),'stop-opacity':.85}),
              E('stop',{offset:'100%','stop-color':toneOf(e.to),'stop-opacity':.85}));
    defs.append(lg);
    path.style.setProperty('--edge-stroke','url(#'+gid+')');
    const tg=byId[e.to].group;
    if(tg)path.setAttribute('marker-end','url(#arrow-'+tg+')')}
  const hit=E('path',{d:d,class:'ehit'});
  g.append(path,hit);gEdges.append(g);
  if(e.lx!=null){
    g.append(E('rect',{class:'ebg',x:e.lx-e.lw/2,y:e.ly-9,width:e.lw,height:18}));
    const t=E('text',{class:'elabel',x:e.lx,y:e.ly});t.textContent=e.label;g.append(t)}
  const tip=E('title');
  tip.textContent=byId[e.from].label+' → '+byId[e.to].label+'：'+e.label;g.append(tip);
  hit.onclick=ev=>{ev.stopPropagation();showEdge(e)};
  g.style.animationDelay=(i*16)+'ms';
  edgeEls[e.id]={g:g,path:path}});

D.nodes.forEach((n,i)=>{
  const g=E('g',{class:'node'+(n.status==='stale'?' stale':'')+(n.external?' external':''),
    transform:'translate('+n.x+','+n.y+')',tabindex:'0'});
  const tone=n.group?groupColor[n.group]:'#3a4a6b';
  const bx=E('rect',{class:'box',width:n.w,height:n.h});
  bx.style.stroke=tone+(n.external?'55':'88');g.append(bx);
  g.append(E('rect',{width:4,height:n.h-16,x:0,y:8,rx:2,fill:tone}));
  const l=E('text',{class:'lbl',x:17,y:21});l.textContent=n.label;g.append(l);
  const k=E('text',{class:'kind',x:17,y:39});
  k.textContent=n.kind+(n.group?' · '+groupLabel(n.group):'');
  if(n.group)k.style.fill=tone;g.append(k);
  const tip=E('title');tip.textContent=n.label+' — '+n.summary;g.append(tip);
  g.onclick=ev=>{ev.stopPropagation();showNode(n)};
  g.onkeydown=ev=>{if(ev.key==='Enter')showNode(n)};
  g.style.animationDelay=(60+i*22)+'ms';
  gNodes.append(g);nodeEls[n.id]=g});

let view={x:0,y:0,k:1};
function applyView(){vp.setAttribute('transform',
  'translate('+view.x+','+view.y+') scale('+view.k+')')}
function fit(){
  const r=svg.getBoundingClientRect(),pad=42;
  view.k=Math.min(1.2,(r.width-pad*2)/Math.max(1,D.size.w),(r.height-pad*2)/Math.max(1,D.size.h));
  view.x=(r.width-D.size.w*view.k)/2;view.y=(r.height-D.size.h*view.k)/2+10;applyView()}
svg.addEventListener('wheel',e=>{e.preventDefault();
  const r=svg.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  const k=Math.min(2.6,Math.max(.25,view.k*(e.deltaY<0?1.12:1/1.12)));
  view.x=mx-(mx-view.x)*k/view.k;view.y=my-(my-view.y)*k/view.k;view.k=k;applyView()},
  {passive:false});
let drag=null,moved=false;
svg.addEventListener('pointerdown',e=>{drag={x:e.clientX-view.x,y:e.clientY-view.y};moved=false;
  svg.classList.add('panning');svg.setPointerCapture(e.pointerId)});
svg.addEventListener('pointermove',e=>{if(!drag)return;moved=true;
  view.x=e.clientX-drag.x;view.y=e.clientY-drag.y;applyView()});
svg.addEventListener('pointerup',()=>{drag=null;svg.classList.remove('panning')});

function clearFocus(){
  Object.keys(nodeEls).forEach(id=>nodeEls[id].classList.remove('dim','selected'));
  Object.keys(edgeEls).forEach(id=>{edgeEls[id].g.classList.remove('dim');
    edgeEls[id].path.classList.remove('hot')})}
/** 只留焦點與其鄰居為亮色，其餘淡出——密圖可讀性的主要手段。 */
function focusOn(nodeIds,edgeIds){
  clearFocus();
  Object.keys(nodeEls).forEach(id=>{if(!nodeIds.has(id))nodeEls[id].classList.add('dim')});
  Object.keys(edgeEls).forEach(id=>{
    if(edgeIds.has(id))edgeEls[id].path.classList.add('hot');
    else edgeEls[id].g.classList.add('dim')})}

const ev=id=>{const l=(D.sources[id]||[]).map(x=>'<li><code>'+esc(x.path)+
  (x.line?':'+x.line:'')+'</code>'+(x.note?'<br><span class="muted">'+esc(x.note)+'</span>':'')+
  '</li>').join('');
  return'<h3>程式碼證據</h3>'+(l?'<ul>'+l+'</ul>':'<p class="muted">尚無證據。</p>')};
const relRow=(e,other,dir)=>'<div class="rel" data-eid="'+esc(e.id)+'">'+
  (dir==='out'?'→ ':'← ')+'<b>'+esc(byId[other]?byId[other].label:other)+'</b><br>'+
  '<span class="muted">'+esc(e.label)+'</span></div>';

function showNode(n){
  const outs=D.edges.filter(e=>e.from===n.id),ins=D.edges.filter(e=>e.to===n.id);
  const ids=new Set([n.id]);outs.forEach(e=>ids.add(e.to));ins.forEach(e=>ids.add(e.from));
  focusOn(ids,new Set(outs.concat(ins).map(e=>e.id)));
  nodeEls[n.id].classList.add('selected');
  const link=n.page&&!n.current?'<p><a href="'+esc(n.page)+'">開啟「'+
    esc(groupLabel(n.group))+'」模組頁 →</a></p>':'';
  const notes=(n.notes||[]).map(t=>'<li>'+esc(t)+'</li>').join('');
  panel.innerHTML='<h2>'+esc(n.label)+'</h2><p>'+
    '<span class="pill">'+esc(n.kind)+'</span>'+
    (n.group?'<span class="pill">'+esc(groupLabel(n.group))+'</span>':'')+
    (n.status==='stale'?'<span class="pill stale">stale</span>':'')+
    (n.external?'<span class="pill">外部</span>':'')+'</p><p>'+esc(n.summary)+'</p>'+link+
    (outs.length?'<h3>輸出關係</h3>'+outs.map(e=>relRow(e,e.to,'out')).join(''):'')+
    (ins.length?'<h3>輸入關係</h3>'+ins.map(e=>relRow(e,e.from,'in')).join(''):'')+
    (notes?'<h3>註記</h3><ul>'+notes+'</ul>':'')+ev(n.id)}

function showEdge(e){
  focusOn(new Set([e.from,e.to]),new Set([e.id]));
  panel.innerHTML='<h2>'+esc(byId[e.from].label)+' <span class="muted">→</span> '+
    esc(byId[e.to].label)+'</h2><p><span class="pill">'+esc(e.label)+'</span>'+
    (e.status==='stale'?'<span class="pill stale">stale</span>':'')+'</p>'+ev(e.id)}

panel.addEventListener('click',e=>{const row=e.target.closest('.rel');if(!row)return;
  const edge=D.edges.find(x=>x.id===row.getAttribute('data-eid'));if(edge)showEdge(edge)});

const HOWTO='<h3>怎麼看</h3><ul><li>點節點：只留下它的直接鄰居，其餘淡出</li>'+
  '<li>點關係線：看該關係的程式碼證據</li>'+
  '<li>左上選單挑流程：只亮出該條路徑</li></ul>';
const statRow=pairs=>'<div class="stat">'+pairs.map(p=>'<div><b>'+p[0]+'</b>'+p[1]+'</div>').join('')+'</div>';

/** 側欄預設內容：總覽頁講整個專案，模組頁講這個模組本身。 */
function overview(){
  clearFocus();
  const v=D.view;
  if(v&&v.group){
    const own=D.nodes.filter(n=>!n.external);
    panel.innerHTML='<h2>'+esc(v.label)+'</h2>'+
      (v.description?'<p class="muted">'+esc(v.description)+'</p>':'')+
      statRow([[own.length,'本模組節點'],[D.nodes.length-own.length,'相鄰外部'],
               [D.edges.length,'關係'],[(D.flows||[]).length,'相關流程']])+
      '<h3>本模組節點</h3><ul>'+own.map(n=>'<li><b>'+esc(n.label)+'</b><br>'+
        '<span class="muted">'+esc(n.summary)+'</span></li>').join('')+'</ul>'+
      '<p><a href="'+esc(v.home)+'">← 回專案總覽</a></p>'+HOWTO;
    return}
  const mods=(D.groups||[]).map(g=>'<li>'+esc(g.label)+(g.description?
    ' — <span class="muted">'+esc(g.description)+'</span>':'')+'</li>').join('');
  panel.innerHTML='<h2>'+esc(D.project.name)+'</h2><p class="muted">'+esc(D.project.summary)+'</p>'+
    statRow([[D.nodes.length,'節點'],[D.edges.length,'關係'],
             [(D.groups||[]).length,'模組'],[(D.flows||[]).length,'流程']])+
    (mods?'<h3>模組</h3><ul>'+mods+'</ul>':'')+HOWTO}
svg.addEventListener('click',()=>{if(!moved)overview()});

const flowSel=document.getElementById('flow');
(D.flows||[]).forEach(f=>{const o=document.createElement('option');
  o.value=f.id;o.textContent=f.label;flowSel.append(o)});
flowSel.onchange=()=>{
  const f=(D.flows||[]).find(x=>x.id===flowSel.value);
  if(!f){overview();return}
  const ids=new Set(f.steps.map(s=>s.node)),eids=new Set();
  for(let i=1;i<f.steps.length;i++){
    const a=f.steps[i-1].node,b=f.steps[i].node;
    const hit=D.edges.find(e=>(e.from===a&&e.to===b)||(e.from===b&&e.to===a));
    if(hit)eids.add(hit.id)}
  focusOn(ids,eids);
  panel.innerHTML='<h2>'+esc(f.label)+'</h2><p class="muted">'+esc(f.summary||'')+'</p>'+
    f.steps.map((s,i)=>'<div class="flow-step"><b>'+(i+1)+'. '+
      esc(byId[s.node]?byId[s.node].label:s.node)+'</b><br><span class="muted">'+
      esc(s.label||'')+'</span></div>').join('')};
document.getElementById('reset').onclick=()=>{flowSel.value='';fit();overview()};
document.getElementById('summary').textContent=D.project.summary+' · 更新 '+D.project.updatedAt;
addEventListener('resize',fit);
fit();overview();
`;

// -----------------------------------------------------------------------------
// 產生頁面
// -----------------------------------------------------------------------------

const escHtml = s => String(s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pageOf(node, prefix) {
  return node.group ? `${prefix}${node.group}.html` : null;
}

function buildLegend(groups) {
  if (!groups.length) return '';
  const items = groups.map((g, i) =>
    `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>` +
    `${escHtml(g.label || g.id)}</span>`).join('');
  return `<div class="legend">${items}</div>`;
}

function buildNav(groups, current, home, prefix) {
  if (!groups.length) return '';
  const links = ['<span>模組：</span>',
    `<a class="${current == null ? 'current' : ''}" href="${home}">總覽</a>`];
  for (const g of groups)
    links.push(`<a class="${g.id === current ? 'current' : ''}" ` +
      `href="${prefix}${g.id}.html">${escHtml(g.label || g.id)}</a>`);
  return `<nav>${links.join('')}</nav>`;
}

function render(data, sources, laid, title, nav, view) {
  const payload = JSON.stringify({
    project: data.project, nodes: laid.nodes, edges: laid.edges,
    flows: laid.flows, sources, groups: data.groups || [],
    view: view || {}, size: { w: laid.w, h: laid.h },
  }).replace(/<\//g, '<\\/');
  const safe = escHtml(title);
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${safe} — Project Map</title><style>${CSS}</style></head><body>` +
    `<header><h1>${safe}</h1><p id="summary"></p></header>${nav}` +
    '<div class="layout"><main><div class="toolbar">' +
    '<select id="flow"><option value="">全部關係</option></select>' +
    '<button id="reset">重設檢視</button>' +
    `${buildLegend(data.groups || [])}</div>` +
    '<svg id="graph" role="img" aria-label="專案架構圖"></svg>' +
    '<div class="hint">滾輪縮放 · 拖曳平移 · 點節點看鄰居與證據</div></main>' +
    '<aside id="details"></aside></div>' +
    `<script type="application/json" id="project-data">${payload}</script>` +
    `<script>${SCRIPT}</script></body></html>`;
}

function moduleSlice(data, groupId) {
  const inside = new Set(data.nodes.filter(n => n.group === groupId).map(n => n.id));
  const edges = data.edges.filter(e => inside.has(e.from) || inside.has(e.to));
  const touched = new Set([...inside, ...edges.map(e => e.from), ...edges.map(e => e.to)]);
  const nodes = data.nodes.filter(n => touched.has(n.id)).map(n => {
    const item = Object.assign({}, n, { page: pageOf(n, '') });
    if (inside.has(n.id)) item.current = true; else item.external = true;
    return item;
  });
  const flows = (data.flows || []).filter(f => (f.steps || []).some(s => inside.has(s.node)));
  return { nodes, edges, flows };
}

function pruneModules(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  const stale = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !keep.has(f)).sort();
  for (const f of stale) fs.unlinkSync(path.join(dir, f));
  return stale.map(f => path.join(dir, f));
}

async function writePages(root, data, sources) {
  const groups = data.groups || [];
  const written = [];
  const overviewNodes = data.nodes.map(n =>
    Object.assign({}, n, { page: pageOf(n, `${MODULES_DIR}/`) }));
  const laid = await layout(data, overviewNodes, data.edges);
  laid.flows = data.flows || [];
  const index = path.join(root, 'index.html');
  fs.writeFileSync(index, render(data, sources, laid, data.project.name,
    buildNav(groups, null, 'index.html', `${MODULES_DIR}/`), null), 'utf8');
  written.push(index);

  for (const g of groups) {
    const slice = moduleSlice(data, g.id);
    const sub = await layout(data, slice.nodes, slice.edges);
    sub.flows = slice.flows;
    const out = path.join(root, MODULES_DIR, `${g.id}.html`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const view = { group: g.id, label: g.label || g.id,
      description: g.description || '', home: '../index.html' };
    fs.writeFileSync(out, render(data, sources, sub, `${data.project.name} · ${g.label || g.id}`,
      buildNav(groups, g.id, '../index.html', ''), view), 'utf8');
    written.push(out);
  }
  const removed = pruneModules(path.join(root, MODULES_DIR),
    new Set(written.map(p => path.basename(p))));
  return { written, removed };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const root = args.find(a => !a.startsWith('--'));
  if (!root) {
    console.error('用法：node render-project-map.js <project map 目錄> [--check]');
    return 1;
  }
  try {
    const data = readJson(path.join(root, MAP_FILE));
    const sources = (readJson(path.join(root, SOURCES_FILE), false).sources) || {};
    validate(data, sources);
    if (check) {
      console.log(`OK: ${data.nodes.length} nodes, ${data.edges.length} edges, ` +
        `${(data.groups || []).length} groups, ${Object.keys(sources).length} evidence 條目`);
      return 0;
    }
    const { written, removed } = await writePages(root, data, sources);
    for (const p of written) console.log(`已產生：${p}`);
    for (const p of removed) console.log(`已移除孤兒模組頁：${p}`);
    return 0;
  } catch (e) {
    console.error(`錯誤：${e.message}`);
    return 1;
  }
}

if (require.main === module) main().then(code => process.exit(code));
