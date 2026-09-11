#!/usr/bin/env node
'use strict';
/**
 * map-fast 的繪圖器：把中介表示 JSON 算成佈局，產出無外部相依的深色單檔 HTML。
 *
 * 佈局在此處（產生階段）用 vendor 的 elkjs 算完，HTML 只帶算好的座標，
 * 因此產出頁不含任何佈局程式碼、不連任何網路資源。
 */
const fs = require('fs');
const path = require('path');
const ELK = require('../vendor/elkjs/main.js');

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PALETTE = ['#73daca', '#7aa2f7', '#bb9af7', '#e0af68', '#f7768e', '#9ece6a',
                 '#2ac3de', '#ff9e64'];
const NODE_H = 54;
const NODE_MIN_W = 160;

/** ELK 佈局參數：分層向下、正交路由（標籤內聯見 EDGE_LABEL_OPTIONS）。 */
const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.spacing.nodeNode': '28',
  'elk.layered.spacing.nodeNodeBetweenLayers': '58',
  'elk.spacing.edgeLabel': '6',
  'elk.spacing.edgeEdge': '14',
  'elk.spacing.edgeNode': '20',
};

/** 邊標籤選項：inline 為 label 級選項，設在 root 的 layoutOptions 不會繼承，必須掛在 label 上。 */
const EDGE_LABEL_OPTIONS = { 'elk.edgeLabels.inline': 'true' };

const GROUP_OPTIONS = {
  'elk.padding': '[top=38,left=20,bottom=20,right=20]',
  'elk.spacing.nodeNode': '24',
};

// -----------------------------------------------------------------------------
// 讀取與驗證
// -----------------------------------------------------------------------------

function readJson(file) {
  if (!fs.existsSync(file)) throw new Error(`找不到檔案：${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkIds(items, kind) {
  const seen = new Set();
  for (const item of items) {
    if (!item.id || seen.has(item.id)) throw new Error(`${kind} id 缺失或重複：${item.id}`);
    if (!ID_RE.test(item.id)) throw new Error(`${kind} id 非 ASCII kebab-case：${item.id}`);
    seen.add(item.id);
  }
  return seen;
}

/** 群組成員兩種寫法擇一：group.members 陣列或 node.group 欄位。 */
function normalizeGroups(data) {
  for (const g of data.groups || [])
    for (const id of g.members || []) {
      const node = data.nodes.find(n => n.id === id);
      if (!node) throw new Error(`群組 ${g.id} 的成員不存在：${id}`);
      if (node.group && node.group !== g.id)
        throw new Error(`節點 ${id} 同時屬於 ${node.group} 與 ${g.id}`);
      node.group = g.id;
    }
}

function validate(data) {
  for (const key of ['title', 'nodes', 'edges'])
    if (!(key in data)) throw new Error(`缺少必要欄位：${key}`);
  if (!Array.isArray(data.nodes) || !data.nodes.length) throw new Error('nodes 不得為空');
  const nodeIds = checkIds(data.nodes, 'node');
  const groupIds = checkIds(data.groups || [], 'group');
  normalizeGroups(data);
  for (const n of data.nodes) {
    if (!n.label) throw new Error(`node ${n.id} 缺少 label`);
    if (!n.layer) throw new Error(`node ${n.id} 缺少 layer（分層，必填）`);
    if (n.group && !groupIds.has(n.group))
      throw new Error(`node ${n.id} 引用不存在的 group：${n.group}`);
  }
  validateEdges(data, nodeIds);
  return data;
}

function validateEdges(data, nodeIds) {
  const touched = new Set();
  data.edges.forEach((e, i) => {
    e.id = e.id || `e${i}`;
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to))
      throw new Error(`edge ${e.id} 引用不存在的 node：${e.from} → ${e.to}`);
    // 硬約束：每條箭頭都要標明關係，沒有標籤的邊看不出是 require 還是寫入。
    if (!e.label) throw new Error(`edge ${e.id} 缺少 label（關係，必填）`);
    touched.add(e.from); touched.add(e.to);
  });
  // 硬約束：不留孤立節點——沒有可畫關係的東西該進說明或表格，不該掛在圖上。
  const lonely = data.nodes.filter(n => !touched.has(n.id)).map(n => n.id);
  if (lonely.length) throw new Error(`有孤立節點（無任何邊）：${lonely.join('、')}`);
}

// -----------------------------------------------------------------------------
// 佈局（ELK）
// -----------------------------------------------------------------------------

/**
 * 產生端沒有瀏覽器可量測文字，改用字寬估算：CJK 與全形標點約一個字身，
 * 其餘（英數、空白、半形符號）約 0.55 個字身。誤差只影響框寬鬆緊，不影響佈局正確性。
 */
function textWidth(str, px) {
  let w = 0;
  for (const ch of String(str))
    w += /[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? px : px * 0.55;
  return w;
}

function nodeWidth(n) {
  return Math.max(NODE_MIN_W, textWidth(n.label, 13.5) + 34, textWidth(n.layer, 11) + 34);
}

/** 節點依 group 收進 ELK 的子圖，讓分區框由佈局層決定大小與位置。 */
function buildChildren(data) {
  const boxOf = n => ({ id: n.id, width: nodeWidth(n), height: NODE_H });
  const groups = (data.groups || []).map(g => ({
    id: `g:${g.id}`,
    layoutOptions: GROUP_OPTIONS,
    labels: [{ text: g.label || g.id, width: textWidth(g.label || g.id, 12) + 16, height: 18 }],
    children: data.nodes.filter(n => n.group === g.id).map(boxOf),
  })).filter(g => g.children.length);
  return groups.concat(data.nodes.filter(n => !n.group).map(boxOf));
}

/** ELK 的子圖座標相對於各自 parent，攤平成同一個絕對座標系。 */
function flatten(node, ox, oy, out) {
  for (const c of node.children || []) {
    const x = ox + (c.x || 0), y = oy + (c.y || 0);
    out.push({ id: c.id, x, y, w: c.width, h: c.height,
      label: (c.labels && c.labels[0] && c.labels[0].text) || null });
    flatten(c, x, y, out);
  }
  return out;
}

async function layout(data) {
  const res = await new ELK().layout({
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: buildChildren(data),
    edges: data.edges.map(e => ({
      id: e.id, sources: [e.from], targets: [e.to],
      labels: [{ text: e.label, width: textWidth(e.label, 11.5) + 10, height: 16,
        layoutOptions: EDGE_LABEL_OPTIONS }],
    })),
  });
  const flat = flatten(res, 0, 0, []);
  const pos = Object.fromEntries(flat.map(b => [b.id, b]));
  const laid = {
    nodes: data.nodes.map(n => Object.assign({}, n, box(pos[n.id]))),
    groups: (data.groups || []).filter(g => pos[`g:${g.id}`])
      .map(g => Object.assign({}, g, box(pos[`g:${g.id}`]))),
    edges: data.edges.map(e => Object.assign({}, e, section(res, e.id, edgeOffset(data, pos, e)))),
  };
  return normalize(laid);
}

/**
 * ELK 回報的 width/height 不含邊標籤的外擴，內聯標籤可能落到 (0,0) 左上之外，
 * 頁面 fit() 只認 size 就會把它切掉。這裡自行量真正的 bounding box 再平移歸零。
 */
function normalize(laid, pad = 24) {
  const xs = [], ys = [];
  const span = (x, y, w = 0, h = 0) => { xs.push(x, x + w); ys.push(y, y + h); };
  laid.nodes.concat(laid.groups).forEach(b => span(b.x, b.y, b.w, b.h));
  for (const e of laid.edges) {
    (e.pts || []).forEach(p => span(p.x, p.y));
    if (e.lx != null) span(e.lx - e.lw / 2, e.ly - 9, e.lw, 18);
  }
  const dx = pad - Math.min(...xs), dy = pad - Math.min(...ys);
  laid.nodes.concat(laid.groups).forEach(b => { b.x += dx; b.y += dy; });
  for (const e of laid.edges) {
    (e.pts || []).forEach(p => { p.x += dx; p.y += dy; });
    if (e.lx != null) { e.lx += dx; e.ly += dy; }
  }
  laid.w = Math.max(...xs) + dx + pad;
  laid.h = Math.max(...ys) + dy + pad;
  return laid;
}

const box = p => ({ x: p.x, y: p.y, w: p.w, h: p.h });

/**
 * ELK 的邊座標相對於「兩端最近共同祖先」容器，不是一律相對 root：
 * 跨群組的邊以 root 為基準（座標即絕對值），兩端同屬一個群組的邊則以該群組為基準。
 * 不補這段 offset，同群組內的邊會飄到圖外——看起來是「只有線、沒有接到節點」。
 * @returns {{x: number, y: number}} 該邊座標基準容器的絕對座標
 */
function edgeOffset(data, pos, e) {
  const groupOf = id => (data.nodes.find(n => n.id === id) || {}).group;
  const g = groupOf(e.from);
  const c = g && g === groupOf(e.to) ? pos[`g:${g}`] : null;
  return c ? { x: c.x, y: c.y } : { x: 0, y: 0 };
}

/** 邊可能掛在 root 或任一子圖的 edges 上，遞迴找。 */
function findEdge(node, id) {
  const hit = (node.edges || []).find(x => x.id === id);
  if (hit) return hit;
  for (const c of node.children || []) {
    const deep = findEdge(c, id);
    if (deep) return deep;
  }
  return null;
}

function section(res, id, off) {
  const r = findEdge(res, id);
  const s = (r && r.sections && r.sections[0]) || null;
  const lb = r && r.labels && r.labels[0];
  return {
    pts: s ? [s.startPoint].concat(s.bendPoints || [], [s.endPoint])
      .map(p => ({ x: p.x + off.x, y: p.y + off.y })) : [],
    lx: lb ? lb.x + lb.width / 2 + off.x : null,
    ly: lb ? lb.y + lb.height / 2 + off.y : null,
    lw: lb ? lb.width : 0,
  };
}

// -----------------------------------------------------------------------------
// 頁面樣板
// -----------------------------------------------------------------------------

const CSS = `:root{--bg:#0b1020;--line:#5a6b91;--text:#eef3ff;--muted:#98a4bd;
--accent:#73daca;--edge-label:#c3ccdf}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);
font:14px/1.55 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;
display:flex;flex-direction:column;overflow:hidden;
-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
header{padding:14px 22px 12px;border-bottom:1px solid #26324d;flex:none}
h1{margin:0;font-size:20px;letter-spacing:.2px}header p,.muted{color:var(--muted);margin:4px 0 0}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 336px;flex:1;min-height:0}
main{position:relative;min-width:0;display:flex;
background:radial-gradient(circle at 1px 1px,#18223c 1px,transparent 0) 0 0/24px 24px,
linear-gradient(170deg,#0c1226 0%,#090d1a 100%)}
.toolbar{position:absolute;top:12px;left:14px;right:14px;display:flex;gap:8px;align-items:flex-start;
flex-wrap:wrap;z-index:2;pointer-events:none}
.toolbar>*{pointer-events:auto}
button{background:#18233bee;color:var(--text);border:1px solid #354564;border-radius:8px;
padding:6px 11px;font:inherit;font-size:13px;cursor:pointer}
button:hover{border-color:var(--accent)}
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
.pill{display:inline-block;font-size:11.5px;border:1px solid #354564;border-radius:999px;
padding:1px 9px;color:var(--muted);margin:0 6px 6px 0}
.rel{border-left:2px solid #2b3a5c;padding:4px 0 4px 10px;margin:5px 0;font-size:13px;cursor:pointer}
.rel:hover{border-left-color:var(--accent);background:#141d3366}
.rel b{color:var(--text);font-weight:600}
.stat{display:flex;gap:18px;margin-top:8px}
.stat div{font-size:11.5px;color:var(--muted)}
.stat b{display:block;font-size:20px;color:var(--text);font-weight:600;line-height:1.2}
.grp rect{fill:#111a2e88;stroke-dasharray:6 5;stroke-width:1.3;rx:14}
.grp text{font-size:12px;letter-spacing:.06em;font-weight:600}
.eg{transition:opacity .3s cubic-bezier(.4,0,.2,1)}
.edge{fill:none;stroke:var(--edge-stroke,var(--line));stroke-width:1.7;stroke-linecap:round;
transition:stroke-width .2s ease,opacity .2s ease;opacity:.75}
.eg:hover .edge{opacity:1;stroke-width:2.2}
.edge.hot{stroke:var(--accent);stroke-width:2.8;opacity:1;marker-end:url(#arrow-hot)}
.elabel{font-size:11.5px;fill:var(--edge-label);text-anchor:middle;dominant-baseline:middle;
pointer-events:none;opacity:.72}
.ebg{fill:#0b1020;rx:4;pointer-events:none;opacity:.72}
g:hover .elabel,g:hover .ebg{opacity:1}
.ehit{stroke:transparent;stroke-width:16;fill:none;cursor:pointer}
.node{transition:opacity .3s cubic-bezier(.4,0,.2,1);cursor:pointer}
.node rect.box{fill:url(#nodeFill);stroke:#3a4a6b;stroke-width:1.4;rx:10;
transition:stroke-width .18s ease,filter .18s ease;
filter:drop-shadow(0 3px 7px rgba(0,0,0,.5))}
.node:hover rect.box{stroke:var(--accent);filter:drop-shadow(0 5px 14px rgba(115,218,202,.22))}
.node.selected rect.box{stroke:var(--accent);stroke-width:2.4;
filter:drop-shadow(0 5px 16px rgba(115,218,202,.3))}
.node text{pointer-events:none}
.node .lbl{fill:var(--text);font-size:13.5px;font-weight:600;dominant-baseline:middle}
.node .kind{fill:var(--muted);font-size:11px;dominant-baseline:middle;opacity:.85}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.node,.eg{animation:fadeIn .5s cubic-bezier(.4,0,.2,1) backwards}
.dim{opacity:.1}
@media(max-width:900px){.layout{grid-template-columns:1fr;grid-template-rows:minmax(320px,55%) auto}
aside{border-left:0;border-top:1px solid #26324d}.legend{display:none}}`;

/** 頁面端只負責畫與互動：一般邊的座標已由產生階段的 ELK 算完。 */
const SCRIPT = String.raw`
const D=JSON.parse(document.getElementById('map-data').textContent);
const NS='http://www.w3.org/2000/svg',svg=document.getElementById('graph'),
panel=document.getElementById('details');
const PALETTE=['#73daca','#7aa2f7','#bb9af7','#e0af68','#f7768e','#9ece6a','#2ac3de','#ff9e64'];
const groupColor={};(D.groups||[]).forEach((g,i)=>groupColor[g.id]=PALETTE[i%PALETTE.length]);
const groupLabel=id=>((D.groups||[]).find(g=>g.id===id)||{}).label||id;
const byId=Object.fromEntries(D.nodes.map(n=>[n.id,n]));
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function E(n,a){const x=document.createElementNS(NS,n);
for(const k in(a||{}))x.setAttribute(k,a[k]);return x}

const vp=E('g'),gGroups=E('g'),gEdges=E('g'),gNodes=E('g');
vp.append(gGroups,gEdges,gNodes);svg.append(vp);
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

(D.groups||[]).forEach(g=>{
  const el=E('g',{class:'grp'}),tone=groupColor[g.id];
  const r=E('rect',{x:g.x,y:g.y,width:g.w,height:g.h});
  r.style.stroke=tone+'55';el.append(r);
  const t=E('text',{x:g.x+16,y:g.y+24});t.textContent=g.label||g.id;
  t.style.fill=tone;el.append(t);gGroups.append(el)});

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

const edgeEls={};
D.edges.forEach((e,i)=>{
  const g=E('g',{class:'eg'}),d=roundedPath(e.pts,10);
  const path=E('path',{d:d,class:'edge'});
  // 線色由來源 group 漸變到目標 group：看得出這條關係跨越哪兩個模組
  if(e.pts.length>1){
    const a=e.pts[0],b=e.pts[e.pts.length-1],gid='eg-'+e.id;
    const lg=E('linearGradient',{id:gid,gradientUnits:'userSpaceOnUse',
      x1:a.x,y1:a.y,x2:b.x,y2:b.y});
    lg.append(E('stop',{offset:'0%','stop-color':toneOf(e.from),'stop-opacity':.85}),
              E('stop',{offset:'100%','stop-color':toneOf(e.to),'stop-opacity':.85}));
    defs.append(lg);
    path.style.setProperty('--edge-stroke','url(#'+gid+')');
    const tg=byId[e.to].group;
    path.setAttribute('marker-end','url(#arrow'+(tg?'-'+tg:'')+')')}
  const hit=E('path',{d:d,class:'ehit'});
  g.append(path,hit);
  gEdges.append(g);
  if(e.lx!=null){
    g.append(E('rect',{class:'ebg',x:e.lx-e.lw/2,y:e.ly-9,width:e.lw,height:18}));
    const t=E('text',{class:'elabel',x:e.lx,y:e.ly});
    t.textContent=e.label;g.append(t)}
  const tip=E('title');
  tip.textContent=byId[e.from].label+' → '+byId[e.to].label+'：'+e.label;g.append(tip);
  hit.onclick=ev=>{ev.stopPropagation();showEdge(e)};
  g.style.animationDelay=(i*16)+'ms';
  edgeEls[e.id]={g:g,path:path}});

const nodeEls={};
D.nodes.forEach((n,i)=>{
  const g=E('g',{class:'node',transform:'translate('+n.x+','+n.y+')',tabindex:'0'});
  const tone=n.group?groupColor[n.group]:'#3a4a6b';
  const bx=E('rect',{class:'box',width:n.w,height:n.h});
  bx.style.stroke=tone+'88';g.append(bx);
  g.append(E('rect',{width:4,height:n.h-16,x:0,y:8,rx:2,fill:tone}));
  const l=E('text',{class:'lbl',x:17,y:21});l.textContent=n.label;g.append(l);
  const k=E('text',{class:'kind',x:17,y:39});k.textContent=n.layer;
  if(n.group)k.style.fill=tone;g.append(k);
  const tip=E('title');tip.textContent=n.label+' — '+n.layer;g.append(tip);
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
    const e=D.edges.find(x=>x.id===id);
    if(edgeIds.has(id)){edgeEls[id].path.classList.add('hot')}
    else edgeEls[id].g.classList.add('dim')})}

const relRow=(e,other,dir)=>'<div class="rel'+
  '" data-eid="'+esc(e.id)+'">'+(dir==='out'?'→ ':'← ')+
  '<b>'+esc(byId[other]?byId[other].label:other)+'</b><br>'+
  '<span class="muted">'+esc(e.label)+'</span></div>';

function showNode(n){
  const outs=D.edges.filter(e=>e.from===n.id),ins=D.edges.filter(e=>e.to===n.id);
  const ids=new Set([n.id]);outs.forEach(e=>ids.add(e.to));ins.forEach(e=>ids.add(e.from));
  focusOn(ids,new Set(outs.concat(ins).map(e=>e.id)));
  nodeEls[n.id].classList.add('selected');
  panel.innerHTML='<h2>'+esc(n.label)+'</h2><p>'+
    '<span class="pill">'+esc(n.layer)+'</span>'+
    (n.group?'<span class="pill">'+esc(groupLabel(n.group))+'</span>':'')+'</p>'+
    (n.note?'<p class="muted">'+esc(n.note)+'</p>':'')+
    (outs.length?'<h3>輸出關係</h3>'+outs.map(e=>relRow(e,e.to,'out')).join(''):'')+
    (ins.length?'<h3>輸入關係</h3>'+ins.map(e=>relRow(e,e.from,'in')).join(''):'')}

function showEdge(e){
  focusOn(new Set([e.from,e.to]),new Set([e.id]));
  panel.innerHTML='<h2>'+esc(byId[e.from].label)+' <span class="muted">→</span> '+
    esc(byId[e.to].label)+'</h2><p><span class="pill">'+esc(e.label)+'</span>'+
    '</p>'+
    (e.note?'<p class="muted">'+esc(e.note)+'</p>':'')}

panel.addEventListener('click',e=>{const row=e.target.closest('.rel');if(!row)return;
  const edge=D.edges.find(x=>x.id===row.getAttribute('data-eid'));if(edge)showEdge(edge)});

const HOWTO='<h3>怎麼看</h3><ul><li>點節點：只留下它的直接鄰居，其餘淡出</li>'+
  '<li>點關係線：看這條關係本身</li><li>滾輪縮放、拖曳平移，點空白處回總覽</li></ul>';
const statRow=pairs=>'<div class="stat">'+pairs.map(p=>'<div><b>'+p[0]+'</b>'+p[1]+'</div>').join('')+'</div>';

function overview(){
  clearFocus();
  const grp=(D.groups||[]).map(g=>'<li><b>'+esc(g.label||g.id)+'</b>'+
    (g.boundary?'<br><span class="muted">'+esc(g.boundary)+'</span>':'')+'</li>').join('');
  const om=(D.omitted||[]).map(t=>'<li>'+esc(t)+'</li>').join('');
  panel.innerHTML='<h2>'+esc(D.title)+'</h2>'+
    (D.question?'<p class="muted">'+esc(D.question)+'</p>':'')+
    statRow([[D.nodes.length,'節點'],[D.edges.length,'關係'],
             [(D.groups||[]).length,'群組']])+
    (grp?'<h3>群組邊界</h3><ul>'+grp+'</ul>':'')+
    (om?'<h3>圖中未包含</h3><ul>'+om+'</ul>':'')+HOWTO}
svg.addEventListener('click',()=>{if(!moved)overview()});
document.getElementById('reset').onclick=()=>{fit();overview()};
addEventListener('resize',fit);
fit();overview();
`;

// -----------------------------------------------------------------------------
// 產生頁面
// -----------------------------------------------------------------------------

const escHtml = s => String(s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildLegend(laid) {
  const items = laid.groups.map((g, i) =>
    `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>` +
    `${escHtml(g.label || g.id)}</span>`);
  return items.length ? `<div class="legend">${items.join('')}</div>` : '';
}

function render(data, laid) {
  const payload = JSON.stringify({
    title: data.title, question: data.question || '', omitted: data.omitted || [],
    nodes: laid.nodes, edges: laid.edges, groups: laid.groups,
    size: { w: laid.w, h: laid.h },
  }).replace(/<\//g, '<\\/');
  const safe = escHtml(data.title);
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${safe}</title><style>${CSS}</style></head><body>` +
    `<header><h1>${safe}</h1><p>${escHtml(data.question || '')}</p></header>` +
    '<div class="layout"><main><div class="toolbar">' +
    `<button id="reset">重設檢視</button>${buildLegend(laid)}</div>` +
    `<svg id="graph" role="img" aria-label="${safe}"></svg>` +
    '<div class="hint">滾輪縮放 · 拖曳平移 · 點節點看鄰居</div></main>' +
    '<aside id="details"></aside></div>' +
    `<script type="application/json" id="map-data">${payload}</script>` +
    `<script>${SCRIPT}</script></body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const oi = args.indexOf('-o');
  const out = oi >= 0 ? args[oi + 1] : null;
  const input = args.filter((a, i) => !a.startsWith('-') && !(oi >= 0 && i === oi + 1))[0];
  if (!input || (!check && !out)) {
    console.error('用法：node render-map.js <圖譜 JSON> -o <輸出 .html>｜<圖譜 JSON> --check');
    return 1;
  }
  try {
    const data = validate(readJson(input));
    if (check) {
      console.log(`OK: ${data.nodes.length} 節點、${data.edges.length} 邊、` +
        `${(data.groups || []).length} 群組`);
      return 0;
    }
    const laid = await layout(data);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, render(data, laid), 'utf8');
    console.log(`已產生：${out}`);
    return 0;
  } catch (e) {
    console.error(`錯誤：${e.message}`);
    return 1;
  }
}

if (require.main === module) main().then(code => process.exit(code));
