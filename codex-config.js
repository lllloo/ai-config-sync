'use strict';

// =============================================================================
// codex-config.js -- Codex config.toml 過濾同步模組
//
// 從 sync.js 抽出的獨立模組：承載 Codex `config.toml` 的 TOML parse／serialize、
// 可攜欄位判斷、方向相依 merge、load／get 與 apply 進出口，以及專屬常數
// （CODEX_CONFIG_TOP_KEYS、CODEX_CONFIG_DEVICE_SECTION_PREFIXES）。對外入口仍是
// `node sync.js`（to-repo／to-local／diff／status），本檔不作為獨立 CLI 執行。
//
// 過濾策略：section 級黑名單混合制（見 flip-codex-config-to-blocklist/design.md）。
// 預設同步各 section，僅排除列於 CODEX_CONFIG_DEVICE_SECTION_PREFIXES 者（整段丟棄，
// safe-by-construction）；兩個精確 carve-out——top-level 維持 CODEX_CONFIG_TOP_KEYS
// 窄允許清單（缺 Codex 權威 schema，D3）、`plugins.*` 維持 enabled-only（開放 key
// 空間，D2）。第 2 層由 safety:check 對機密 section hard block 兜底。
//
// 邊界原則（見 openspec/changes/extract-codex-config-module/design.md）：
// - 不反向 require sync.js。純 parse／serialize／merge 無 IO，直接匯出；
//   load／get／apply 需讀寫檔，經 createCodexConfigHandler(deps) 由 sync.js
//   注入共用工具（readFileSafe、writeTextSafe、REPO_ROOT、CODEX_HOME）。
// - 專屬常數由本檔持有並匯出，sync.js re-export 供既有測試引用，避免漂移。
// - diff 渲染屬 diff 引擎、留在 sync.js，只回呼本檔匯出的純函式與 handler。
// =============================================================================

const fs = require('fs');

/**
 * top-level 維持窄允許清單 carve-out（見 design D3）：Codex top-level 尚有 model／
 * approval_policy／sandbox_mode 等裝置 key 且隨版本增生，缺權威 schema 無法安全反列，
 * 故此層刻意不翻黑名單，只放行列舉的可攜 key。
 */
const CODEX_CONFIG_TOP_KEYS = ['personality', 'web_search'];

/**
 * Section 級黑名單權威清單（見 design D1）：section 名等於清單項、或以 `<項>.` 為
 * 前綴者，整段（含所有 key）不同步。內容為機密載體（model_providers.*.api_key、
 * mcp_servers.*）、本機路徑（projects、profiles）、裝置狀態（history、
 * shell_environment_policy、tui.model_availability_nux）。邊界落在 section 層、
 * 整段排除即 safe-by-construction，且 section 邊界粗、跨 Codex 版本穩定。
 * config.toml 同步採「預設同步 + 此黑名單排除 + top-level/plugins carve-out」，
 * 漏列新機密 section 的殘留風險由 safety:check 對已知機密 section 的 hard block 兜底。
 */
const CODEX_CONFIG_DEVICE_SECTION_PREFIXES = [
  'model_providers', 'mcp_servers', 'projects', 'profiles', 'history',
  'shell_environment_policy', 'tui.model_availability_nux',
];

// -----------------------------------------------------------------------------
// 純函式：TOML parse／serialize／merge（無 IO，直接匯出）
// -----------------------------------------------------------------------------

/**
 * 判斷 section 是否命中 section 級黑名單（等於清單項或以 `<項>.` 為前綴）→ 整段排除
 * @param {string} section - TOML section 名稱，top-level 為空字串
 * @returns {boolean}
 */
function isDeviceCodexSection(section) {
  if (section === '') return false;
  return CODEX_CONFIG_DEVICE_SECTION_PREFIXES.some(
    prefix => section === prefix || section.startsWith(`${prefix}.`),
  );
}

/**
 * 判斷 Codex config.toml key 是否可跨裝置同步（section 黑名單混合制，見 design D1–D3）。
 * 三分支明列避免漂移：
 * - section 命中黑名單 → 整段排除
 * - top-level（section === ''）→ 只放行 CODEX_CONFIG_TOP_KEYS 窄允許清單（D3 carve-out）
 * - `plugins.*` → 只放行 enabled（D2 carve-out，plugin 為開放 key 空間、可能載憑證）
 * - 其餘 section → 全部 key 放行（含 Codex 未來新增的 section／key）
 * @param {string} section - TOML section 名稱，top-level 為空字串
 * @param {string} key - TOML key
 * @returns {boolean}
 */
function isPortableCodexConfigKey(section, key) {
  if (isDeviceCodexSection(section)) return false;
  if (section === '') return CODEX_CONFIG_TOP_KEYS.includes(key);
  if (section.startsWith('plugins.')) return key === 'enabled';
  return true;
}

/**
 * 寫入 Codex config map
 * @param {Map<string, Map<string, string>>} data
 * @param {string} section
 * @param {string} key
 * @param {string} value
 */
function setCodexConfigValue(data, section, key, value) {
  if (!data.has(section)) data.set(section, new Map());
  data.get(section).set(key, value);
}

/**
 * 掃描 value 文字，回報「陣列括號淨深度」與「三引號字串是否未閉合」。
 * 逐字元走訪，略過單／雙引號字串、三引號字串（`"""`／`'''`）與行內 `#` 註解內容，
 * 只在字串／註解外計算 `[`／`]`，供跨行續行偵測用。
 * @param {string} text
 * @returns {{ depth: number, openTriple: boolean }}
 */
function scanCodexValueState(text) {
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
function isIncompleteCodexValue(text) {
  const state = scanCodexValueState(text);
  return state.depth > 0 || state.openTriple;
}

/**
 * 比對 TOML section header：array-of-tables（`[[x]]`）與一般 table（`[x]`）。
 * @param {string} trimmed - 已 trim 的整行
 * @returns {{ type: 'section', name: string, arrayTable: boolean }|null}
 */
function matchCodexHeader(trimmed) {
  const arrayTable = trimmed.match(/^\[\[([^\]]+)\]\]\s*(?:#.*)?$/);
  if (arrayTable) return { type: 'section', name: arrayTable[1].trim(), arrayTable: true };
  const table = trimmed.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
  if (table) return { type: 'section', name: table[1].trim(), arrayTable: false };
  return null;
}

/**
 * 將 TOML 內容拆成邏輯語句 token：section header、key-value（含跨行多行陣列／
 * 三引號字串，`value`／`raw` 保留完整原文）、其餘（空行／註解／無法辨識）。
 * 逐行掃描，遇未閉合陣列或三引號字串時併入後續行，避免逐行截斷損毀。
 * @param {string} content
 * @returns {Array<{type:'section',name:string,arrayTable:boolean,raw:string}|{type:'kv',key:string,value:string,raw:string}|{type:'other',raw:string}>}
 */
function readCodexStatements(content) {
  const lines = content.split(/\r?\n/);
  const statements = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { statements.push({ type: 'other', raw }); continue; }
    const header = matchCodexHeader(trimmed);
    if (header) { statements.push({ ...header, raw }); continue; }
    const kv = trimmed.match(/^(.+?)\s*=(.*)$/);
    if (!kv) { statements.push({ type: 'other', raw }); continue; }
    let value = kv[2].replace(/^[ \t]+/, '');
    const rawLines = [raw];
    while (isIncompleteCodexValue(value) && i + 1 < lines.length) {
      i += 1;
      rawLines.push(lines[i]);
      value += `\n${lines[i]}`;
    }
    statements.push({ type: 'kv', key: kv[1].trim(), value, raw: rawLines.join('\n') });
  }
  return statements;
}

/**
 * 從 TOML 內容萃取可攜 Codex config 欄位；保留 value 原始字串（含多行）。
 * array-of-tables（`[[x]]`）其下 key 一律不視為可攜（真實 array-of-tables section
 * 皆為機密／裝置載體；即使非黑名單也不 round-trip，避免誤序列化成單一 table）。
 * @param {string} content
 * @returns {Map<string, Map<string, string>>}
 */
function parsePortableCodexConfig(content) {
  const data = new Map();
  let section = '';
  let arrayTable = false;
  for (const st of readCodexStatements(content)) {
    if (st.type === 'section') { section = st.name; arrayTable = st.arrayTable; continue; }
    if (st.type !== 'kv' || arrayTable) continue;
    if (isPortableCodexConfigKey(section, st.key)) {
      setCodexConfigValue(data, section, st.key, st.value);
    }
  }
  return data;
}

/**
 * 取得 section 輸出的 key 順序：top-level／plugins 用 carve-out 固定順序，其餘 section
 * 用 parse 時的插入順序（即來源檔內順序），維持輸出穩定
 * @param {Map<string, Map<string, string>>} data
 * @param {string} section
 * @returns {string[]}
 */
function getCodexConfigKeys(data, section) {
  if (section === '') return CODEX_CONFIG_TOP_KEYS;
  if (section.startsWith('plugins.')) return ['enabled'];
  const values = data.get(section);
  return values ? [...values.keys()] : [];
}

/**
 * 將可攜 Codex config map 序列化為穩定 TOML：top-level 先出（固定 key 順序），
 * 其餘非黑名單 section 依插入順序（來源檔順序）輸出
 * @param {Map<string, Map<string, string>>} data
 * @returns {string}
 */
function serializePortableCodexConfig(data) {
  const lines = [];
  pushCodexConfigTopLevel(lines, data);
  for (const section of data.keys()) {
    if (section === '') continue;
    pushCodexConfigSection(lines, data, section);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * 序列化 top-level Codex config key
 * @param {string[]} lines
 * @param {Map<string, Map<string, string>>} data
 */
function pushCodexConfigTopLevel(lines, data) {
  const top = data.get('');
  if (!top) return;
  for (const key of CODEX_CONFIG_TOP_KEYS) {
    if (top.has(key)) lines.push(`${key} = ${top.get(key)}`);
  }
}

/**
 * 序列化單一 Codex config section
 * @param {string[]} lines
 * @param {Map<string, Map<string, string>>} data
 * @param {string} section
 */
function pushCodexConfigSection(lines, data, section) {
  const values = data.get(section);
  if (!values) return;
  const keys = getCodexConfigKeys(data, section).filter(key => values.has(key));
  if (keys.length === 0) return;
  if (lines.length > 0) lines.push('');
  lines.push(`[${section}]`);
  for (const key of keys) lines.push(`${key} = ${values.get(key)}`);
}

/**
 * 複製 Codex config map，供 to-local merge 時逐步刪除已套用欄位
 * @param {Map<string, Map<string, string>>} data
 * @returns {Map<string, Map<string, string>>}
 */
function cloneCodexConfigMap(data) {
  const cloned = new Map();
  for (const [section, values] of data) cloned.set(section, new Map(values));
  return cloned;
}

/**
 * 刪除已套用的 Codex config 欄位
 * @param {Map<string, Map<string, string>>} data
 * @param {string} section
 * @param {string} key
 */
function deleteCodexConfigValue(data, section, key) {
  const values = data.get(section);
  if (!values) return;
  values.delete(key);
  if (values.size === 0) data.delete(section);
}

/**
 * 將 repo 可攜欄位合併進本機 Codex config，保留本機未受管理欄位
 * @param {string} localContent
 * @param {Map<string, Map<string, string>>} portable
 * @returns {string}
 */
function mergePortableCodexConfig(localContent, portable) {
  if (localContent.trim() === '') return serializePortableCodexConfig(portable);
  const remaining = cloneCodexConfigMap(portable);
  const normalized = localContent.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const output = [];
  let section = '';
  let arrayTable = false;
  for (const st of readCodexStatements(normalized)) {
    if (st.type === 'section') {
      pushRemainingCodexConfigValues(output, remaining, section);
      section = st.name;
      arrayTable = st.arrayTable;
      output.push(st.raw);
      continue;
    }
    if (st.type === 'kv' && !arrayTable) mergeCodexConfigStatement(output, remaining, section, st);
    else output.push(st.raw);
  }
  pushRemainingCodexConfigValues(output, remaining, section);
  appendRemainingCodexConfigSections(output, remaining);
  return `${output.join('\n')}\n`;
}

/**
 * 合併單一 key-value 語句（可能多行）；受管理欄位以 repo 值取代，不存在於 repo 者移除，
 * 非受管理欄位保留原文（含原始縮排／多行）。
 * @param {string[]} output
 * @param {Map<string, Map<string, string>>} remaining
 * @param {string} section
 * @param {{key:string, value:string, raw:string}} st
 */
function mergeCodexConfigStatement(output, remaining, section, st) {
  if (!isPortableCodexConfigKey(section, st.key)) {
    output.push(st.raw);
    return;
  }
  const values = remaining.get(section);
  if (!values || !values.has(st.key)) return;
  output.push(`${st.key} = ${values.get(st.key)}`);
  deleteCodexConfigValue(remaining, section, st.key);
}

/**
 * 將既有 section 缺少的 repo 可攜欄位補在 section 結尾
 * @param {string[]} output
 * @param {Map<string, Map<string, string>>} remaining
 * @param {string} section
 */
function pushRemainingCodexConfigValues(output, remaining, section) {
  const values = remaining.get(section);
  if (!values) return;
  for (const key of getCodexConfigKeys(remaining, section)) {
    if (!values.has(key)) continue;
    output.push(`${key} = ${values.get(key)}`);
    deleteCodexConfigValue(remaining, section, key);
  }
}

/**
 * 將本機不存在的可攜 section 追加到檔尾
 * @param {string[]} output
 * @param {Map<string, Map<string, string>>} remaining
 */
function appendRemainingCodexConfigSections(output, remaining) {
  pushRemainingCodexConfigValues(output, remaining, '');
  for (const section of [...remaining.keys()]) {
    if (section === '') continue;
    appendRemainingCodexConfigSection(output, remaining, section);
  }
}

/**
 * 追加單一缺失 section
 * @param {string[]} output
 * @param {Map<string, Map<string, string>>} remaining
 * @param {string} section
 */
function appendRemainingCodexConfigSection(output, remaining, section) {
  if (!remaining.has(section)) return;
  if (output.length > 0 && output[output.length - 1] !== '') output.push('');
  output.push(`[${section}]`);
  pushRemainingCodexConfigValues(output, remaining, section);
}

// -----------------------------------------------------------------------------
// IO 進出口：load／get／apply（經 createCodexConfigHandler 注入共用工具）
// -----------------------------------------------------------------------------

/**
 * 建立 Codex config handler：以 dependency injection 接收 sync.js 的共用工具，
 * 內部 load／get／apply 閉包捕捉 deps，避免反向 require 或逐一穿參。
 * @param {{
 *   readFileSafe: (filePath: string, op?: string, encoding?: string) => string|Buffer,
 *   writeTextSafe: (filePath: string, content: string) => void,
 * }} deps
 * @returns {{
 *   loadPortableCodexConfig: (filePath: string) => ({ data: Map, serialized: string }|null),
 *   getPortableCodexConfig: (filePath: string) => (string|null),
 *   mergeCodexConfigToml: (localPath: string, repoPath: string, direction: 'to-repo'|'to-local', dryRun?: boolean) => boolean,
 *   mergeCodexConfigToRepo: (localPath: string, repoPath: string, dryRun: boolean) => boolean,
 *   mergeCodexConfigToLocal: (localPath: string, repoPath: string, dryRun: boolean) => boolean,
 * }}
 */
function createCodexConfigHandler(deps) {
  const { readFileSafe, writeTextSafe } = deps;

  /**
   * 載入並萃取可攜 Codex config
   * @param {string} filePath
   * @returns {{ data: Map<string, Map<string, string>>, serialized: string } | null}
   */
  function loadPortableCodexConfig(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const data = parsePortableCodexConfig(readFileSafe(filePath, '讀取 Codex 設定', 'utf8'));
    return { data, serialized: serializePortableCodexConfig(data) };
  }

  /**
   * 取得可攜 Codex config TOML 字串
   * @param {string} filePath
   * @returns {string|null}
   */
  function getPortableCodexConfig(filePath) {
    const result = loadPortableCodexConfig(filePath);
    return result ? result.serialized : null;
  }

  /**
   * 合併 Codex config.toml（section 黑名單混合制過濾同步）。
   * 路徑由 caller（sync.js，來自 SYNC_AREAS）注入，模組不再自算路徑。
   * @param {string} localPath - 本機 config.toml 路徑
   * @param {string} repoPath - repo config.toml 路徑
   * @param {'to-repo'|'to-local'} direction - 同步方向
   * @param {boolean} [dryRun=false] - 是否為 dry-run 模式
   * @returns {boolean} 是否有實際變更
   */
  function mergeCodexConfigToml(localPath, repoPath, direction, dryRun = false) {
    if (direction === 'to-repo') return mergeCodexConfigToRepo(localPath, repoPath, dryRun);
    return mergeCodexConfigToLocal(localPath, repoPath, dryRun);
  }

  /**
   * 本機 Codex config.toml -> repo 過濾檔
   * @param {string} localPath
   * @param {string} repoPath
   * @param {boolean} dryRun
   * @returns {boolean}
   */
  function mergeCodexConfigToRepo(localPath, repoPath, dryRun) {
    const portable = loadPortableCodexConfig(localPath);
    if (!portable) return false;
    if (portable.serialized === '' && !fs.existsSync(repoPath)) return false;
    const repoContent = fs.existsSync(repoPath) ? readFileSafe(repoPath, '讀取 repo Codex 設定', 'utf8') : null;
    if (repoContent === portable.serialized) return false;
    if (dryRun) return true;
    writeTextSafe(repoPath, portable.serialized);
    return true;
  }

  /**
   * repo Codex config.toml -> 本機，保留本機未受管理欄位
   * @param {string} localPath
   * @param {string} repoPath
   * @param {boolean} dryRun
   * @returns {boolean}
   */
  function mergeCodexConfigToLocal(localPath, repoPath, dryRun) {
    const portable = loadPortableCodexConfig(repoPath);
    if (!portable) return false;
    const localContent = fs.existsSync(localPath) ? readFileSafe(localPath, '讀取本機 Codex 設定', 'utf8') : '';
    const merged = mergePortableCodexConfig(localContent, portable.data);
    if (localContent === merged) return false;
    if (dryRun) return true;
    writeTextSafe(localPath, merged);
    return true;
  }

  return {
    loadPortableCodexConfig,
    getPortableCodexConfig,
    mergeCodexConfigToml,
    mergeCodexConfigToRepo,
    mergeCodexConfigToLocal,
  };
}

module.exports = {
  CODEX_CONFIG_TOP_KEYS,
  CODEX_CONFIG_DEVICE_SECTION_PREFIXES,
  isDeviceCodexSection,
  matchCodexHeader,
  readCodexStatements,
  parsePortableCodexConfig,
  serializePortableCodexConfig,
  mergePortableCodexConfig,
  createCodexConfigHandler,
};
