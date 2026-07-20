'use strict';

// =============================================================================
// toml-reader.js -- TOML 邏輯語句讀取器（純函式、零 IO、零外部相依）
//
// 由 safety-check.js 直接 require，供 `.toml` 結構化掃描辨識 section header 與
// key-value，正確歸屬 key 所屬 section（hard block／warning 判斷的前提）。
//
// 前身為 codex-config.js 的解析半部：該模組原同時承載 Codex `config.toml` 的
// 過濾同步（parse／serialize／merge）與這組讀取器。config.toml 同步已移除
// （改由 README 列建議設定、使用者手動套用），過濾與序列化隨之刪除；讀取器
// 因 safety:check 的 TOML 掃描仍依賴而保留，抽成本檔並改為通用 TOML 命名。
//
// 不要把本檔當成 MCP 同步的遺留物清掉：MCP 同步（advisory 型）已於
// remove-mcp-sync 整批移除，但本檔與該機制**無因果關係**——它服務的是
// safety-check.js 對 repo 內任何 `.toml` 的機密 section hard block，擋的是
// 「有人手動把 ~/.codex/config.toml 複製進 repo 備份」，這風險不隨 MCP
// 是否同步而改變。boundary.test.js 有專門的回歸測試鎖住這點。
//
// 跨行語法：逐行掃描，以 scanTomlValueState（追蹤陣列括號淨深度與三引號字串
// 開閉，略過字串／註解內字元）偵測未閉合的多行陣列與 """／''' 三引號字串並併入
// 續行，避免逐行截斷成無效 TOML。matchTomlHeader 顯式辨識 array-of-tables
// （[[x]]）與一般 table（[x]），杜絕字串內的 [x] 樣式被誤判為 section header
// 而錯標 key 歸屬。
// =============================================================================

/**
 * 掃描 value 文字，回報「陣列括號淨深度」與「三引號字串是否未閉合」。
 * 逐字元走訪，略過單／雙引號字串、三引號字串（`"""`／`'''`）與行內 `#` 註解內容，
 * 只在字串／註解外計算 `[`／`]`，供跨行續行偵測用。
 * @param {string} text
 * @returns {{ depth: number, openTriple: boolean }}
 */
function scanTomlValueState(text) {
  let depth = 0;
  let quote = null;
  let triple = null;
  for (let i = 0; i < text.length;) {
    if (triple) {
      if (text.startsWith(triple, i)) { triple = null; i += 3; } else i += 1;
      continue;
    }
    if (quote) {
      if (quote === '"' && text[i] === '\\') { i += 2; continue; }
      if (text[i] === quote) quote = null;
      i += 1;
      continue;
    }
    if (text.startsWith('"""', i)) { triple = '"""'; i += 3; continue; }
    if (text.startsWith("'''", i)) { triple = "'''"; i += 3; continue; }
    const ch = text[i];
    if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
    if (ch === '#') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    i += 1;
  }
  return { depth, openTriple: triple !== null };
}

/**
 * 判斷 value 文字是否尚未完結（多行陣列未閉合或三引號字串未閉合），需併入續行。
 * @param {string} text
 * @returns {boolean}
 */
function isIncompleteTomlValue(text) {
  const state = scanTomlValueState(text);
  return state.depth > 0 || state.openTriple;
}

/**
 * 找出 section 名的結束位置：自 `from` 起掃到第一個「不在引號內」的 `]`。
 * TOML 允許 section 名含引號 key（`[projects."/home/a]b"]`），引號內的 `]` 不得
 * 視為閉合——用 regex `[^\]]+` 會在此提前截斷、整行無法辨識為 header，導致其下
 * 的 key 被誤掛到前一個 section（safety:check 的 hard block 會因此漏判）。
 * @param {string} text
 * @param {number} from - 起始索引（`[` 或 `[[` 之後）
 * @returns {number} `]` 的索引；找不到（含引號未閉合）回傳 -1
 */
function findTomlHeaderEnd(text, from) {
  let quote = null;
  for (let i = from; i < text.length;) {
    const ch = text[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { i += 2; continue; }  // 基本字串的跳脫（字面字串不處理）
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
    if (ch === ']') return i;
    i += 1;
  }
  return -1;
}

/**
 * 比對 TOML section header：array-of-tables（`[[x]]`）與一般 table（`[x]`）。
 * 引號感知（見 findTomlHeaderEnd）：section 名可含帶 `]` 的引號 key。
 * 尾端只允許空白與註解；不合規（未閉合、`[[x]` 之類）一律回 null 視為 malformed。
 * @param {string} trimmed - 已 trim 的整行
 * @returns {{ type: 'section', name: string, arrayTable: boolean }|null}
 */
function matchTomlHeader(trimmed) {
  if (!trimmed.startsWith('[')) return null;
  const arrayTable = trimmed.startsWith('[[');
  const open = arrayTable ? 2 : 1;

  const end = findTomlHeaderEnd(trimmed, open);
  if (end === -1) return null;

  const name = trimmed.slice(open, end).trim();
  if (name === '') return null;

  let rest = trimmed.slice(end + 1);
  if (arrayTable) {
    if (!rest.startsWith(']')) return null;  // `[[x]` 缺一個閉合
    rest = rest.slice(1);
  }
  if (!/^\s*(?:#.*)?$/.test(rest)) return null;  // 尾端只容許空白／註解

  return { type: 'section', name, arrayTable };
}

/** TOML basic string 的單字元跳脫對照（`\uXXXX`／`\UXXXXXXXX` 另行處理） */
const TOML_SIMPLE_ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

/**
 * 解碼 TOML basic string 的跳脫序列。
 * 不解碼會留下繞過破口：`["mcp_servers"]` 與 `[mcp_servers]` 在 TOML 語意上同名，
 * Codex 照讀，但字面比對不會命中 hard block 清單。
 * 遇非標準跳脫（TOML 本身即為 parse error）回傳 null，由呼叫端 fail closed。
 * @param {string} body - 已去除包夾雙引號的內容
 * @returns {string|null}
 */
function decodeTomlBasicString(body) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') { out += body[i]; continue; }
    const c = body[i + 1];
    if (c !== undefined && Object.prototype.hasOwnProperty.call(TOML_SIMPLE_ESCAPES, c)) {
      out += TOML_SIMPLE_ESCAPES[c];
      i += 1;
      continue;
    }
    if (c !== 'u' && c !== 'U') return null;
    const len = c === 'u' ? 4 : 8;
    const hex = body.slice(i + 2, i + 2 + len);
    if (hex.length !== len || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
    const cp = parseInt(hex, 16);
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return null;  // 非法 scalar value
    out += String.fromCodePoint(cp);
    i += 1 + len;
  }
  return out;
}

/**
 * 去除單一 dotted 片段包夾的一層引號（基本 `"..."` 或字面 `'...'`），並 trim 未引號空白。
 * 基本字串另解碼跳脫序列；無法解碼回傳 null（fail closed，見 decodeTomlBasicString）。
 * @param {string} seg
 * @returns {string|null}
 */
function dequoteTomlKey(seg) {
  const t = seg.trim();
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1);
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return decodeTomlBasicString(t.slice(1, -1));
  return t;
}

/**
 * 將 TOML section／key 名切成 dotted 片段（引號感知），每段去除包夾引號。
 * 例：`mcp_servers."a.b"` → ['mcp_servers', 'a.b']；`"model_providers"` → ['model_providers']。
 * 供 safety-check 正規化後比對機密 section 名——`["mcp_servers"]` 這種以引號包裝的
 * 合法變體語意等同 `[mcp_servers]`，若不正規化就比對會靜默繞過 hard block。
 * 引號內的 `.` 不視為分隔（TOML 語意），故不能用 String.split('.')。
 *
 * **回傳 null 表示不可信**：任一片段含無法解碼的跳脫序列時整體回 null，呼叫端須
 * fail closed（比照 malformed header）——名字解不出來時機密判斷失去依據。
 * @param {string} name
 * @returns {string[]|null}
 */
function splitTomlKey(name) {
  const segments = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < name.length; i += 1) {
    const ch = name[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { buf += name.slice(i, i + 2); i += 1; continue; }
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '.') { segments.push(buf); buf = ''; continue; }
    buf += ch;
  }
  segments.push(buf);
  const parts = segments.map(dequoteTomlKey);
  return parts.some(p => p === null) ? null : parts;
}

/**
 * 合法 TOML key path 形狀（dotted 的 bare key／引號字串，允許週邊空白）。
 * 用於區辨「真的 section header」與「多行陣列的續行剛好以 [ 開頭」（如 `[3, 4]`）。
 */
const TOML_KEY_PATH_SHAPE = /^\s*(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:\.\s*(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')\s*)*$/;

/** 此行是否「看起來是 section header」——續行併吞不得跨越它（見 consumeTomlValue） */
function looksLikeSectionHeader(trimmed) {
  const header = matchTomlHeader(trimmed);
  return header !== null && TOML_KEY_PATH_SHAPE.test(header.name);
}

/**
 * 自 `index` 行起併吞未閉合 value 的續行，回傳停止位置與完整 value。
 *
 * **fail closed**：到 EOF 仍未閉合、或**未閉合陣列**的併吞會跨越一行「看起來是
 * section header」的行時，回報 `malformed: true` 且**不消耗**那行 header。
 * 無條件併吞是 fail-open——`notify = [`（未閉合）之下的 `[mcp_servers.acme]` 會被吞進
 * value、永不 emit 成 section，機密 section 的 hard block 因此靜默消失。比照同檔
 * malformed header 的 fail-closed 設計：解析不出來就交給人工檢視，不靜默吞掉。
 *
 * header 檢查**只在陣列未閉合時生效**：三引號字串的內容對 TOML 而言是不透明的，
 * 其中出現 `[x]` 樣式的行完全合法（既有回歸測試涵蓋），在那裡中斷併吞會把合法檔
 * 誤報成 malformed。未閉合的三引號字串仍會一路吞到 EOF，由 EOF 分支 fail closed。
 * @param {string[]} lines
 * @param {number} index - key-value 起始行索引
 * @param {string} value - 該行 `=` 之後的初始 value 文字
 * @returns {{ index: number, value: string, rawLines: string[], malformed: boolean }}
 */
function consumeTomlValue(lines, index, value) {
  const rawLines = [lines[index]];
  let i = index;
  let text = value;
  for (;;) {
    const state = scanTomlValueState(text);
    if (state.depth <= 0 && !state.openTriple) return { index: i, value: text, rawLines, malformed: false };
    if (i + 1 >= lines.length) return { index: i, value: text, rawLines, malformed: true };
    if (!state.openTriple && looksLikeSectionHeader(lines[i + 1].trim())) {
      return { index: i, value: text, rawLines, malformed: true };
    }
    i += 1;
    rawLines.push(lines[i]);
    text += `\n${lines[i]}`;
  }
}

/**
 * 將 TOML 內容拆成邏輯語句 token：section header、key-value（含跨行多行陣列／
 * 三引號字串，`value`／`raw` 保留完整原文）、其餘（空行／註解／無法辨識）。
 * 逐行掃描，遇未閉合陣列或三引號字串時併入後續行，避免逐行截斷損毀。
 *
 * **malformed section**：以 `[` 開頭卻無法解析為合法 header 的行，回傳
 * `{type:'section', name:null, reason:'header'}`。這是 fail-closed 設計——若退回
 * `other`，該行之下的 key 會沿用前一個 section 而被錯誤歸屬（消費端據此判斷機密
 * section 時會漏判）。標為 section 可讓消費端知道「這裡有 section 邊界，但名字不可信」。
 *
 * **未閉合 value** 同樣回傳 `{type:'section', name:null, reason:'unterminated-value'}`
 * （見 consumeTomlValue）：檔案已非合法 TOML，其後的 section 歸屬不可信。`reason`
 * 供消費端區分回報分類，兩者皆須 fail closed。
 *
 * @param {string} content
 * @returns {Array<{type:'section',name:string|null,arrayTable:boolean,raw:string,line:number}|{type:'kv',key:string,value:string,raw:string,line:number}|{type:'other',raw:string,line:number}>}
 */
function readTomlStatements(content) {
  const lines = content.split(/\r?\n/);
  const statements = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { statements.push({ type: 'other', raw, line }); continue; }
    const header = matchTomlHeader(trimmed);
    if (header) { statements.push({ ...header, raw, line }); continue; }
    // `[` 開頭但解析失敗 → malformed section 邊界（不得退回 other 讓 key 誤掛前一 section）
    if (trimmed.startsWith('[')) {
      statements.push({ type: 'section', name: null, arrayTable: false, reason: 'header', raw, line });
      continue;
    }
    const kv = trimmed.match(/^(.+?)\s*=(.*)$/);
    if (!kv) { statements.push({ type: 'other', raw, line }); continue; }
    const consumed = consumeTomlValue(lines, i, kv[2].replace(/^[ \t]+/, ''));
    i = consumed.index;
    if (consumed.malformed) {
      // 未閉合 value：標為不可信 section 邊界，且不吞掉其後的 header（見 consumeTomlValue）
      statements.push({ type: 'section', name: null, arrayTable: false, reason: 'unterminated-value', raw, line });
      continue;
    }
    statements.push({ type: 'kv', key: kv[1].trim(), value: consumed.value, raw: consumed.rawLines.join('\n'), line });
  }
  return statements;
}

// scanTomlValueState 僅為 isIncompleteTomlValue 的內部實作細節，無外部消費者、不導出
module.exports = {
  isIncompleteTomlValue,
  matchTomlHeader,
  splitTomlKey,
  readTomlStatements,
};
