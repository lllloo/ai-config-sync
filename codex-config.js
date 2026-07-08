'use strict';

// =============================================================================
// codex-config.js -- Codex config.toml 過濾同步模組
//
// 從 sync.js 抽出的獨立模組：承載 Codex `config.toml` 的 TOML parse／serialize、
// 可攜欄位判斷、方向相依 merge、load／get 與 apply 進出口，以及專屬常數
// （CODEX_CONFIG_TOP_KEYS、CODEX_CONFIG_SECTION_KEYS）。對外入口仍是
// `node sync.js`（to-repo／to-local／diff／status），本檔不作為獨立 CLI 執行。
//
// 邊界原則（見 openspec/changes/extract-codex-config-module/design.md）：
// - 不反向 require sync.js。純 parse／serialize／merge 無 IO，直接匯出；
//   load／get／apply 需讀寫檔，經 createCodexConfigHandler(deps) 由 sync.js
//   注入共用工具（readFileSafe、writeTextSafe、REPO_ROOT、CODEX_HOME）。
// - 專屬常數由本檔持有並匯出，sync.js re-export 供既有測試引用，避免漂移。
// - diff 渲染屬 diff 引擎、留在 sync.js，只回呼本檔匯出的純函式與 handler。
// =============================================================================

const fs = require('fs');
const path = require('path');

/** Codex config.toml 中允許跨裝置同步的 top-level key */
const CODEX_CONFIG_TOP_KEYS = ['personality', 'web_search'];

/** Codex config.toml 中允許跨裝置同步的固定 section key */
const CODEX_CONFIG_SECTION_KEYS = {
  tui: ['status_line'],
  features: ['memories', 'goals'],
  memories: ['generate_memories', 'use_memories'],
};

// -----------------------------------------------------------------------------
// 純函式：TOML parse／serialize／merge（無 IO，直接匯出）
// -----------------------------------------------------------------------------

/**
 * 判斷 Codex config.toml key 是否可跨裝置同步
 * @param {string} section - TOML section 名稱，top-level 為空字串
 * @param {string} key - TOML key
 * @returns {boolean}
 */
function isPortableCodexConfigKey(section, key) {
  if (section === '') return CODEX_CONFIG_TOP_KEYS.includes(key);
  if (section.startsWith('plugins.')) return key === 'enabled';
  return (CODEX_CONFIG_SECTION_KEYS[section] || []).includes(key);
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
 * 從 TOML 內容萃取可攜 Codex config 欄位；保留 value 原始字串
 * @param {string} content
 * @returns {Map<string, Map<string, string>>}
 */
function parsePortableCodexConfig(content) {
  const data = new Map();
  let section = '';
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=(.*)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    if (isPortableCodexConfigKey(section, key)) {
      setCodexConfigValue(data, section, key, keyMatch[2].trimStart());
    }
  }
  return data;
}

/**
 * 取得 section 中依固定順序輸出的 key
 * @param {Map<string, Map<string, string>>} data
 * @param {string} section
 * @returns {string[]}
 */
function getCodexConfigKeys(data, section) {
  if (section === '') return CODEX_CONFIG_TOP_KEYS;
  if (section.startsWith('plugins.')) return ['enabled'];
  return CODEX_CONFIG_SECTION_KEYS[section] || [];
}

/**
 * 將可攜 Codex config map 序列化為穩定 TOML
 * @param {Map<string, Map<string, string>>} data
 * @returns {string}
 */
function serializePortableCodexConfig(data) {
  const lines = [];
  pushCodexConfigTopLevel(lines, data);
  for (const section of Object.keys(CODEX_CONFIG_SECTION_KEYS)) {
    pushCodexConfigSection(lines, data, section);
  }
  const plugins = [...data.keys()].filter(s => s.startsWith('plugins.')).sort();
  for (const section of plugins) pushCodexConfigSection(lines, data, section);
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
  const lines = localContent.replace(/\r\n/g, '\n').replace(/\n$/g, '').split('\n');
  const output = [];
  let section = '';
  for (const rawLine of lines) {
    const nextSection = rawLine.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (nextSection) {
      pushRemainingCodexConfigValues(output, remaining, section);
      section = nextSection[1].trim();
      output.push(rawLine);
      continue;
    }
    mergeCodexConfigLine(output, remaining, section, rawLine);
  }
  pushRemainingCodexConfigValues(output, remaining, section);
  appendRemainingCodexConfigSections(output, remaining);
  return `${output.join('\n')}\n`;
}

/**
 * 合併單行 Codex config；受管理欄位以 repo 值取代，不存在於 repo 者移除
 * @param {string[]} output
 * @param {Map<string, Map<string, string>>} remaining
 * @param {string} section
 * @param {string} rawLine
 */
function mergeCodexConfigLine(output, remaining, section, rawLine) {
  const keyMatch = rawLine.trim().match(/^([A-Za-z0-9_-]+)\s*=(.*)$/);
  if (!keyMatch || !isPortableCodexConfigKey(section, keyMatch[1])) {
    output.push(rawLine);
    return;
  }
  const key = keyMatch[1];
  const values = remaining.get(section);
  if (!values || !values.has(key)) return;
  output.push(`${key} = ${values.get(key)}`);
  deleteCodexConfigValue(remaining, section, key);
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
  for (const section of Object.keys(CODEX_CONFIG_SECTION_KEYS)) {
    appendRemainingCodexConfigSection(output, remaining, section);
  }
  const plugins = [...remaining.keys()].filter(s => s.startsWith('plugins.')).sort();
  for (const section of plugins) appendRemainingCodexConfigSection(output, remaining, section);
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
 *   REPO_ROOT: string,
 *   CODEX_HOME: string,
 * }} deps
 * @returns {{
 *   loadPortableCodexConfig: (filePath: string) => ({ data: Map, serialized: string }|null),
 *   getPortableCodexConfig: (filePath: string) => (string|null),
 *   mergeCodexConfigToml: (direction: 'to-repo'|'to-local', dryRun?: boolean) => boolean,
 *   mergeCodexConfigToRepo: (localPath: string, repoPath: string, dryRun: boolean) => boolean,
 *   mergeCodexConfigToLocal: (localPath: string, repoPath: string, dryRun: boolean) => boolean,
 * }}
 */
function createCodexConfigHandler(deps) {
  const { readFileSafe, writeTextSafe, REPO_ROOT, CODEX_HOME } = deps;

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
   * 合併 Codex config.toml（只同步 allowlist 欄位）
   * @param {'to-repo'|'to-local'} direction - 同步方向
   * @param {boolean} [dryRun=false] - 是否為 dry-run 模式
   * @returns {boolean} 是否有實際變更
   */
  function mergeCodexConfigToml(direction, dryRun = false) {
    const localPath = path.join(CODEX_HOME, 'config.toml');
    const repoPath = path.join(REPO_ROOT, 'codex', 'config.toml');
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
  CODEX_CONFIG_SECTION_KEYS,
  parsePortableCodexConfig,
  serializePortableCodexConfig,
  mergePortableCodexConfig,
  createCodexConfigHandler,
};
