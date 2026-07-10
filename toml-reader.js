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

/**
 * 將 TOML 內容拆成邏輯語句 token：section header、key-value（含跨行多行陣列／
 * 三引號字串，`value`／`raw` 保留完整原文）、其餘（空行／註解／無法辨識）。
 * 逐行掃描，遇未閉合陣列或三引號字串時併入後續行，避免逐行截斷損毀。
 *
 * **malformed section**：以 `[` 開頭卻無法解析為合法 header 的行，回傳
 * `{type:'section', name:null}`。這是 fail-closed 設計——若退回 `other`，該行
 * 之下的 key 會沿用前一個 section 而被錯誤歸屬（消費端據此判斷機密 section 時
 * 會漏判）。標為 section 可讓消費端知道「這裡有 section 邊界，但名字不可信」。
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
      statements.push({ type: 'section', name: null, arrayTable: false, raw, line });
      continue;
    }
    const kv = trimmed.match(/^(.+?)\s*=(.*)$/);
    if (!kv) { statements.push({ type: 'other', raw, line }); continue; }
    let value = kv[2].replace(/^[ \t]+/, '');
    const rawLines = [raw];
    while (isIncompleteTomlValue(value) && i + 1 < lines.length) {
      i += 1;
      rawLines.push(lines[i]);
      value += `\n${lines[i]}`;
    }
    statements.push({ type: 'kv', key: kv[1].trim(), value, raw: rawLines.join('\n'), line });
  }
  return statements;
}

module.exports = {
  scanTomlValueState,
  isIncompleteTomlValue,
  matchTomlHeader,
  readTomlStatements,
};
