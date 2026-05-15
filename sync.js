#!/usr/bin/env node
'use strict';

// =============================================================================
// sync-ai -- 跨裝置 Claude Code 設定同步工具
// 單檔架構，零外部相依
// =============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');

// =============================================================================
// Section: Constants -- 全域常數與設定
// 集中管理所有 magic values，方便查閱與修改
// =============================================================================

/** Process exit codes（語義化，可用於 CI 判斷） */
const EXIT_OK = 0;
const EXIT_DIFF = 1;
const EXIT_ERROR = 2;

/** 路徑常數 */
const REPO_ROOT = __dirname;
const HOME = os.homedir();
const CLAUDE_HOME = path.join(HOME, '.claude');
const CODEX_HOME = path.join(HOME, '.codex');
const AGENTS_HOME = path.join(HOME, '.agents');
const SYNC_HISTORY_LOG = path.join(REPO_ROOT, '.sync-history.log');
const LOCAL_SKILL_LOCK = path.join(AGENTS_HOME, '.skill-lock.json');

/** settings.json 中各裝置獨立的欄位，同步時排除 */
const DEVICE_FIELDS = ['model', 'effortLevel'];

/** settings.json `env` 物件中各裝置獨立的 key，同步時排除（to-local 套用時保留本機值） */
const DEVICE_ENV_KEYS = ['OBSIDIAN_VAULT_ROOT'];

/** Codex config.toml 中允許跨裝置同步的 top-level key */
const CODEX_CONFIG_TOP_KEYS = ['personality', 'web_search'];

/** Codex config.toml 中允許跨裝置同步的固定 section key */
const CODEX_CONFIG_SECTION_KEYS = {
  tui: ['status_line'],
  features: ['memories'],
  memories: ['generate_memories', 'use_memories'],
};

/** 永遠排除的檔案名稱 */
const GLOBAL_EXCLUDE = ['.DS_Store'];

/**
 * LCS DP 行數上限：超過此行數改用近似 diff 以避免 O(mn) 記憶體爆炸
 * （m + n 為兩檔案總行數，2000 大致對應 ~4MB DP 表）
 */
const LCS_MAX_LINES = 2000;

/** help 指令排版用欄寬 */
const CMD_COL_WIDTH = 14;
const ALIAS_COL_WIDTH = 8;

/** 統一的狀態圖示映射表，確保語義一致與對齊 */
const STATUS_ICONS = {
  ok:      { icon: '\u2713', color: 'dim'    },  // 一致
  added:   { icon: '+', color: 'green'  },  // 新增
  changed: { icon: '~', color: 'yellow' },  // 變更
  deleted: { icon: '-', color: 'red'    },  // 刪除
  eol:     { icon: '\u2248', color: 'dim'    },  // 僅檔尾換行差異
  up:      { icon: '\u2191', color: 'cyan'   },  // 本機有、repo 沒有
  down:    { icon: '\u2193', color: 'yellow' },  // repo 有、本機沒有
};

/**
 * 指令定義：統一管理指令名稱、別名、說明與 handler
 * handler 於模組稍後的 attachCommandHandlers() 階段注入（避免 TDZ）
 * @type {Record<string, {alias: string|null, desc: string, handler: ((opts: ParsedArgs) => number|Promise<number>)|null}>}
 */
const COMMANDS = {
  'diff':        { alias: 'd',  desc: '比對本機與 repo 差異',          handler: null },
  'status':      { alias: 's',  desc: '同時比對設定與 skills 差異',     handler: null },
  'to-repo':     { alias: 'tr', desc: '本機設定 -> repo',              handler: null },
  'to-local':    { alias: 'tl', desc: 'repo 設定 -> 本機',              handler: null },
  'skills:diff':   { alias: 'sd', desc: '比對 skills 差異',                handler: null },
  'skills:add':    { alias: 'sa', desc: '新增 skill 到 skills-lock.json',  handler: null },
  'skills:remove': { alias: 'sr', desc: '從 skills-lock.json 移除 skill',  handler: null },
  'init':        { alias: null, desc: '重置為空骨架（fork 後執行一次）',  handler: null },
  'help':        { alias: null, desc: '顯示此說明',                    handler: null },
};

/**
 * Init 指令的檔案對應：把 .example 範本覆寫到正式檔
 * @type {Array<{src: string, dest: string, type: 'json'|'text'}>}
 */
const INIT_FILE_MAP = [
  { src: 'claude/settings.example.json', dest: 'claude/settings.json', type: 'json' },
  { src: 'skills-lock.example.json',     dest: 'skills-lock.json',     type: 'json' },
  { src: 'claude/CLAUDE.example.md',     dest: 'claude/CLAUDE.md',     type: 'text' },
  { src: 'codex/AGENTS.example.md',      dest: 'codex/AGENTS.md',      type: 'text' },
];

/**
 * Init 指令要刪除的個人化 rules 檔（相對 REPO_ROOT）
 * @type {string[]}
 */
const INIT_RULES_TO_REMOVE = [
  'claude/rules/bmad.md',
  'claude/rules/nuxt4.md',
  'claude/rules/obsidian.md',
  'claude/rules/skill-writing.md',
];

/** 由 COMMANDS 自動建立的別名對應表 */
const COMMAND_ALIASES = Object.fromEntries(
  Object.entries(COMMANDS)
    .filter(([_, v]) => v.alias)
    .map(([cmd, v]) => [v.alias, cmd])
);

/** 所有可用指令（由 COMMANDS 自動產生） */
const VALID_COMMANDS = Object.keys(COMMANDS);

// -----------------------------------------------------------------------------
// Type definitions（集中管理，方便查閱）
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} SyncItem
 * @property {string} label - 顯示名稱
 * @property {string} src - 來源路徑
 * @property {string} dest - 目的路徑
 * @property {'file'|'settings'|'codex-config'|'dir'} type - 項目類型
 * @property {string} [verboseSrc] - verbose 模式的來源路徑
 * @property {string} [verboseDest] - verbose 模式的目的路徑
 * @property {string} [prefix] - 顯示路徑前綴（預設 'claude/'，codex 同步項用 'codex/'）
 */

/**
 * @typedef {Object} ParsedArgs
 * @property {string|null} command - 指令名稱
 * @property {boolean} dryRun - 是否為 dry-run 模式
 * @property {boolean} verbose - 是否為 verbose 模式
 * @property {boolean} showVersion - 是否顯示版本
 * @property {boolean} showHelp - 是否顯示 help
 * @property {string[]} extraArgs - 指令之後的額外 positional 引數
 */

// =============================================================================
// Section: ANSI Colors -- 終端機色碼處理
// 只在 TTY 環境下輸出 ANSI 色碼，否則輸出純文字
// =============================================================================

const isTTY = process.stdout.isTTY;
const col = {
  red:    (/** @type {string} */ t) => isTTY ? `\x1b[31m${t}\x1b[0m` : t,
  green:  (/** @type {string} */ t) => isTTY ? `\x1b[32m${t}\x1b[0m` : t,
  yellow: (/** @type {string} */ t) => isTTY ? `\x1b[33m${t}\x1b[0m` : t,
  cyan:   (/** @type {string} */ t) => isTTY ? `\x1b[36m${t}\x1b[0m` : t,
  bold:   (/** @type {string} */ t) => isTTY ? `\x1b[1m${t}\x1b[0m`  : t,
  dim:    (/** @type {string} */ t) => isTTY ? `\x1b[2m${t}\x1b[0m`  : t,
};

// =============================================================================
// Section: Errors -- 統一錯誤處理框架
// 定義 SyncError class，所有錯誤統一經過此 class 拋出
// =============================================================================

/**
 * 統一錯誤類型，包含錯誤代碼與上下文資訊
 * @extends Error
 */
class SyncError extends Error {
  /**
   * @param {string} message - 使用者友善的錯誤訊息
   * @param {string} code - 錯誤代碼（FILE_NOT_FOUND, JSON_PARSE, GIT_ERROR, PERMISSION, INVALID_ARGS）
   * @param {Record<string, unknown>} [context] - 額外上下文
   */
  constructor(message, code, context = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.context = context;
  }
}

/** 錯誤代碼常數 */
const ERR = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  JSON_PARSE:     'JSON_PARSE',
  GIT_ERROR:      'GIT_ERROR',
  PERMISSION:     'PERMISSION',
  INVALID_ARGS:   'INVALID_ARGS',
  IO_ERROR:       'IO_ERROR',
};

/**
 * 根據 SyncError 的 code 輸出友善錯誤訊息（含修復建議）
 * @param {SyncError|Error} err
 * @returns {void}
 */
function formatError(err) {
  if (!(err instanceof SyncError)) {
    console.error(col.red(`  [!] 未預期的錯誤：${err.message}`));
    return;
  }

  const hints = {
    [ERR.FILE_NOT_FOUND]: '請確認檔案路徑是否正確，或先執行一次同步',
    [ERR.JSON_PARSE]:     '請檢查 JSON 檔案格式是否正確（可用 jsonlint 驗證）',
    [ERR.GIT_ERROR]:      '請確認 git 已安裝且目前在 git repository 內',
    [ERR.PERMISSION]:     '請檢查檔案權限，或以適當權限重新執行',
    [ERR.INVALID_ARGS]:   '請參閱 node sync.js help 查看可用指令',
    [ERR.IO_ERROR]:       '請確認磁碟空間充足且檔案未被其他程式鎖定',
  };

  console.error(col.red(`  [!] ${err.message}`));
  // 顯示所有 context 欄位（除 stack 等內部欄位）；path 顯示 relative 避免洩漏
  if (err.context && typeof err.context === 'object') {
    const ignored = new Set(['stack']);
    for (const [key, value] of Object.entries(err.context)) {
      if (ignored.has(key) || value === undefined || value === null) continue;
      const display = key === 'path' ? toRelativePath(String(value)) : String(value);
      console.error(col.dim(`      ${key}：${display}`));
    }
  }
  const hint = hints[err.code];
  if (hint) {
    console.error(col.dim(`      提示：${hint}`));
  }
}

/**
 * 將 fs 例外包成 SyncError，區分權限與一般 IO 錯誤
 * @param {NodeJS.ErrnoException} e
 * @param {string} filePath
 * @param {string} op - 操作名稱（中文），例如 '寫入檔案'
 * @returns {SyncError}
 */
function toSyncFsError(e, filePath, op) {
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    return new SyncError(`無法${op}（權限不足）：${filePath}`, ERR.PERMISSION, { path: filePath });
  }
  return new SyncError(`${op}失敗：${e.message}`, ERR.IO_ERROR, { path: filePath });
}

/**
 * 將絕對路徑轉為相對路徑（相對於 REPO_ROOT 或 cwd），避免洩漏使用者目錄
 * 若 relative 反而更長或跳出太多層，則保留原路徑
 * @param {string} filePath
 * @returns {string}
 */
function toRelativePath(filePath) {
  if (!filePath || !path.isAbsolute(filePath)) return filePath;
  // 優先：若在 REPO_ROOT 內，顯示相對於 repo 的路徑
  const relRepo = path.relative(REPO_ROOT, filePath);
  if (!relRepo.startsWith('..') && relRepo.length < filePath.length) {
    return relRepo || filePath;
  }
  // 其次：若在 HOME 內，以 ~ 代替（避免洩漏使用者名稱）
  if (HOME && filePath.startsWith(HOME + path.sep)) {
    return '~' + filePath.slice(HOME.length).replace(/\\/g, '/');
  }
  // 其它：系統暫存檔等，保留原路徑
  return filePath;
}

// =============================================================================
// Section: Tempfile Registry -- 暫存檔管理
// 確保暫存檔在任何退出路徑（含 SIGINT）都被清理
// =============================================================================

/** @type {Set<string>} 追蹤所有待清理的暫存檔路徑 */
const tempFiles = new Set();

/**
 * 註冊暫存檔路徑，會在 process exit 時自動清理
 * @param {string} filePath - 暫存檔路徑
 * @returns {void}
 */
function registerTempFile(filePath) {
  tempFiles.add(filePath);
}

/**
 * 清理所有已註冊的暫存檔
 * @returns {void}
 */
function cleanupTempFiles() {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch (_) { /* 忽略清理錯誤 */ }
  }
  tempFiles.clear();
}

// 註冊 exit handler，確保暫存檔必定清理
process.on('exit', cleanupTempFiles);

// =============================================================================
// Section: Signal Handling -- 中斷訊號處理
// 攔截 SIGINT/SIGTERM，在同步中斷時給出警告
// =============================================================================

/** @type {boolean} 是否正在執行寫入操作 */
let isWriting = false;

/**
 * 處理中斷訊號：清理暫存檔後以 re-raise signal 方式退出，
 * 讓 OS 設定正確的 exit code
 * @param {string} signal
 * @returns {void}
 */
function handleSignal(signal) {
  cleanupTempFiles();
  if (isWriting) {
    console.error(col.yellow('\n  [!] 同步中斷，部分檔案可能未更新'));
  }
  // 移除自身 handler 後 re-raise signal，讓 OS 設定正確的 exit code
  process.removeListener(signal, handleSignal);
  // Windows 不支援 signal re-raise（會拋 ESRCH），改用慣例 exit code
  if (process.platform === 'win32') {
    process.exit(130); // 128 + SIGINT(2)
  } else {
    process.kill(process.pid, signal);
  }
}

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);

// =============================================================================
// Section: External Tool Detection -- 外部工具可用性快取
// 在模組頂層偵測一次外部 diff 是否可用，避免每次都嘗試 spawn
// =============================================================================

/** @type {boolean|undefined} 快取外部 diff 是否可用 */
let _diffAvailable;

/**
 * 檢查外部 diff 指令是否可用（結果會快取）
 * @returns {boolean}
 */
function isDiffAvailable() {
  if (_diffAvailable === undefined) {
    const result = spawnSync('diff', ['--version'], { encoding: 'utf8' });
    _diffAvailable = result.status === 0;
  }
  return _diffAvailable;
}

// =============================================================================
// Section: FS Utilities -- 檔案系統工具函式
// 封裝檔案讀寫操作，加入防禦性檢查與錯誤處理
// =============================================================================

/**
 * 檢查檔案讀取權限
 * @param {string} filePath - 要檢查的檔案路徑
 * @throws {SyncError} 當檔案無法讀取時
 * @returns {void}
 */
function checkReadAccess(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new SyncError(`檔案不存在：${filePath}`, ERR.FILE_NOT_FOUND, { path: filePath });
    }
    throw new SyncError(`無法讀取檔案：${filePath}`, ERR.PERMISSION, { path: filePath });
  }
}

/**
 * 檢查檔案寫入權限（若檔案已存在）
 * @param {string} filePath - 要檢查的檔案路徑
 * @throws {SyncError} 當檔案無法寫入時
 * @returns {void}
 */
function checkWriteAccess(filePath) {
  if (!fs.existsSync(filePath)) return; // 新檔案不需要檢查
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
  } catch (_) {
    throw new SyncError(`無法寫入檔案（唯讀或權限不足）：${filePath}`, ERR.PERMISSION, { path: filePath });
  }
}

/**
 * 讀取並解析 JSON 檔案，區分「檔案不存在」與「JSON 解析失敗」
 * @param {string} filePath - JSON 檔案路徑
 * @returns {Record<string, unknown>} 解析後的物件
 * @throws {SyncError} FILE_NOT_FOUND 或 JSON_PARSE
 */
function readJson(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new SyncError(`JSON 檔案不存在：${filePath}`, ERR.FILE_NOT_FOUND, { path: filePath });
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      throw new SyncError(`無法讀取 JSON 檔案（權限不足）：${filePath}`, ERR.PERMISSION, { path: filePath });
    }
    throw new SyncError(`無法讀取檔案：${e.message}`, ERR.IO_ERROR, { path: filePath });
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new SyncError(
      `JSON 解析失敗：${filePath}`,
      ERR.JSON_PARSE,
      { path: filePath, parseError: e.message },
    );
  }
}

/**
 * 安全寫入 JSON 檔案（write-to-tmp + rename，防止寫入中途斷電損壞）
 * @param {string} filePath - 目標檔案路徑
 * @param {unknown} data - 要序列化的資料
 * @returns {void}
 */
function writeJsonSafe(filePath, data) {
  checkWriteAccess(filePath);
  const content = JSON.stringify(data, null, 2) + '\n';
  // tmpPath 與目標同目錄，確保 rename 在同一檔案系統內，為原子操作且不會觸發 EXDEV
  const tmpPath = filePath + `.tmp.${process.pid}`;
  registerTempFile(tmpPath);
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw toSyncFsError(e, filePath, '寫入 JSON');
  } finally {
    tempFiles.delete(tmpPath);
  }
}

/**
 * 安全寫入文字檔（write-to-tmp + rename）
 * @param {string} filePath - 目標檔案路徑
 * @param {string} content - 要寫入的文字內容
 * @returns {void}
 */
function writeTextSafe(filePath, content) {
  checkWriteAccess(filePath);
  const tmpPath = filePath + `.tmp.${process.pid}`;
  registerTempFile(tmpPath);
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw toSyncFsError(e, filePath, '寫入文字檔');
  } finally {
    tempFiles.delete(tmpPath);
  }
}

/**
 * 確保目錄存在（遞迴建立）
 * @param {string} dir - 目錄路徑
 * @returns {void}
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 複製單一檔案，回傳是否有實際寫入（或在 dry-run 下是否「將會」寫入）
 * 注意：dry-run 模式下無論 force 為何，都必須比對檔案內容，
 * 只有內容真的不同時才回傳 true
 * @param {string} src - 來源路徑
 * @param {string} dest - 目的路徑
 * @param {boolean} [force=false] - 是否強制覆寫（僅在非 dry-run 時生效）
 * @param {boolean} [dryRun=false] - 若為 true 則只判斷不寫入
 * @returns {boolean} 是否有寫入（或將會寫入）
 */
function copyFile(src, dest, force = false, dryRun = false) {
  if (!fs.existsSync(src)) return false;
  checkReadAccess(src);
  const srcContent = fs.readFileSync(src);

  // dry-run 時一律比對內容，不受 force 影響
  if (dryRun) {
    if (!fs.existsSync(dest)) return true;
    return !srcContent.equals(fs.readFileSync(dest));
  }

  // 非 dry-run：force 或內容不同才寫入
  if (!force && fs.existsSync(dest) && srcContent.equals(fs.readFileSync(dest))) return false;
  checkWriteAccess(dest);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, srcContent);
  return true;
}

/**
 * 判斷 target 路徑（已解析的 realpath）是否落在 root 目錄（或其子目錄）之內
 * 用於阻擋 symlink 逃逸出同步目錄
 * @param {string} targetReal - 已 realpath 的目標絕對路徑
 * @param {string} rootReal - 已 realpath 的根目錄絕對路徑
 * @returns {boolean}
 */
function isPathInside(targetReal, rootReal) {
  if (targetReal === rootReal) return true;
  const root = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return targetReal.startsWith(root);
}

/**
 * 遞迴列出目錄下所有檔案的相對路徑
 * - 目錄不存在（ENOENT）視為空集，其他 IO 錯誤必須拋出避免誤判
 *   （空集被下游當作「無檔案」，若靜默吞錯會讓 to-local 誤刪本機檔案）
 * - symlink 指向的檔案若 realpath 逃出 dir 外，直接跳過（防止洩漏 ~/.ssh 等敏感檔）
 * @param {string} dir - 目錄路徑
 * @param {string} [base=''] - 基底路徑（遞迴用）
 * @param {string} [rootReal] - 根目錄的 realpath（遞迴沿用，避免重複解析）
 * @returns {string[]} 相對路徑陣列
 * @throws {SyncError} 目錄讀取失敗（非 ENOENT）
 */
function getFiles(dir, base = '', rootReal) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw toSyncFsError(e, dir, '讀取目錄');
  }
  if (!rootReal) {
    // realpathSync 失敗會讓後續 isPathInside 防護失效（symlink 可能逃逸），
    // 因此非 ENOENT 錯誤必須 throw，不靜默降級
    try {
      rootReal = fs.realpathSync(dir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw toSyncFsError(e, dir, '解析目錄真實路徑');
    }
  }
  const result = [];
  for (const entry of entries) {
    if (GLOBAL_EXCLUDE.includes(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // 先驗證 symlink 目標仍在根目錄內，避免把 repo 外的敏感檔同步進來
      // ENOENT（broken link）靜默跳過；其他 IO 錯誤 warn 後跳過，方便排查
      let real;
      try {
        real = fs.realpathSync(entryPath);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.warn(col.yellow(`  [warn] 解析 symlink 失敗（${e.code}）：${toRelativePath(entryPath)}`));
        }
        continue;
      }
      if (!isPathInside(real, rootReal)) continue;
      try {
        if (fs.statSync(entryPath).isDirectory()) continue;
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.warn(col.yellow(`  [warn] 讀取 symlink 屬性失敗（${e.code}）：${toRelativePath(entryPath)}`));
        }
        continue;
      }
    }
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...getFiles(entryPath, rel, rootReal));
    } else {
      result.push(rel);
    }
  }
  return result;
}

/**
 * 檢查相對路徑是否符合排除模式
 * @param {string} rel - 相對路徑
 * @param {string} pattern - 排除模式（支援尾部 * 萬用字元）
 * @returns {boolean} 是否符合排除模式
 */
function matchExclude(rel, pattern) {
  if (pattern.endsWith('*')) return rel.startsWith(pattern.slice(0, -1));
  return rel === pattern;
}

/**
 * 整目錄鏡像：以 src 為準同步到 dest，dest 多餘的刪掉
 * 注意：dry-run 模式下一律比對內容，不受 force 影響
 * @param {string} src - 來源目錄
 * @param {string} dest - 目的目錄
 * @param {string[]} [excludePatterns=[]] - 排除模式列表
 * @param {boolean} [force=false] - 是否強制覆寫（僅在非 dry-run 時生效）
 * @param {boolean} [dryRun=false] - 若為 true 則只判斷不寫入
 * @returns {Array<{rel: string, action: string}>} 變更清單
 */
function mirrorDir(src, dest, excludePatterns = [], force = false, dryRun = false) {
  const changed = [];
  if (!fs.existsSync(src)) return changed;
  if (!dryRun) ensureDir(dest);

  const srcFiles = new Set(
    getFiles(src).filter(rel => !excludePatterns.some(p => matchExclude(rel, p)))
  );

  for (const rel of srcFiles) {
    const srcFile = path.join(src, rel);
    const destFile = path.join(dest, rel);
    const srcContent = fs.readFileSync(srcFile);
    const destExists = fs.existsSync(destFile);

    // dry-run 時一律比對內容，不受 force 影響
    const needsWrite = dryRun
      ? (!destExists || !srcContent.equals(fs.readFileSync(destFile)))
      : (force || !destExists || !srcContent.equals(fs.readFileSync(destFile)));

    if (needsWrite) {
      if (!dryRun) {
        try {
          ensureDir(path.dirname(destFile));
          fs.writeFileSync(destFile, srcContent);
        } catch (e) {
          throw toSyncFsError(e, destFile, '寫入檔案');
        }
      }
      changed.push({ rel, action: destExists ? 'updated' : 'added' });
    }
  }

  if (fs.existsSync(dest)) {
    for (const rel of getFiles(dest)) {
      if (!srcFiles.has(rel) && !excludePatterns.some(p => matchExclude(rel, p))) {
        const delPath = path.join(dest, rel);
        if (!dryRun) {
          try {
            fs.rmSync(delPath);
          } catch (e) {
            throw toSyncFsError(e, delPath, '刪除檔案');
          }
        }
        changed.push({ rel, action: 'deleted' });
      }
    }
    if (!dryRun) cleanEmptyDirs(dest);
  }

  return changed;
}

/**
 * 遞迴清除空目錄
 * @param {string} dir - 起始目錄
 * @returns {void}
 */
function cleanEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name);
      cleanEmptyDirs(sub);
      try {
        if (fs.readdirSync(sub).length === 0) fs.rmdirSync(sub);
      } catch (e) {
        // ENOENT（已被其他流程刪除）、ENOTEMPTY（race condition）為預期狀況；
        // 其他錯誤（如 EACCES/EPERM）顯示 warn 便於排查
        if (e.code !== 'ENOENT' && e.code !== 'ENOTEMPTY') {
          console.warn(col.yellow(`  [warn] 清理空目錄失敗（${e.code}）：${toRelativePath(sub)}`));
        }
      }
    }
  }
}

// =============================================================================
// Section: Git Utilities -- Git 操作封裝
// 封裝 git 指令執行，含 stderr 處理與可用性檢查
// =============================================================================

/**
 * 執行 git 指令
 * @param {string[]} args - git 子指令與參數
 * @returns {{stdout: string, stderr: string, status: number|null, ok: boolean}}
 */
function git(args = []) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.error) {
    return { stdout: '', stderr: result.error.message, status: null, ok: false };
  }
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    ok: result.status === 0,
  };
}

/**
 * 檢查是否在 git repo 內
 * @returns {boolean}
 */
function isInsideGitRepo() {
  const result = git(['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}

/**
 * 檢查 git 是否可用
 * @returns {boolean}
 */
function isGitAvailable() {
  const result = git(['--version']);
  return result.ok;
}

// =============================================================================
// Section: Diff Engine -- 差異比較引擎
// 純比較邏輯，不寫入任何檔案
// =============================================================================

/**
 * 比較單一檔案差異
 * @param {string} src - 來源檔案路徑
 * @param {string} dest - 目的檔案路徑
 * @returns {'new'|'changed'|null} 差異狀態
 */
function diffFile(src, dest) {
  if (!fs.existsSync(src)) return fs.existsSync(dest) ? 'deleted' : null;
  if (!fs.existsSync(dest)) return 'new';
  const a = fs.readFileSync(src);
  const b = fs.readFileSync(dest);
  if (a.equals(b)) return null;
  return isEolOnlyDiff(a, b) ? 'eol' : 'changed';
}

/**
 * 判斷兩個 buffer 是否只在「行尾換行」差異（LF/CRLF、是否有檔尾換行）
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean}
 */
function isEolOnlyDiff(a, b) {
  const normalize = (/** @type {Buffer} */ buf) =>
    buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\n+$/g, '');
  return normalize(a) === normalize(b);
}

/**
 * 比較兩個目錄的差異
 * @param {string} src - 來源目錄
 * @param {string} dest - 目的目錄
 * @param {string[]} [excludePatterns=[]] - 排除模式列表
 * @returns {Array<{rel: string, status: 'new'|'changed'|'deleted'}>}
 */
function diffDir(src, dest, excludePatterns = []) {
  const result = [];
  const srcExists = fs.existsSync(src);
  const destExists = fs.existsSync(dest);
  if (!srcExists && !destExists) return result;

  const srcFiles = new Set(
    (srcExists ? getFiles(src) : [])
      .filter(rel => !excludePatterns.some(p => matchExclude(rel, p)))
  );
  const destFiles = new Set(
    (destExists ? getFiles(dest) : [])
      .filter(rel => !excludePatterns.some(p => matchExclude(rel, p)))
  );

  for (const rel of srcFiles) {
    if (!destFiles.has(rel)) {
      result.push({ rel, status: 'new' });
    } else {
      const a = fs.readFileSync(path.join(src, rel));
      const b = fs.readFileSync(path.join(dest, rel));
      if (!a.equals(b)) {
        result.push({ rel, status: isEolOnlyDiff(a, b) ? 'eol' : 'changed' });
      }
    }
  }
  for (const rel of destFiles) {
    if (!srcFiles.has(rel)) result.push({ rel, status: 'deleted' });
  }
  return result;
}

/**
 * 純 JS 實作的 line diff（不依賴外部 diff 指令）
 * 逐行比較兩個字串，輸出新增/刪除的行
 * @param {string} oldText - 舊版文字
 * @param {string} newText - 新版文字
 * @returns {Array<{type: '+'|'-'|' ', line: string}>}
 */
function computeLineDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // LCS-based diff for better quality
  const m = oldLines.length;
  const n = newLines.length;

  // 對於小檔案用完整 LCS，大檔案用簡易逐行比對
  if (m + n > LCS_MAX_LINES) {
    return computeSimpleLineDiff(oldLines, newLines);
  }

  // 標準 LCS DP
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // 回溯產生 diff
  let i = m, j = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: ' ', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: '+', line: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: '-', line: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * 簡易逐行比對（大檔案用，結果為近似值）
 * 注意：使用 Set 比對，重複行只計一次——若舊文字有 3 行 "foo" 而新文字只有 1 行，
 * 此函式不會顯示任何刪除行。呼叫端應以 isApproximate 欄位提示使用者
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {Array<{type: '+'|'-'|' ', line: string, isApproximate?: boolean}>}
 */
function computeSimpleLineDiff(oldLines, newLines) {
  const result = [];
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  for (const line of oldLines) {
    if (!newSet.has(line)) {
      result.push({ type: '-', line });
    } else {
      result.push({ type: ' ', line });
    }
  }
  for (const line of newLines) {
    if (!oldSet.has(line)) {
      result.push({ type: '+', line });
    }
  }
  // 標記為近似結果
  if (result.length > 0) result[0].isApproximate = true;
  return result;
}

/**
 * 顯示兩個檔案的 diff（優先使用外部 diff，fallback 為純 JS 實作）
 * @param {string} srcPath - 新版檔案路徑
 * @param {string} destPath - 舊版檔案路徑
 * @param {string} label - 顯示用標籤
 * @returns {void}
 */
function printFileDiff(srcPath, destPath, label) {
  // 使用快取的可用性檢查，避免每次都 spawn
  if (isDiffAvailable()) {
    const result = spawnSync('diff', ['-u', destPath, srcPath], { encoding: 'utf8' });
    if (!result.error && result.stdout.trim()) {
      console.log(col.bold(`\n  -- ${label}`));
      // relative 路徑用於 header 遮罩，避免洩漏使用者目錄
      const relDest = toRelativePath(destPath);
      const relSrc = toRelativePath(srcPath);
      for (const rawLine of result.stdout.split('\n')) {
        // 跳過 `\ No newline at end of file` 雜訊
        if (rawLine.startsWith('\\ No newline')) continue;
        // 覆寫 header 路徑為 relative 版本
        let line = rawLine;
        if (line.startsWith('--- ')) line = `--- ${relDest}`;
        else if (line.startsWith('+++ ')) line = `+++ ${relSrc}`;
        if (line.startsWith('---') || line.startsWith('+++')) {
          console.log(col.dim('  ' + line));
        } else if (line.startsWith('-')) {
          console.log(col.red('  ' + line));
        } else if (line.startsWith('+')) {
          console.log(col.green('  ' + line));
        } else if (line.startsWith('@@')) {
          console.log(col.cyan('  ' + line));
        } else {
          console.log('  ' + line);
        }
      }
      return;
    }
  }

  // 外部 diff 不可用或無差異，使用純 JS fallback
  printJsDiff(srcPath, destPath, label);
}

/**
 * 純 JS diff 顯示（當外部 diff 指令不可用時的 fallback）
 * @param {string} srcPath - 新版檔案路徑
 * @param {string} destPath - 舊版檔案路徑
 * @param {string} label - 顯示用標籤
 * @returns {void}
 */
function printJsDiff(srcPath, destPath, label) {
  const readOrEmpty = (p) => {
    try { return fs.readFileSync(p, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') return '';
      throw toSyncFsError(e, p, '讀取差異');
    }
  };
  const oldText = readOrEmpty(destPath);
  const newText = readOrEmpty(srcPath);

  const ops = computeLineDiff(oldText, newText);
  const changedOps = ops.filter(op => op.type !== ' ');
  if (changedOps.length === 0) return;

  console.log(col.bold(`\n  -- ${label}`));

  // 大檔案 fallback 時提示使用者結果為近似值
  if (ops.length > 0 && ops[0].isApproximate) {
    console.log(col.dim('  （大檔案模式：以下為近似差異，重複行的位置可能不精確）'));
  }

  // 只顯示有差異的行與前後各 2 行 context
  let lastPrinted = -1;
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].type === ' ') continue;

    const ctxStart = Math.max(0, idx - 2);
    if (ctxStart > lastPrinted + 1 && lastPrinted >= 0) {
      console.log(col.dim('  ...'));
    }
    for (let c = Math.max(ctxStart, lastPrinted + 1); c < idx; c++) {
      if (ops[c].type === ' ') console.log('  ' + ops[c].line);
    }

    if (ops[idx].type === '+') {
      console.log(col.green('  +' + ops[idx].line));
    } else {
      console.log(col.red('  -' + ops[idx].line));
    }
    lastPrinted = idx;

    const ctxEnd = Math.min(ops.length - 1, idx + 2);
    for (let c = idx + 1; c <= ctxEnd; c++) {
      if (ops[c].type === ' ') {
        console.log('  ' + ops[c].line);
        lastPrinted = c;
      } else {
        break;
      }
    }
  }
}

// =============================================================================
// Section: Display Utilities -- 輸出格式化工具
// 統一的狀態行輸出格式，確保對齊與語義一致
// =============================================================================

/**
 * 格式化並輸出一行狀態
 * @param {keyof typeof STATUS_ICONS} type - 狀態類型
 * @param {string} label - 項目名稱
 * @param {string} [desc=''] - 描述文字
 * @returns {void}
 */
function printStatusLine(type, label, desc = '') {
  const entry = STATUS_ICONS[type];
  if (!entry) return;
  const icon = col[entry.color](`[${entry.icon}]`);
  const text = entry.color === 'dim' ? col.dim(label) : label;
  const suffix = desc ? `  ${col[entry.color](desc)}` : '';
  console.log(`  ${icon} ${text}${suffix}`);
}

/**
 * 輸出操作摘要統計行
 * @param {{added: number, updated: number, deleted: number}} stats
 * @returns {void}
 */
function printSummary(stats) {
  const parts = [];
  if (stats.added > 0)   parts.push(col.green(`${stats.added} 個新增`));
  if (stats.updated > 0) parts.push(col.yellow(`${stats.updated} 個更新`));
  if (stats.deleted > 0) parts.push(col.red(`${stats.deleted} 個刪除`));
  if (parts.length === 0) {
    console.log(col.dim('  無任何變更'));
  } else {
    console.log(`  摘要：${parts.join('、')}`);
  }
}

// =============================================================================
// Section: Settings Handler -- settings.json 合併邏輯
// 處理 settings.json 的裝置欄位排除與合併
// =============================================================================

/**
 * 將 settings 物件序列化為 JSON 字串（含結尾換行），與 writeJsonSafe 對齊
 * 唯一序列化入口，確保 to-repo / to-local / diff 三條路徑的比對結果一致
 * @param {Record<string, unknown>} obj
 * @returns {string}
 */
function serializeSettings(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * 將 settings.json 去除裝置欄位後回傳 { clean, serialized }
 * @param {string} filePath - settings.json 路徑
 * @returns {{ clean: Record<string, unknown>, serialized: string } | null} 檔案不存在時回傳 null
 */
function loadStrippedSettings(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = readJson(filePath);
  for (const field of DEVICE_FIELDS) delete data[field];
  stripDeviceEnvKeys(data);
  return { clean: data, serialized: serializeSettings(data) };
}

/**
 * 從 settings 物件 mutate 掉 `env` 下的裝置特定 key；env 清空後整個刪除
 * @param {Record<string, unknown>} data
 */
function stripDeviceEnvKeys(data) {
  if (!data.env || typeof data.env !== 'object') return;
  for (const key of DEVICE_ENV_KEYS) delete data.env[key];
  if (Object.keys(data.env).length === 0) delete data.env;
}

/**
 * 從 local settings 萃取裝置特定欄位與 env key（供 to-local 套用時保留）
 * @param {Record<string, unknown>} local
 * @returns {{ deviceValues: Record<string, unknown>, envPreserve: Record<string, unknown> }}
 */
function extractDeviceValues(local) {
  const deviceValues = {};
  for (const field of DEVICE_FIELDS) {
    if (local[field] !== undefined) deviceValues[field] = local[field];
  }
  const envPreserve = {};
  if (local.env && typeof local.env === 'object') {
    for (const key of DEVICE_ENV_KEYS) {
      if (local.env[key] !== undefined) envPreserve[key] = local.env[key];
    }
  }
  return { deviceValues, envPreserve };
}

/**
 * 將 settings.json 去除裝置欄位後產生 stripped JSON 字串
 * （保留為向後相容介面，內部委派給 loadStrippedSettings）
 * @param {string} filePath - settings.json 路徑
 * @returns {string|null} stripped JSON 字串，檔案不存在時回傳 null
 */
function getStrippedSettings(filePath) {
  const result = loadStrippedSettings(filePath);
  return result ? result.serialized : null;
}

/**
 * 合併 settings.json（排除裝置特定欄位）
 * dry-run 模式下會比對 stripped JSON 是否真的有差異
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @param {boolean} [dryRun=false] - 是否為 dry-run 模式
 * @returns {boolean} 是否有實際變更
 */
function mergeSettingsJson(direction, dryRun = false) {
  const localPath = path.join(CLAUDE_HOME, 'settings.json');
  const repoPath = path.join(REPO_ROOT, 'claude', 'settings.json');

  if (direction === 'to-repo') {
    const stripped = loadStrippedSettings(localPath);
    if (stripped === null) return false;

    const repoContent = fs.existsSync(repoPath)
      ? fs.readFileSync(repoPath, 'utf8')
      : null;
    if (repoContent === stripped.serialized) return false;

    if (dryRun) return true;
    writeJsonSafe(repoPath, stripped.clean);
    return true;
  } else {
    if (!fs.existsSync(repoPath)) return false;
    const repo = readJson(repoPath);
    const repoStr = serializeSettings(repo);

    // 比對 repo 與 stripped local（兩邊皆使用 serializeSettings 確保結尾換行對稱）
    const stripped = loadStrippedSettings(localPath);
    if (stripped && repoStr === stripped.serialized) return false;

    if (dryRun) return true;
    const local = fs.existsSync(localPath) ? readJson(localPath) : {};
    const { deviceValues, envPreserve } = extractDeviceValues(local);
    const merged = { ...repo, ...deviceValues };
    if (Object.keys(envPreserve).length > 0) {
      merged.env = { ...(repo.env || {}), ...envPreserve };
    }
    writeJsonSafe(localPath, merged);
    return true;
  }
}

// =============================================================================
// Section: Codex Config Handler -- config.toml 過濾同步邏輯
// 處理 ~/.codex/config.toml 的可攜欄位萃取與合併
// =============================================================================

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
 * 載入並萃取可攜 Codex config
 * @param {string} filePath
 * @returns {{ data: Map<string, Map<string, string>>, serialized: string } | null}
 */
function loadPortableCodexConfig(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = parsePortableCodexConfig(fs.readFileSync(filePath, 'utf8'));
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
  const repoContent = fs.existsSync(repoPath) ? fs.readFileSync(repoPath, 'utf8') : null;
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
  const localContent = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
  const merged = mergePortableCodexConfig(localContent, portable.data);
  if (localContent === merged) return false;
  if (dryRun) return true;
  writeTextSafe(localPath, merged);
  return true;
}

// =============================================================================
// Section: Operation Log -- 操作日誌
// 每次同步後追加紀錄到 .sync-history.log
// =============================================================================

/**
 * 追加操作日誌
 * @param {string} direction - 操作方向（to-repo / to-local）
 * @param {string[]} changes - 變更清單
 * @returns {void}
 */
function appendSyncLog(direction, changes) {
  try {
    const timestamp = new Date().toISOString();
    const hostname = os.hostname();
    const entry = [
      `[${timestamp}] ${direction} @ ${hostname}`,
      ...changes.map(c => `  ${c}`),
      '',
    ].join('\n');
    fs.appendFileSync(SYNC_HISTORY_LOG, entry + '\n');
  } catch (e) {
    // 日誌寫入失敗不影響主流程，但需 warn 讓使用者察覺 audit trail 中斷
    console.warn(col.yellow(`  [warn] 寫入同步日誌失敗（${e.code || 'unknown'}）：${toRelativePath(SYNC_HISTORY_LOG)}`));
  }
}

// =============================================================================
// Section: Sync Core -- 共用同步邏輯
// buildSyncItems / applySyncItems / showGitStatus
// 三個指令（diff / to-repo / to-local）共用同一套邏輯
// =============================================================================

/**
 * 建立同步項目清單
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @returns {SyncItem[]}
 */
function buildSyncItems(direction) {
  const isToRepo = direction === 'to-repo';
  const localBase = CLAUDE_HOME;
  const repoBase = path.join(REPO_ROOT, 'claude');
  const src = isToRepo ? localBase : repoBase;
  const dest = isToRepo ? repoBase : localBase;
  return [
    ...buildClaudeSyncItems(src, dest, localBase, repoBase),
    ...buildCodexSyncItems(isToRepo),
  ];
}

/**
 * 建立 Claude 同步項目清單
 * @param {string} src
 * @param {string} dest
 * @param {string} localBase
 * @param {string} repoBase
 * @returns {SyncItem[]}
 */
function buildClaudeSyncItems(src, dest, localBase, repoBase) {
  return [
    buildPathSyncItem('CLAUDE.md', src, dest, 'file'),
    // 注意：settings.json 的 src/dest 固定為 localPath/repoPath，不隨 direction 調換。
    // 因為 settings.json 需要特殊的裝置欄位排除邏輯（mergeSettingsJson），
    // 由 mergeSettingsJson 內部根據 direction 決定資料流向。
    {
      label: 'settings.json',
      src: path.join(localBase, 'settings.json'),
      dest: path.join(repoBase, 'settings.json'),
      type: 'settings',
      verboseSrc: path.join(localBase, 'settings.json'),
      verboseDest: path.join(repoBase, 'settings.json'),
    },
    buildPathSyncItem('statusline.sh', src, dest, 'file'),
    buildPathSyncItem('agents', src, dest, 'dir'),
    buildPathSyncItem('commands', src, dest, 'dir'),
    buildPathSyncItem('skills', src, dest, 'dir'),
    buildPathSyncItem('rules', src, dest, 'dir'),
  ];
}

/**
 * 建立一般路徑同步項目
 * @param {string} label
 * @param {string} srcBase
 * @param {string} destBase
 * @param {'file'|'dir'} type
 * @returns {SyncItem}
 */
function buildPathSyncItem(label, srcBase, destBase, type) {
  return {
    label,
    src: path.join(srcBase, label),
    dest: path.join(destBase, label),
    type,
    verboseSrc: path.join(srcBase, label),
    verboseDest: path.join(destBase, label),
  };
}

/**
 * 建立 Codex 同步項目清單
 * @param {boolean} isToRepo
 * @returns {SyncItem[]}
 */
function buildCodexSyncItems(isToRepo) {
  return [
    {
      label: 'AGENTS.md',
      src: isToRepo ? path.join(CODEX_HOME, 'AGENTS.md') : path.join(REPO_ROOT, 'codex', 'AGENTS.md'),
      dest: isToRepo ? path.join(REPO_ROOT, 'codex', 'AGENTS.md') : path.join(CODEX_HOME, 'AGENTS.md'),
      type: 'file',
      verboseSrc: isToRepo ? path.join(CODEX_HOME, 'AGENTS.md') : path.join(REPO_ROOT, 'codex', 'AGENTS.md'),
      verboseDest: isToRepo ? path.join(REPO_ROOT, 'codex', 'AGENTS.md') : path.join(CODEX_HOME, 'AGENTS.md'),
      prefix: 'codex/',
    },
    // Codex config.toml：只同步 allowlist 欄位，其餘本機狀態與裝置欄位保留
    {
      label: 'config.toml',
      src: path.join(CODEX_HOME, 'config.toml'),
      dest: path.join(REPO_ROOT, 'codex', 'config.toml'),
      type: 'codex-config',
      verboseSrc: path.join(CODEX_HOME, 'config.toml'),
      verboseDest: path.join(REPO_ROOT, 'codex', 'config.toml'),
      prefix: 'codex/',
    },
    // Codex agents：與 ~/.codex/agents/ 同步（不依賴 src/dest 變數，路徑固定）
    {
      label: 'agents',
      src: isToRepo ? path.join(CODEX_HOME, 'agents') : path.join(REPO_ROOT, 'codex', 'agents'),
      dest: isToRepo ? path.join(REPO_ROOT, 'codex', 'agents') : path.join(CODEX_HOME, 'agents'),
      type: 'dir',
      verboseSrc: isToRepo ? path.join(CODEX_HOME, 'agents') : path.join(REPO_ROOT, 'codex', 'agents'),
      verboseDest: isToRepo ? path.join(REPO_ROOT, 'codex', 'agents') : path.join(CODEX_HOME, 'agents'),
      prefix: 'codex/',
    },
  ];
}

/**
 * 將 diff status 對應到 stats 欄位 key
 * @param {string|null} status
 * @returns {'added'|'updated'|'deleted'|null}
 */
function statusToStatsKey(status) {
  if (status === 'new') return 'added';
  if (status === 'changed' || status === 'eol') return 'updated';
  if (status === 'deleted') return 'deleted';
  return null;
}

/**
 * 為 settings 項目產生 diff result entry
 * 注意：settings.json 的比對方向固定（local stripped vs repo），不受 direction 參數影響
 * @param {SyncItem} item
 * @returns {{label: string, status: string|null, src: string|null, dest: string, verboseSrc: string, verboseDest: string, itemType: string}}
 */
function diffSettingsItem(item) {
  const localPath = path.join(CLAUDE_HOME, 'settings.json');
  const repoPath = path.join(REPO_ROOT, 'claude', 'settings.json');
  let status = null;
  let tmpSrc = null;
  if (fs.existsSync(localPath)) {
    const stripped = getStrippedSettings(localPath);
    tmpSrc = path.join(os.tmpdir(), `sync-ai-settings-diff-${process.pid}.json`);
    registerTempFile(tmpSrc);
    fs.writeFileSync(tmpSrc, stripped);
    if (!fs.existsSync(repoPath)) {
      status = 'new';
    } else {
      // 與 diffFile 對齊：先判斷是否僅 EOL 差異，避免 CRLF/LF 被誤判為 changed
      const repoBuf = fs.readFileSync(repoPath);
      const strippedBuf = Buffer.from(stripped);
      if (!repoBuf.equals(strippedBuf)) {
        status = isEolOnlyDiff(repoBuf, strippedBuf) ? 'eol' : 'changed';
      }
    }
  }
  return {
    label: `claude/${item.label}`,
    status,
    src: tmpSrc,
    dest: repoPath,
    verboseSrc: localPath,
    verboseDest: repoPath,
    itemType: 'settings',
  };
}

/**
 * 為 Codex config.toml 產生 diff result entry
 * @param {SyncItem} item
 * @returns {{label: string, status: string|null, src: string|null, dest: string, verboseSrc: string, verboseDest: string, itemType: string}}
 */
function diffCodexConfigItem(item) {
  const localPath = path.join(CODEX_HOME, 'config.toml');
  const repoPath = path.join(REPO_ROOT, 'codex', 'config.toml');
  let status = null;
  let tmpSrc = null;
  if (fs.existsSync(localPath)) {
    const portable = getPortableCodexConfig(localPath);
    // portable 為 null 代表本機 config.toml 無可同步欄位，視同無差異
    if (portable !== null) {
      tmpSrc = path.join(os.tmpdir(), `sync-ai-codex-config-diff-${process.pid}.toml`);
      registerTempFile(tmpSrc);
      fs.writeFileSync(tmpSrc, portable);
      if (!fs.existsSync(repoPath)) {
        // 空字串也視為「新增」，避免 truthy 檢查吞掉 portable === '' 的合法新檔
        status = 'new';
      } else {
        const repoBuf = fs.readFileSync(repoPath);
        const portableBuf = Buffer.from(portable);
        if (!repoBuf.equals(portableBuf)) {
          status = isEolOnlyDiff(repoBuf, portableBuf) ? 'eol' : 'changed';
        }
      }
    }
  }
  return {
    label: `codex/${item.label}`,
    status,
    src: tmpSrc,
    dest: repoPath,
    verboseSrc: localPath,
    verboseDest: repoPath,
    itemType: 'codex-config',
  };
}

/**
 * 對同步項目執行 diff，回傳差異清單
 * @param {SyncItem[]} items - 同步項目清單
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @returns {Array<{label: string, status: string|null, src: string|null, dest: string, verboseSrc: string, verboseDest: string, itemType: string}>}
 */
function diffSyncItems(items, direction) {
  const result = [];

  for (const item of items) {
    if (item.type === 'settings') {
      result.push(diffSettingsItem(item));
    } else if (item.type === 'codex-config') {
      result.push(diffCodexConfigItem(item));
    } else if (item.type === 'file') {
      const status = diffFile(item.src, item.dest);
      result.push({
        label: `${item.prefix || 'claude/'}${item.label}`,
        status,
        src: item.src,
        dest: item.dest,
        verboseSrc: item.verboseSrc,
        verboseDest: item.verboseDest,
        itemType: 'file',
      });
    } else if (item.type === 'dir') {
      const diffs = diffDir(item.src, item.dest, item.excludePatterns || []);
      for (const d of diffs) {
        const src = path.join(item.src, d.rel);
        const dest = path.join(item.dest, d.rel);
        result.push({
          label: `${item.prefix || 'claude/'}${item.label}/${d.rel}`,
          status: d.status,
          src,
          dest,
          verboseSrc: src,
          verboseDest: dest,
          itemType: 'dir',
        });
      }
      // 如果目錄無差異，不加入結果（和原 runDiff 行為一致：只有 file 型才顯示 ok）
    }
  }

  return result;
}

/**
 * 執行同步（apply），回傳統計與變更日誌
 * @param {SyncItem[]} items - 同步項目清單
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @param {{dryRun: boolean}} opts
 * @returns {{stats: {added: number, updated: number, deleted: number}, changeLog: string[]}}
 */
function applySyncItems(items, direction, opts) {
  const { dryRun } = opts;
  const stats = { added: 0, updated: 0, deleted: 0 };
  const changeLog = [];

  for (const item of items) {
    if (item.type === 'settings') {
      if (mergeSettingsJson(direction, dryRun)) {
        stats.updated++;
        changeLog.push('settings.json (updated)');
        printStatusLine('changed', 'settings.json');
      }
    } else if (item.type === 'codex-config') {
      if (mergeCodexConfigToml(direction, dryRun)) {
        stats.updated++;
        changeLog.push('codex/config.toml (updated)');
        printStatusLine('changed', 'codex/config.toml');
      }
    } else if (item.type === 'file') {
      const existed = fs.existsSync(item.dest);
      if (copyFile(item.src, item.dest, false, dryRun)) {
        const action = existed ? 'updated' : 'added';
        const displayLabel = `${item.prefix || 'claude/'}${item.label}`;
        stats[action]++;
        changeLog.push(`${displayLabel} (${action})`);
        printStatusLine(action === 'added' ? 'added' : 'changed', displayLabel);
      }
    } else if (item.type === 'dir') {
      for (const c of mirrorDir(item.src, item.dest, item.excludePatterns || [], false, dryRun)) {
        const displayLabel = `${item.prefix || 'claude/'}${item.label}/${c.rel}`;
        stats[c.action]++;
        changeLog.push(`${displayLabel} (${c.action})`);
        const iconType = c.action === 'added' ? 'added' : c.action === 'deleted' ? 'deleted' : 'changed';
        printStatusLine(iconType, displayLabel);
      }
    }
  }

  return { stats, changeLog };
}

/**
 * 顯示 git 狀態（to-repo 完成後）
 * @returns {void}
 */
function showGitStatus() {
  if (!isGitAvailable()) {
    console.log(col.yellow('  Git 不可用，跳過狀態顯示'));
    return;
  }
  if (!isInsideGitRepo()) {
    console.log(col.yellow('  不在 git repo 內，跳過狀態顯示'));
    return;
  }

  const gitStatus = git(['status', '--short']);
  if (!gitStatus.ok) {
    console.log(col.yellow('  無法取得 git 狀態'));
    return;
  }

  if (!gitStatus.stdout.trim()) {
    console.log(col.green('  與 repo 完全一致，無變動'));
    return;
  }

  console.log(col.bold('  Git 變動：\n'));
  for (const line of gitStatus.stdout.trim().split('\n')) {
    console.log('    ' + col.yellow(line));
  }
  const gitDiffResult = git(['diff', '--stat']);
  if (gitDiffResult.ok && gitDiffResult.stdout.trim()) {
    console.log('');
    for (const line of gitDiffResult.stdout.trim().split('\n')) {
      console.log('    ' + col.dim(line));
    }
  }
  console.log('');
  console.log(col.bold('  下一步：'));
  console.log(col.dim('   git add -A && git commit -m "sync: from <hostname>" && git push'));
}

// =============================================================================
// Section: Commands -- 各指令的實作
// diff, to-repo, to-local, skills:diff, skills:add, help
// =============================================================================

/**
 * 在 verbose 模式下輸出檔案完整路徑與大小
 * @param {string} src - 來源路徑
 * @param {string} dest - 目的路徑
 * @returns {void}
 */
function logVerbosePaths(src, dest) {
  const srcSize = fs.existsSync(src) ? fs.statSync(src).size : 0;
  const destSize = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  console.log(col.dim(`      src:  ${toRelativePath(src)} (${srcSize} bytes)`));
  console.log(col.dim(`      dest: ${toRelativePath(dest)} (${destSize} bytes)`));
}

/**
 * 補全無差異項目並排序：file/settings 在前，dir 在後
 * 純函式：不修改傳入的 diffItems 陣列
 * @param {SyncItem[]} items - 原始同步項目清單
 * @param {Array<{label: string, status: string|null, itemType: string}>} diffItems - diff 結果
 * @returns {typeof diffItems} 補全並排序後的新清單
 */
function buildFullDiffList(items, diffItems) {
  // 複製陣列，避免 mutating 呼叫端傳入的物件
  const result = [...diffItems];

  // 補上無差異的 file 與 settings 項目（ok 狀態）
  for (const item of items) {
    if (item.type === 'dir') continue;
    const label = `${item.prefix || 'claude/'}${item.label}`;
    if (!result.some(d => d.label === label)) {
      result.push({
        label,
        status: null,
        src: item.src,
        dest: item.dest,
        verboseSrc: item.verboseSrc,
        verboseDest: item.verboseDest,
        itemType: item.type,
      });
    }
  }

  // 補上無差異的 dir 項目（以摘要行呈現，證明已被檢查）
  for (const item of items) {
    if (item.type !== 'dir') continue;
    const prefix = `${item.prefix || 'claude/'}${item.label}/`;
    const hasAny = result.some(d => d.label.startsWith(prefix));
    if (!hasAny) {
      result.push({
        label: prefix,
        status: null,
        src: item.src,
        dest: item.dest,
        verboseSrc: item.verboseSrc,
        verboseDest: item.verboseDest,
        itemType: 'dir',
      });
    }
  }

  // 排序：使用 itemType 欄位，dir 排在後面
  result.sort((a, b) => {
    const aIsDir = a.itemType === 'dir';
    const bIsDir = b.itemType === 'dir';
    if (aIsDir !== bIsDir) return aIsDir ? 1 : -1;
    return 0;
  });

  return result;
}

/**
 * 輸出詳細的 diff 內容（變更與新增的檔案）
 * @param {Array<{label: string, status: string|null, src: string|null, dest: string}>} diffItems
 * @returns {void}
 */
function printDetailedDiff(diffItems) {
  const substantive = diffItems.filter(
    it => !it.label.startsWith('claude/skills/') &&
          (it.status === 'changed' || it.status === 'new')
  );
  if (substantive.length === 0) return;

  printSectionDivider();
  console.log(col.bold('  詳細差異'));
  printSectionDivider();

  for (const item of substantive) {
    if (item.status === 'changed' && item.src && item.dest) {
      printFileDiff(item.src, item.dest, item.label);
    } else if (item.status === 'new' && item.src && fs.existsSync(item.src)) {
      console.log(col.bold(`\n  -- ${item.label}  ${col.green('（新增）')}`));
      const lines = fs.readFileSync(item.src, 'utf8').split('\n');
      for (const line of lines.slice(0, 30)) console.log(col.green('  +' + line));
      if (lines.length > 30) console.log(col.dim(`  ... 共 ${lines.length} 行`));
    }
  }
}

/**
 * 輸出 section 分隔線（40 字元寬，dim 灰色）
 * @returns {void}
 */
function printSectionDivider() {
  console.log(col.dim('  ' + '\u2500'.repeat(40)));
}

/**
 * diff 指令：比對本機與 repo 的差異
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {number} exit code（EXIT_OK=無差異, EXIT_DIFF=有差異）
 */
function runDiff(opts) {
  console.log('');
  printSectionDivider();
  console.log(col.bold('  本機 vs repo 差異比對'));
  printSectionDivider();
  console.log('');

  const items = buildSyncItems('to-repo');
  const allDiffItems = buildFullDiffList(items, diffSyncItems(items, 'to-repo'));

  let hasDiff = false;
  const skillsSummary = {};
  for (const item of allDiffItems) {
    if (collectSkillDiffSummary(item, skillsSummary)) {
      hasDiff = true;
      continue;
    }
    if (printDiffItem(item, opts)) hasDiff = true;
  }
  printSkillDiffSummaries(skillsSummary);
  if (!hasDiff) {
    console.log(col.green('\n  本機與 repo 完全一致\n'));
    return EXIT_OK;
  }

  printDetailedDiff(allDiffItems);

  console.log(col.bold('\n  下一步：'));
  console.log(`   npm run to-repo   ${col.dim('# 將本機內容寫入 repo，再用 git diff 確認')}`);
  console.log('');

  return EXIT_DIFF;
}

/**
 * 收集 skills 目錄內細項差異，用於摘要顯示
 * @param {{label: string, status: string|null}} item
 * @param {Record<string, {added: number, changed: number, deleted: number}>} summary
 * @returns {boolean} 是否已收集為 skill 摘要
 */
function collectSkillDiffSummary(item, summary) {
  if (!item.label.startsWith('claude/skills/') || item.status === null) return false;
  const skill = item.label.split('/')[2];
  if (!summary[skill]) summary[skill] = { added: 0, changed: 0, deleted: 0 };
  if (item.status === 'new') summary[skill].added++;
  else if (item.status === 'changed') summary[skill].changed++;
  else if (item.status === 'deleted') summary[skill].deleted++;
  return true;
}

/**
 * 輸出單筆 diff 狀態
 * @param {{label: string, status: string|null, verboseSrc?: string, verboseDest?: string, dest?: string}} item
 * @param {ParsedArgs} opts
 * @returns {boolean} 是否有差異
 */
function printDiffItem(item, opts) {
  const statusMap = {
    new: ['added', '本機有、repo 沒有'],
    changed: ['changed', '有差異'],
    eol: ['eol', '僅檔尾換行差異'],
    deleted: ['deleted', 'repo 有、本機沒有'],
  };
  if (item.status === null) {
    printStatusLine('ok', item.label);
  } else if (statusMap[item.status]) {
    printStatusLine(statusMap[item.status][0], item.label, statusMap[item.status][1]);
  }
  if (opts.verbose && item.verboseSrc) logVerbosePaths(item.verboseSrc, item.verboseDest || item.dest);
  return item.status !== null;
}

/**
 * 輸出 skill 差異摘要
 * @param {Record<string, {added: number, changed: number, deleted: number}>} summary
 */
function printSkillDiffSummaries(summary) {
  for (const [skill, counts] of Object.entries(summary)) {
    const parts = [];
    if (counts.added) parts.push(`+${counts.added}`);
    if (counts.changed) parts.push(`~${counts.changed}`);
    if (counts.deleted) parts.push(`-${counts.deleted}`);
    const total = counts.added + counts.changed + counts.deleted;
    const status = counts.deleted && !counts.added ? 'deleted' : 'added';
    printStatusLine(status, `claude/skills/${skill}`, `${parts.join(' ')}  共 ${total} 個檔案`);
  }
}

/**
 * diff:all 指令：依序執行 diff 與 skills:diff
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {number} exit code（有任一差異即回傳 EXIT_DIFF）
 */
function runDiffAll(opts) {
  const diffCode = runDiff(opts);
  const skillsCode = runSkillsDiff();
  return (diffCode === EXIT_OK && skillsCode === EXIT_OK) ? EXIT_OK : EXIT_DIFF;
}

/**
 * to-repo 指令：本機設定同步到 repo
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {number} exit code
 */
function runToRepo(opts) {
  const { dryRun } = opts;

  if (dryRun) {
    console.log(col.bold('\n  [dry-run] 本機 -> repo（不寫入任何檔案）\n'));
  } else {
    console.log(col.bold('\n  本機 -> repo\n'));
  }

  // 檢查 git repo
  if (!dryRun) {
    if (isGitAvailable() && !isInsideGitRepo()) {
      throw new SyncError('目前目錄不在 git repository 內', ERR.GIT_ERROR);
    }
  }

  isWriting = !dryRun;
  try {
    const items = buildSyncItems('to-repo');
    const { stats, changeLog } = applySyncItems(items, 'to-repo', opts);

    console.log('');
    printSummary(stats);

    if (dryRun) {
      console.log(col.dim('\n  以上為預覽，未實際寫入任何檔案'));
      console.log('');
      return EXIT_OK;
    }

    if (changeLog.length > 0) {
      appendSyncLog('to-repo', changeLog);
    }

    console.log('');
    showGitStatus();
    console.log('');
  } finally {
    isWriting = false;
  }

  return EXIT_OK;
}

/**
 * 顯示 to-local 的預覽列表並計算 stats
 * @param {Array<{label: string, status: string|null}>} diffResults
 * @returns {{added: number, updated: number, deleted: number}} previewStats
 */
function printToLocalPreview(diffResults) {
  for (const d of diffResults) {
    if (d.status === 'new') printStatusLine('added', d.label, '將新增');
    else if (d.status === 'changed') printStatusLine('changed', d.label, '將更新');
    else if (d.status === 'eol') printStatusLine('eol', d.label, '將更新（僅檔尾換行）');
    else if (d.status === 'deleted') printStatusLine('deleted', d.label, '將刪除');
  }

  const previewStats = { added: 0, updated: 0, deleted: 0 };
  for (const d of diffResults) {
    const key = statusToStatsKey(d.status);
    if (key) previewStats[key]++;
  }
  return previewStats;
}

/**
 * 詢問使用者並實際套用變更（to-local）
 * @param {SyncItem[]} items
 * @returns {Promise<number>} exit code
 */
async function confirmAndApply(items) {
  console.log('');
  const confirmed = await askConfirm(col.bold('  套用以上變更？(y/N) '));
  if (!confirmed) {
    console.log('\n  已取消\n');
    return EXIT_OK;
  }
  console.log('');

  isWriting = true;
  try {
    const { stats, changeLog } = applySyncItems(items, 'to-local', { dryRun: false });

    console.log('  同步完成：\n');
    printSummary(stats);

    if (changeLog.length > 0) {
      console.log('');
      for (const ch of changeLog) console.log(`    ${ch}`);
      appendSyncLog('to-local', changeLog);
    }
  } finally {
    isWriting = false;
  }

  console.log('');
  return EXIT_OK;
}

/**
 * to-local 指令：repo 設定同步到本機
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {Promise<number>} exit code
 */
async function runToLocal(opts) {
  const { dryRun } = opts;

  if (dryRun) {
    console.log(col.bold('\n  [dry-run] repo -> 本機（不寫入任何檔案）\n'));
  } else {
    console.log(col.bold('\n  repo -> 本機\n'));
  }

  const items = buildSyncItems('to-local');
  const diffResults = diffSyncItems(items, 'to-local');

  if (diffResults.every(d => d.status === null)) {
    console.log(col.green('  本機與 repo 完全一致，無需套用\n'));
    return EXIT_OK;
  }

  if (!dryRun) console.log('  預覽（尚未套用）：\n');
  const previewStats = printToLocalPreview(diffResults);

  if (dryRun) {
    console.log('');
    printSummary(previewStats);
    console.log(col.dim('\n  以上為預覽，未實際寫入任何檔案\n'));
    return EXIT_OK;
  }

  return confirmAndApply(items);
}

// =============================================================================
// Section: Skills Handler -- Skills 管理指令
// skills:diff 與 skills:add 的實作
// =============================================================================

/**
 * 從 skills-lock.json 載入 skills 物件
 * 不存在時回傳空物件；存在但格式異常（缺 skills 物件）時拋 SyncError，避免誤判為無差異
 * @param {string} lockPath
 * @returns {Object<string, {source?: string}>}
 * @throws {SyncError} JSON_PARSE 若 skills 欄位缺失或型別錯誤
 */
function loadSkillsFromLock(lockPath) {
  if (!fs.existsSync(lockPath)) return {};
  const data = readJson(lockPath);
  if (!data || typeof data.skills !== 'object' || data.skills === null || Array.isArray(data.skills)) {
    throw new SyncError(
      `skills-lock.json 格式異常：缺少 skills 物件`,
      ERR.JSON_PARSE,
      { path: lockPath }
    );
  }
  return data.skills;
}

/**
 * skills:diff 指令：比對本機與 repo 的 skills 差異
 * @returns {number} exit code
 */
function runSkillsDiff() {
  console.log('');
  printSectionDivider();
  console.log(col.bold('  Skills 差異比對'));
  printSectionDivider();
  console.log('');

  const repoLockPath = path.join(REPO_ROOT, 'skills-lock.json');
  const localLockPath = LOCAL_SKILL_LOCK;

  const repoSkills = loadSkillsFromLock(repoLockPath);
  const localSkills = loadSkillsFromLock(localLockPath);

  const onlyInRepo  = Object.keys(repoSkills).filter(n => !localSkills[n]);
  const onlyInLocal = Object.keys(localSkills).filter(n => !repoSkills[n]);
  const inBoth      = Object.keys(repoSkills).filter(n =>  localSkills[n]);

  if (inBoth.length === 0 && onlyInRepo.length === 0 && onlyInLocal.length === 0) {
    console.log(col.green('  本機與 repo 完全一致\n'));
    return EXIT_OK;
  }

  for (const name of inBoth)      printStatusLine('ok', name);
  for (const name of onlyInRepo)  printStatusLine('down', name, 'repo 有、本機未安裝');
  for (const name of onlyInLocal) printStatusLine('up', name, '本機有、repo 未記錄');

  if (onlyInRepo.length > 0) {
    console.log(col.bold('\n  -- 安裝缺少的 skills --'));
    for (const name of onlyInRepo) {
      const skill = repoSkills[name];
      if (skill && skill.source) {
        console.log(`    npx skills add ${skill.source} -g -y --skill ${name}`);
      }
    }
  }

  if (onlyInLocal.length > 0) {
    console.log(col.bold('\n  -- 本機多裝的 skills --'));
    console.log(col.dim('    （A）加入 repo 紀錄：'));
    for (const name of onlyInLocal) {
      const skill = localSkills[name];
      if (skill && skill.source) {
        console.log(`      npm run skills:add -- ${name} ${skill.source}`);
      } else {
        console.log(`      npm run skills:add -- ${name} <source>`);
      }
    }
    console.log(col.dim('    （B）從本機移除：'));
    for (const name of onlyInLocal) {
      console.log(`      npx skills remove ${name} -g -y`);
    }
  }

  console.log('');
  return (onlyInRepo.length > 0 || onlyInLocal.length > 0) ? EXIT_DIFF : EXIT_OK;
}

/**
 * 解析 skill 來源引數，回傳 name 與 source
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {{name: string, source: string}}
 * @throws {SyncError} 引數不足或格式錯誤時
 */
function parseSkillSource(opts) {
  const arg1 = opts.extraArgs[0];
  const arg2 = opts.extraArgs[1];
  const usageHint =
    '  用法 1：node sync.js skills:add https://skills.sh/<org>/<repo>/<skill>\n' +
    '  用法 2：node sync.js skills:add <name> <source>';

  if (!arg1) {
    throw new SyncError(`請提供 skill 來源\n${usageHint}`, ERR.INVALID_ARGS);
  }

  if (arg1.startsWith('https://skills.sh/')) {
    const parts = arg1.replace('https://skills.sh/', '').split('/');
    if (parts.length < 3) {
      throw new SyncError(
        '無法解析 skills.sh URL，格式應為 https://skills.sh/<org>/<repo>/<skill>',
        ERR.INVALID_ARGS,
        { url: arg1 },
      );
    }
    return { name: parts[2], source: `${parts[0]}/${parts[1]}` };
  }

  if (arg1 && arg2) {
    return { name: arg1, source: arg2 };
  }

  throw new SyncError(`參數不足\n${usageHint}`, ERR.INVALID_ARGS);
}

/**
 * skills:add 指令：新增 skill 到 skills-lock.json
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {number} exit code
 */
function runSkillsAdd(opts) {
  const { name, source } = parseSkillSource(opts);

  const repoLockPath = path.join(REPO_ROOT, 'skills-lock.json');
  let lock;
  if (fs.existsSync(repoLockPath)) {
    lock = readJson(repoLockPath);
  } else {
    lock = { version: 1, skills: {} };
  }

  if (!lock.skills) lock.skills = {};

  if (lock.skills[name]) {
    console.log(col.yellow(`\n  [!] ${name} 已存在於 skills-lock.json（source: ${lock.skills[name].source}）`));
    console.log(col.dim('  若要更新來源，請手動編輯 skills-lock.json\n'));
    return EXIT_OK;
  }

  lock.skills[name] = { source, sourceType: 'github' };
  writeJsonSafe(repoLockPath, lock);

  console.log(col.bold(`\n  已加入 ${col.cyan(name)}`));
  console.log(col.dim(`  source: ${source}\n`));
  console.log(col.bold('  安裝指令：'));
  console.log(`    npx skills add ${source} -g -y --skill ${name}\n`);
  return EXIT_OK;
}

/**
 * skills:remove 指令：從 skills-lock.json 移除 skill
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {number} exit code
 */
function runSkillsRemove(opts) {
  const name = opts.extraArgs[0];
  if (!name) {
    throw new SyncError(
      '請提供 skill 名稱\n  用法：node sync.js skills:remove <name>',
      ERR.INVALID_ARGS,
    );
  }

  const repoLockPath = path.join(REPO_ROOT, 'skills-lock.json');
  if (!fs.existsSync(repoLockPath)) {
    throw new SyncError('找不到 skills-lock.json', ERR.FILE_NOT_FOUND);
  }

  const lock = readJson(repoLockPath);
  if (!lock.skills || !lock.skills[name]) {
    console.log(col.yellow(`\n  [!] ${name} 不在 skills-lock.json 中\n`));
    return EXIT_OK;
  }

  delete lock.skills[name];
  writeJsonSafe(repoLockPath, lock);

  console.log(col.bold(`\n  已移除 ${col.cyan(name)}`));
  console.log(col.dim('  若本機已安裝，請執行：'));
  console.log(`    npx skills remove ${name} -g -y\n`);
  return EXIT_OK;
}

/**
 * 印出版本號（--version 處理）
 * @returns {void}
 */
function printVersion() {
  const pkg = readPackageJson();
  console.log(pkg ? pkg.version : 'unknown');
}

/**
 * help 指令：顯示所有可用指令與說明
 * @returns {void}
 */
// =============================================================================
// Section: Init -- 重置為空骨架（給 fork 後使用者執行一次）
// =============================================================================

/**
 * Init 指令：把 repo 內作者個人資料重置為空骨架
 * 適用情境：使用 template 建立新 repo 後，第一次執行清空作者範例
 * @param {ParsedArgs} opts
 * @returns {Promise<number>}
 */
async function runInit(opts) {
  console.log(col.bold('\n  sync-ai init'));
  console.log(col.dim('  將下列項目重置為空骨架，方便填入自己的設定：'));
  console.log('');

  for (const item of INIT_FILE_MAP) {
    const destAbs = path.join(REPO_ROOT, item.dest);
    console.log(`    ${col.yellow('~')} ${toRelativePath(destAbs)}  ${col.dim('<- ' + item.src)}`);
  }
  for (const rel of INIT_RULES_TO_REMOVE) {
    const full = path.join(REPO_ROOT, rel);
    if (fs.existsSync(full)) {
      console.log(`    ${col.red('-')} ${toRelativePath(full)}`);
    }
  }
  console.log('');
  console.log(col.dim('  不會動：claude/agents/、codex/agents/、claude/skills/、.agents/skills/、sync.js、test/'));
  console.log('');

  if (opts.dryRun) {
    console.log(col.yellow('  [dry-run] 上述變更未實際執行'));
    return EXIT_OK;
  }

  const ok = await askConfirm(col.bold('  確定要繼續？(y/N) '));
  if (!ok) {
    console.log(col.dim('  已取消'));
    return EXIT_OK;
  }

  applyInitChanges();

  console.log('');
  console.log(col.bold('  下一步：'));
  console.log(col.dim('    1. 改 package.json 的 name 與 description 為你自己的'));
  console.log(col.dim('    2. 主力機執行 npm run to-repo 把本機設定推上 repo'));
  console.log(col.dim('    3. git add . && git commit -m "init: my settings" && git push'));
  console.log(col.dim('    4. 其他裝置 git clone 後執行 npm run to-local 套用'));
  console.log('');
  return EXIT_OK;
}

/**
 * 套用 init 變更：複製 .example 覆寫正式檔、刪除個人 rules
 * @returns {void}
 */
function applyInitChanges() {
  for (const item of INIT_FILE_MAP) {
    const srcAbs = path.join(REPO_ROOT, item.src);
    const destAbs = path.join(REPO_ROOT, item.dest);
    if (item.type === 'json') {
      writeJsonSafe(destAbs, readJson(srcAbs));
    } else {
      writeTextSafe(destAbs, fs.readFileSync(srcAbs, 'utf8'));
    }
    console.log(`    ${col.green('✓')} ${toRelativePath(destAbs)}`);
  }
  for (const rel of INIT_RULES_TO_REMOVE) {
    const full = path.join(REPO_ROOT, rel);
    try {
      fs.unlinkSync(full);
      console.log(`    ${col.green('✓')} 已刪除 ${toRelativePath(full)}`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw toSyncFsError(e, full, '刪除');
    }
  }
}

function runHelp() {
  const pkg = readPackageJson();
  const version = pkg ? pkg.version : 'unknown';

  console.log(col.bold(`\n  sync-ai v${version}`));
  console.log(col.dim('  跨裝置 Claude Code 設定同步工具\n'));

  console.log(col.bold('  指令：'));
  for (const [cmd, def] of Object.entries(COMMANDS)) {
    const aliasRaw = def.alias ? `(${def.alias})` : '';
    const cmdCol = cmd.padEnd(CMD_COL_WIDTH);
    const aliasCol = aliasRaw.padEnd(ALIAS_COL_WIDTH);
    console.log(`    ${col.cyan(cmdCol)}${col.dim(aliasCol)}${def.desc}`);
  }

  console.log(col.bold('\n  旗標：'));
  console.log(`    ${col.cyan('--dry-run')}              預覽操作，不實際寫入`);
  console.log(`    ${col.cyan('--verbose')}              顯示詳細路徑與檔案大小`);
  console.log(`    ${col.cyan('--version')}              顯示版本號`);
  console.log(`    ${col.cyan('--help')}                 顯示此說明`);

  console.log(col.bold('\n  範例：'));
  console.log(col.dim('    node sync.js diff'));
  console.log(col.dim('    node sync.js to-repo --dry-run'));
  console.log(col.dim('    node sync.js skills:add https://skills.sh/anthropics/skills/web-search'));
  console.log('');
}

// =============================================================================
// Section: CLI Parser -- 命令列引數解析
// 集中解析所有 CLI 引數與旗標
// =============================================================================

/**
 * 解析 CLI 引數
 * @returns {ParsedArgs}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    command: null,
    dryRun: false,
    verbose: false,
    showVersion: false,
    showHelp: false,
    extraArgs: [],
  };

  let commandFound = false;
  let pastSeparator = false;

  for (const arg of args) {
    if (arg === '--') {
      // `--` 之後的所有引數皆視為 extraArgs（支援以 `-` 開頭的 skill 名稱等）
      pastSeparator = true;
    } else if (pastSeparator) {
      result.extraArgs.push(arg);
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--version') {
      result.showVersion = true;
    } else if (arg === '--help' || arg === '-h') {
      result.showHelp = true;
    } else if (!arg.startsWith('--')) {
      if (!commandFound) {
        // 第一個 positional arg 是指令
        const resolved = COMMAND_ALIASES[arg] || arg;
        if (VALID_COMMANDS.includes(resolved)) {
          result.command = resolved;
        } else {
          result.command = arg; // 保留原值，由 main() 處理錯誤
        }
        commandFound = true;
      } else {
        // 指令之後的 positional args
        result.extraArgs.push(arg);
      }
    }
  }

  return result;
}

/**
 * 讀取 package.json（使用 readJson，不丟出錯誤）
 * @returns {Record<string, unknown>|null}
 */
function readPackageJson() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  try {
    return readJson(pkgPath);
  } catch (e) {
    // 檔案不存在視為 null（呼叫端會 fallback 為 'unknown'）；
    // JSON parse / 權限等錯誤需重拋，避免靜默掩蓋 package.json 損壞
    if (e instanceof SyncError && e.code === ERR.FILE_NOT_FOUND) return null;
    throw e;
  }
}

// =============================================================================
// Section: Interactive -- 互動確認
// =============================================================================

/**
 * 向使用者提問並等待確認
 * @param {string} question - 問題文字
 * @returns {Promise<boolean>} 使用者是否確認
 */
function askConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// =============================================================================
// Section: Main -- 程式進入點
// 根據 CLI 引數分派到對應指令
// =============================================================================

/**
 * 主函式：解析引數、分派指令、統一錯誤處理
 * @returns {Promise<number>}
 */
async function main() {
  // 注入各指令 handler（延遲到 main 執行階段，避免宣告順序 TDZ 問題）
  attachCommandHandlers();

  const opts = parseArgs();

  // --version：透過 printVersion 統一處理（與 runHelp 對稱）
  if (opts.showVersion) {
    printVersion();
    return EXIT_OK;
  }

  // --help 或 help 指令
  if (opts.showHelp || opts.command === 'help') {
    runHelp();
    return EXIT_OK;
  }

  // 無指令：顯示 help 並以 EXIT_ERROR 退出（語意：使用錯誤）
  if (!opts.command) {
    runHelp();
    return EXIT_ERROR;
  }

  // 無效指令
  const entry = COMMANDS[opts.command];
  if (!entry || !entry.handler) {
    throw new SyncError(`未知指令：${opts.command}`, ERR.INVALID_ARGS);
  }

  // Data-driven dispatch：sync/async 皆以 await 統一處理
  return await entry.handler(opts);
}

/**
 * 將各指令 handler 注入 COMMANDS 表（data-driven dispatch）
 * @returns {void}
 */
function attachCommandHandlers() {
  COMMANDS['diff'].handler        = (opts) => runDiff(opts);
  COMMANDS['status'].handler      = (opts) => runDiffAll(opts);
  COMMANDS['to-repo'].handler     = (opts) => runToRepo(opts);
  COMMANDS['to-local'].handler    = (opts) => runToLocal(opts);
  COMMANDS['skills:diff'].handler = ()     => runSkillsDiff();
  COMMANDS['skills:add'].handler    = (opts) => runSkillsAdd(opts);
  COMMANDS['skills:remove'].handler = (opts) => runSkillsRemove(opts);
  COMMANDS['init'].handler        = (opts) => runInit(opts);
  COMMANDS['help'].handler        = ()     => { runHelp(); return EXIT_OK; };
}

// -----------------------------------------------------------------------------
// 測試用 exports：僅在被 require 時匯出純函式，允許 node:test 引入
// 直接執行（node sync.js ...）時走下方 main() 分派
// -----------------------------------------------------------------------------
if (require.main === module) {
  // 統一出口：main() 回傳 exit code，由此處統一呼叫 process.exit
  main().then(exitCode => {
    process.exit(exitCode);
  }).catch(err => {
    formatError(err);
    process.exit(EXIT_ERROR);
  });
} else {
  module.exports = {
    // 純函式 / 輔助：供單元測試使用
    computeLineDiff,
    computeSimpleLineDiff,
    diffFile,
    diffDir,
    matchExclude,
    statusToStatsKey,
    parseSkillSource,
    parseArgs,
    toRelativePath,
    serializeSettings,
    loadStrippedSettings,
    getStrippedSettings,
    parsePortableCodexConfig,
    serializePortableCodexConfig,
    mergePortableCodexConfig,
    loadPortableCodexConfig,
    getPortableCodexConfig,
    loadSkillsFromLock,
    DEVICE_FIELDS,
    DEVICE_ENV_KEYS,
    CODEX_CONFIG_TOP_KEYS,
    CODEX_CONFIG_SECTION_KEYS,
    INIT_FILE_MAP,
    INIT_RULES_TO_REMOVE,
    SyncError,
    ERR,
    EXIT_OK,
    EXIT_DIFF,
    EXIT_ERROR,
    COMMANDS,
    COMMAND_ALIASES,
    VALID_COMMANDS,
    attachCommandHandlers,
    formatError,
  };
}
