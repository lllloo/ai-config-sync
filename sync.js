#!/usr/bin/env node
'use strict';

// =============================================================================
// ai-config-sync -- 跨裝置 Claude Code 設定同步工具
// sync.js 為主 CLI 入口；safety:check 掃描邏輯獨立於 safety-check.js。零外部相依
// =============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const safetyCheckModule = require('./safety-check.js');
const codexConfigModule = require('./codex-config.js');

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

/**
 * settings.json top-level 採黑名單制：預設同步，僅排除列於此黑名單的裝置／平台綁定欄位。
 * 敏感命名不再作為同步排除條件；改由 safety:check 回報 warning 供人工審核。
 */
const DEVICE_SETTINGS_KEYS = [
  // 裝置偏好：各機不同，同步會互踩
  'model', 'effortLevel', 'defaultShell', 'tui', 'autoUpdatesChannel',
  // 平台綁定：hooks command 為 shell 方言（PowerShell vs zsh），跨平台必壞
  'hooks',
  // 憑證 helper：指向本機憑證腳本的路徑（全數同時命中 pattern，明列為雙保險）
  'apiKeyHelper', 'awsCredentialExport', 'awsAuthRefresh', 'otelHeadersHelper',
];

/**
 * safety:check 專屬常數由 safety-check.js 持有，於此 re-export，供既有測試
 * （settings.test.js 引用 SENSITIVE_KEY_PATTERN）與 module.exports 沿用，避免漂移。
 */
const {
  SENSITIVE_KEY_PATTERN,
  SECRET_VALUE_PATTERN,
  HOME_PATH_PATTERN,
  PRIVATE_KEY_PATTERN,
  SETTINGS_HARD_BLOCK_KEYS,
} = safetyCheckModule;

/**
 * 既有 env review 清單：保留常數與 helper 供文件／測試參考。
 * 同步流程不再依此清單剝除或保留 env key；safety:check 會列出所有 env key 供人工審核。
 */
const DEVICE_ENV_KEYS = [
  'CLAUDE_CODE_USE_POWERSHELL_TOOL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
];

/**
 * Codex config 專屬常數與純轉換函式由 codex-config.js 持有，於此 re-export，
 * 供既有測試（codex-config.test.js 引用 parse／serialize／merge 純函式）與
 * module.exports 沿用，避免漂移。load／get／apply 進出口經 codexConfigHandler()
 * lazy singleton 注入共用工具建立。
 */
const {
  CODEX_CONFIG_TOP_KEYS,
  CODEX_CONFIG_SECTION_KEYS,
  parsePortableCodexConfig,
  serializePortableCodexConfig,
  mergePortableCodexConfig,
} = codexConfigModule;

/** 永遠排除的檔案名稱 */
const GLOBAL_EXCLUDE = ['.DS_Store'];

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
 * 指令定義：統一管理指令名稱、別名與說明
 * 執行分派改走 runCommand() 的 switch，避免多一層 handler 注入抽象。
 * @type {Record<string, {alias: string|null, desc: string}>}
 */
const COMMANDS = {
  'diff':        { alias: 'd',  desc: '比對本機與 repo 差異' },
  'status':      { alias: 's',  desc: '同時比對設定與 skills 差異' },
  'to-repo':     { alias: 'tr', desc: '本機設定 -> repo' },
  'to-local':    { alias: 'tl', desc: 'repo 設定 -> 本機' },
  'safety:check': { alias: null, desc: '檢查同步來源是否含高風險內容' },
  'skills:diff': { alias: 'sd', desc: '比對 skills 差異' },
  'skills:add':  { alias: 'sa', desc: '新增 skill 到 skills-lock.json' },
  'skills:remove': { alias: 'sr', desc: '從 skills-lock.json 移除 skill' },
  'init':        { alias: null, desc: '重置為空骨架（fork 後執行一次）' },
  'help':        { alias: null, desc: '顯示此說明' },
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
  'claude/rules/llm-docs.md',
  'claude/rules/obsidian.md',
  'claude/rules/skill-writing.md',
];

/** 由 COMMANDS 自動建立的別名對應表 */
const COMMAND_ALIASES = Object.fromEntries(
  Object.entries(COMMANDS)
    .filter(([_, v]) => v.alias)
    .map(([cmd, v]) => [v.alias, cmd])
);

// -----------------------------------------------------------------------------
// Type definitions（集中管理，方便查閱）
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} SyncItem
 * @property {string} label - 顯示名稱
 * @property {string} src - 來源路徑
 * @property {string} dest - 目的路徑
 * @property {'file'|'settings'|'codex-config'|'dir'} type - 項目類型
 * @property {string[]} [excludePatterns] - dir 型項目的排除模式
 * @property {string} [prefix] - 顯示路徑前綴（預設 'claude/'，codex 同步項用 'codex/'）
 */

/**
 * @typedef {Object} ParsedArgs
 * @property {string|null} command - 指令名稱
 * @property {boolean} dryRun - 是否為 dry-run 模式
 * @property {boolean} yes - 是否略過互動確認（--yes/--force）
 * @property {boolean} noColor - 是否強制關閉色彩輸出（--no-color）
 * @property {boolean} verbose - 是否為 verbose 模式
 * @property {boolean} showVersion - 是否顯示版本
 * @property {boolean} showHelp - 是否顯示 help
 * @property {string[]} extraArgs - 指令之後的額外 positional 引數
 */

// =============================================================================
// Section: ANSI Colors -- 終端機色碼處理
// 只在 TTY 環境下輸出 ANSI 色碼，否則輸出純文字
// =============================================================================

// 上色與否遵循業界慣例：NO_COLOR（no-color.org）優先強制關閉；FORCE_COLOR 強制開啟；
// 否則回退到 stdout 是否為 TTY。以 let 宣告，讓 --no-color 旗標於 main() 階段覆寫。
let useColor = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);
const col = {
  red:    (/** @type {string} */ t) => useColor ? `\x1b[31m${t}\x1b[0m` : t,
  green:  (/** @type {string} */ t) => useColor ? `\x1b[32m${t}\x1b[0m` : t,
  yellow: (/** @type {string} */ t) => useColor ? `\x1b[33m${t}\x1b[0m` : t,
  cyan:   (/** @type {string} */ t) => useColor ? `\x1b[36m${t}\x1b[0m` : t,
  bold:   (/** @type {string} */ t) => useColor ? `\x1b[1m${t}\x1b[0m`  : t,
  dim:    (/** @type {string} */ t) => useColor ? `\x1b[2m${t}\x1b[0m`  : t,
};

/**
 * 關閉色彩輸出（供 --no-color 旗標呼叫）
 * @returns {void}
 */
function disableColor() { useColor = false; }

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
    console.error(col.red(`  [!] 未預期的錯誤：${maskHome(err.message)}`));
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
  // message 一律走 toRelativePath 遮罩；不嵌入 e.message（Node fs 錯誤含絕對路徑）
  const rel = toRelativePath(filePath);
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    return new SyncError(`無法${op}（權限不足）：${rel}`, ERR.PERMISSION, { path: filePath });
  }
  return new SyncError(`${op}失敗（${e.code}）：${rel}`, ERR.IO_ERROR, { path: filePath });
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

/**
 * 將文字中所有 HOME 絕對路徑出現替換為 ~（縱深防禦）。
 * 用於無結構的錯誤訊息字串（如非 SyncError 的原生 Error.message，可能內嵌絕對路徑）；
 * 同時處理 Windows 反斜線與正斜線兩種寫法。
 * @param {string} text
 * @returns {string}
 */
function maskHome(text) {
  if (!text || !HOME) return text;
  let out = text.split(HOME).join('~');
  const homeFwd = HOME.replace(/\\/g, '/');
  if (homeFwd !== HOME) out = out.split(homeFwd).join('~');
  return out;
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
      throw new SyncError(`檔案不存在：${toRelativePath(filePath)}`, ERR.FILE_NOT_FOUND, { path: filePath });
    }
    throw new SyncError(`無法讀取檔案：${toRelativePath(filePath)}`, ERR.PERMISSION, { path: filePath });
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
    throw new SyncError(`無法寫入檔案（唯讀或權限不足）：${toRelativePath(filePath)}`, ERR.PERMISSION, { path: filePath });
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
      throw new SyncError(`JSON 檔案不存在：${toRelativePath(filePath)}`, ERR.FILE_NOT_FOUND, { path: filePath });
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      throw new SyncError(`無法讀取 JSON 檔案（權限不足）：${toRelativePath(filePath)}`, ERR.PERMISSION, { path: filePath });
    }
    throw new SyncError(`無法讀取檔案（${e.code}）：${toRelativePath(filePath)}`, ERR.IO_ERROR, { path: filePath });
  }
  try {
    return JSON.parse(content);
  } catch (_) {
    // 刻意不帶入 e.message：Node 的 JSON.parse 錯誤會夾帶出錯位置前後的內容片段，
    // 若 settings.json 在金鑰值附近損壞會把 API Key／token 片段印進 stderr，
    // 違反「輸出/log/diff 不得出現敏感資訊」的核心不變式。改由 JSON_PARSE 的通用提示引導。
    throw new SyncError(
      `JSON 解析失敗：${toRelativePath(filePath)}`,
      ERR.JSON_PARSE,
      { path: filePath },
    );
  }
}

/**
 * 安全寫入檔案（write-to-tmp + rename）。提供「原子性」：避免讀者看到半截檔，
 * 寫入中斷時目標檔保持原內容或新內容、不會半截損壞。
 * 注意：此處不呼叫 fsync，**不保證持久性**（斷電後可能丟失尚未落盤的寫入）——
 * 設定同步檔對持久性需求低，刻意不付 fsync 成本（Windows 對目錄 fsync 亦不可靠）。
 * tmpPath 與目標同目錄，確保 rename 在同一檔案系統內、不觸發 EXDEV；
 * 失敗時清理暫存檔並包成 SyncError。content 可為 string 或 Buffer。
 * @param {string} filePath - 目標檔案路徑
 * @param {string|Buffer} content - 要寫入的內容
 * @param {string} [op='寫入檔案'] - 操作名稱（中文），用於錯誤訊息
 * @returns {void}
 */
function writeFileSafe(filePath, content, op = '寫入檔案') {
  checkWriteAccess(filePath);
  ensureDir(path.dirname(filePath));
  // 隨機尾碼避免 PID 命名在平行化時撞名；mode 0600 在 rename 前不以預設 umask（常 0644）暴露
  const tmpPath = `${filePath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  registerTempFile(tmpPath);
  try {
    // flag 'wx'（O_EXCL）：暫存檔必為本次新建，拒絕跟隨既存 symlink（縱深防禦）
    fs.writeFileSync(tmpPath, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw toSyncFsError(e, filePath, op);
  } finally {
    tempFiles.delete(tmpPath);
  }
}

/**
 * 安全寫入 JSON 檔案（序列化後走 writeFileSafe 原子寫入）
 * @param {string} filePath - 目標檔案路徑
 * @param {unknown} data - 要序列化的資料
 * @returns {void}
 */
function writeJsonSafe(filePath, data) {
  writeFileSafe(filePath, JSON.stringify(data, null, 2) + '\n', '寫入 JSON');
}

/**
 * 安全寫入文字檔（走 writeFileSafe 原子寫入）
 * @param {string} filePath - 目標檔案路徑
 * @param {string} content - 要寫入的文字內容
 * @returns {void}
 */
function writeTextSafe(filePath, content) {
  writeFileSafe(filePath, content, '寫入文字檔');
}

/**
 * 確保目錄存在（遞迴建立）
 * @param {string} dir - 目錄路徑
 * @returns {void}
 */
function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw toSyncFsError(e, dir, '建立目錄');
  }
}

/**
 * 安全讀取檔案：將 fs 例外統一包成 SyncError（帶 path context 與操作脈絡）。
 * 用於 existsSync 後仍可能 race 消失、或權限/IO 失敗的讀取點，
 * 確保錯誤經 toSyncFsError 轉換，而非裸 Error 穿透到 formatError（丟失 path/hint）。
 * @param {string} filePath - 檔案路徑
 * @param {string} [op='讀取檔案'] - 操作名稱（中文），用於錯誤訊息
 * @param {BufferEncoding} [encoding] - 省略則回傳 Buffer，指定則回傳字串
 * @returns {Buffer|string}
 */
function readFileSafe(filePath, op = '讀取檔案', encoding) {
  try {
    return encoding === undefined
      ? fs.readFileSync(filePath)
      : fs.readFileSync(filePath, encoding);
  } catch (e) {
    throw toSyncFsError(e, filePath, op);
  }
}

/**
 * 建立 diff 用暫存檔（os.tmpdir()）：以隨機檔名 + O_EXCL（flag 'wx'）建立，限本人可讀
 * （mode 0600）。隨機名 + O_EXCL 防止共用 /tmp 多使用者環境下被預埋同名 symlink 截斷／
 * 覆寫受害者檔（CWE-377/59），O_EXCL 亦拒絕跟隨既存 symlink。回傳完整路徑（已註冊待清理）。
 * @param {string} suffix - 副檔名（不含點），如 'json'、'toml'
 * @param {string|Buffer} content - 要寫入的內容
 * @returns {string} 暫存檔絕對路徑
 */
function createTmpDiffFile(suffix, content) {
  const name = `ai-config-sync-${crypto.randomBytes(9).toString('hex')}.${suffix}`;
  const tmpPath = path.join(os.tmpdir(), name);
  registerTempFile(tmpPath);
  try {
    fs.writeFileSync(tmpPath, content, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    throw toSyncFsError(e, tmpPath, '寫入暫存差異檔');
  }
  return tmpPath;
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
  let srcContent;
  try { srcContent = fs.readFileSync(src); }
  catch (e) { throw toSyncFsError(e, src, '讀取'); }

  // dry-run 時一律比對內容，不受 force 影響
  if (dryRun) {
    if (!fs.existsSync(dest)) return true;
    try { return !srcContent.equals(fs.readFileSync(dest)); }
    catch (e) { throw toSyncFsError(e, dest, '讀取'); }
  }

  // 非 dry-run：force 或內容不同才寫入
  if (!force && fs.existsSync(dest)) {
    let destContent;
    try { destContent = fs.readFileSync(dest); }
    catch (e) { throw toSyncFsError(e, dest, '讀取'); }
    if (srcContent.equals(destContent)) return false;
  }
  writeFileSafe(dest, srcContent, '寫入');
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

  try {
    for (const rel of srcFiles) {
      const srcFile = path.join(src, rel);
      const destFile = path.join(dest, rel);
      const srcContent = readFileSafe(srcFile, '讀取來源檔案');
      const destExists = fs.existsSync(destFile);

      // dry-run 時一律比對內容，不受 force 影響
      const needsWrite = dryRun
        ? (!destExists || !srcContent.equals(readFileSafe(destFile, '讀取目的檔案')))
        : (force || !destExists || !srcContent.equals(readFileSafe(destFile, '讀取目的檔案')));

      if (needsWrite) {
        if (!dryRun) writeFileSafe(destFile, srcContent, '寫入檔案');
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
  } catch (e) {
    // 中途失敗：已完成的變更附掛給呼叫端（applySyncItems 補印並記入 audit log），
    // 避免「部分檔案已寫入磁碟但零可見度、.sync-history.log 無紀錄」
    if (e instanceof SyncError && changed.length) e.context.partialChanges = changed;
    throw e;
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
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // race（ENOENT）靜默跳過；其他錯誤 warn 後跳過，不中斷主流程
    if (e.code !== 'ENOENT') {
      console.warn(col.yellow(`  [warn] 讀取目錄失敗（${e.code}）：${toRelativePath(dir)}`));
    }
    return;
  }
  for (const entry of entries) {
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
 * @returns {'new'|'changed'|'deleted'|'eol'|null} 差異狀態
 */
function diffFile(src, dest) {
  if (!fs.existsSync(src)) return fs.existsSync(dest) ? 'deleted' : null;
  if (!fs.existsSync(dest)) return 'new';
  const a = readFileSafe(src, '讀取');
  const b = readFileSafe(dest, '讀取');
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
      const a = readFileSafe(path.join(src, rel), '讀取');
      const b = readFileSafe(path.join(dest, rel), '讀取');
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
 * env key 不再由同步流程剝除；僅移除空 env 物件，避免 repo 產生無內容區塊。
 * @param {Record<string, unknown>} data
 */
function stripDeviceEnv(data) {
  if (!data.env || typeof data.env !== 'object') return;
  if (Object.keys(data.env).length === 0) delete data.env;
}

/**
 * 將 settings top-level 依可攜性分區：列於 DEVICE_SETTINGS_KEYS 者為 device，
 * 其餘為 portable（保持原順序）。strip（to-repo）、preserve（to-local）與 diff 的
 * dropped 清單皆消費同一次分區結果，確保 top-level 互補。
 * @param {Record<string, unknown>} data
 * @returns {{ portable: Record<string, unknown>, device: Record<string, unknown> }}
 */
function partitionSettingsTopLevel(data) {
  const portable = {};
  const device = {};
  for (const key of Object.keys(data)) {
    if (DEVICE_SETTINGS_KEYS.includes(key)) device[key] = data[key];
    else portable[key] = data[key];
  }
  return { portable, device };
}

/**
 * 將 settings.json 收斂為同步版後回傳 { clean, serialized, dropped }
 * top-level 僅剝除 DEVICE_SETTINGS_KEYS；env 與敏感命名 key 依一般同步語意保留。
 * @param {string} filePath - settings.json 路徑
 * @returns {{ clean: Record<string, unknown>, serialized: string, dropped: string[] } | null} 檔案不存在時回傳 null
 */
function loadStrippedSettings(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = readJson(filePath);
  const { portable, device } = partitionSettingsTopLevel(data);
  stripDeviceEnv(portable);
  return { clean: portable, serialized: serializeSettings(portable), dropped: Object.keys(device) };
}

/**
 * 從 local settings 萃取本機保留欄位（供 to-local 套用時保留，不被 repo 覆寫）。
 * 僅保留 DEVICE_SETTINGS_KEYS top-level 欄位；env key 不再被同步流程特別保留。
 * @param {Record<string, unknown>} local
 * @returns {{ deviceValues: Record<string, unknown> }}
 */
function extractDeviceValues(local) {
  const { device: deviceValues } = partitionSettingsTopLevel(local);
  return { deviceValues };
}

/**
 * 合併 deviceValues 回 repo 設定，對巢狀物件做 shallow merge（避免整個 env 被覆蓋）
 * @param {Record<string, unknown>} repo
 * @param {Record<string, unknown>} deviceValues
 * @returns {Record<string, unknown>}
 */
function mergeDeviceValues(repo, deviceValues) {
  const merged = { ...repo };
  for (const [key, val] of Object.entries(deviceValues)) {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)
        && typeof merged[key] === 'object' && merged[key] !== null) {
      merged[key] = { ...merged[key], ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged;
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
  return mergeSettingsBetween(localPath, repoPath, direction, dryRun);
}

/**
 * settings.json 合併核心（路徑可注入版，供測試直接驗黑名單混合制剝除不變式）
 * @param {string} localPath - 本機 settings.json 路徑
 * @param {string} repoPath - repo settings.json 路徑
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @param {boolean} [dryRun=false] - 是否為 dry-run 模式
 * @returns {boolean} 是否有實際變更
 */
function mergeSettingsBetween(localPath, repoPath, direction, dryRun = false) {
  if (direction === 'to-repo') {
    const stripped = loadStrippedSettings(localPath);
    if (stripped === null) return false;

    const repoContent = fs.existsSync(repoPath)
      ? readFileSafe(repoPath, '讀取 repo 設定', 'utf8')
      : null;
    if (repoContent === stripped.serialized) return false;

    if (dryRun) return true;
    writeJsonSafe(repoPath, stripped.clean);
    return true;
  } else {
    if (!fs.existsSync(repoPath)) return false;
    const repo = readJson(repoPath);
    const repoStr = serializeSettings(repo);

    // 比對 repo 與 stripped local（兩邊皆使用 serializeSettings 確保結尾換行對稱）。
    const stripped = loadStrippedSettings(localPath);
    if (stripped && repoStr === stripped.serialized) return false;

    if (dryRun) return true;
    const local = fs.existsSync(localPath) ? readJson(localPath) : {};
    const { deviceValues } = extractDeviceValues(local);
    const merged = mergeDeviceValues(repo, deviceValues);
    writeJsonSafe(localPath, merged);
    return true;
  }
}

// =============================================================================
// Section: Codex Config Handler -- config.toml 過濾同步進出口
// TOML parse／serialize／merge 純函式與常數在 codex-config.js；此處僅注入
// 共用工具並轉接 load／get／apply。diff 渲染留在 Sync Core（見下方 diff 引擎）。
// =============================================================================

/** lazy singleton：延後到執行期建立，避開對 const 相依（REPO_ROOT 等）的 TDZ。 */
let _codexConfigHandler = null;
function codexConfigHandler() {
  if (!_codexConfigHandler) {
    _codexConfigHandler = codexConfigModule.createCodexConfigHandler({
      readFileSafe, writeTextSafe, REPO_ROOT, CODEX_HOME,
    });
  }
  return _codexConfigHandler;
}

/**
 * 載入並萃取可攜 Codex config（轉接模組 handler）
 * @param {string} filePath
 * @returns {{ data: Map<string, Map<string, string>>, serialized: string } | null}
 */
function loadPortableCodexConfig(filePath) {
  return codexConfigHandler().loadPortableCodexConfig(filePath);
}

/**
 * 取得可攜 Codex config TOML 字串（轉接模組 handler）
 * @param {string} filePath
 * @returns {string|null}
 */
function getPortableCodexConfig(filePath) {
  return codexConfigHandler().getPortableCodexConfig(filePath);
}

/**
 * 合併 Codex config.toml（只同步 allowlist 欄位；轉接模組 handler）
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @param {boolean} [dryRun=false] - 是否為 dry-run 模式
 * @returns {boolean} 是否有實際變更
 */
function mergeCodexConfigToml(direction, dryRun = false) {
  return codexConfigHandler().mergeCodexConfigToml(direction, dryRun);
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
    // mode 0600：log 含 hostname，建立時即收斂為 owner-only
    fs.appendFileSync(SYNC_HISTORY_LOG, entry + '\n', { mode: 0o600 });
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
 * 同步 area 資料表：一筆 = 一個工具的本機端 base、repo 子目錄與顯示前綴。
 * 新增工具 area 只需加一筆（對稱於 SYNC_MANIFEST 的「加一列」）。
 * @type {Record<string, {homeBase: string, repoDir: string, prefix: string}>}
 */
const SYNC_AREAS = {
  claude: { homeBase: CLAUDE_HOME, repoDir: 'claude', prefix: 'claude/' },
  codex:  { homeBase: CODEX_HOME,  repoDir: 'codex',  prefix: 'codex/'  },
};

/**
 * 同步項目宣告式清單：一列 = 一個同步路徑，為所有同步項目的單一事實來源。
 * 新增同步內容只需在此加一列（不需改任何 builder 或 dispatch switch）。
 *   - area：對應 SYNC_AREAS 的 key（'claude' → ~/.claude ↔ repo claude/；'codex' → ~/.codex ↔ repo codex/）
 *   - type：'file'|'settings'|'codex-config'|'dir'（型別行為由 diffSyncItem／applySyncItem 分派）
 *   - fixedFlow：true 代表 src 恆為本機端、dest 恆為 repo 端，不隨 direction 交換
 *     （settings.json／config.toml 由 mergeSettingsJson／mergeCodexConfigToml 內部依 direction 決定流向）
 * @type {Array<{area: keyof typeof SYNC_AREAS, label: string, type: SyncItem['type'], fixedFlow?: boolean}>}
 */
const SYNC_MANIFEST = [
  { area: 'claude', label: 'CLAUDE.md',     type: 'file' },
  { area: 'claude', label: 'settings.json', type: 'settings', fixedFlow: true },
  { area: 'claude', label: 'statusline.sh', type: 'file' },
  { area: 'claude', label: 'agents',        type: 'dir' },
  { area: 'claude', label: 'commands',      type: 'dir' },
  { area: 'claude', label: 'skills',        type: 'dir' },
  { area: 'claude', label: 'rules',         type: 'dir' },
  { area: 'codex',  label: 'AGENTS.md',     type: 'file' },
  { area: 'codex',  label: 'config.toml',   type: 'codex-config', fixedFlow: true },
  { area: 'codex',  label: 'agents',        type: 'dir' },
];

/**
 * 解析 area 對應的本機端／repo 端 base 路徑與顯示前綴（查 SYNC_AREAS 資料表）
 * @param {keyof typeof SYNC_AREAS} area
 * @returns {{homeBase: string, repoBase: string, prefix: string}}
 */
function resolveSyncArea(area) {
  const cfg = SYNC_AREAS[area];
  return { homeBase: cfg.homeBase, repoBase: path.join(REPO_ROOT, cfg.repoDir), prefix: cfg.prefix };
}

/**
 * 將一列 manifest 依同步方向 materialize 成 SyncItem。
 * fixedFlow 項目 src/dest 固定（home→repo），其餘依 direction 交換。
 * @param {{area: 'claude'|'codex', label: string, type: SyncItem['type'], fixedFlow?: boolean}} entry
 * @param {'to-repo'|'to-local'} direction
 * @returns {SyncItem}
 */
function materializeSyncItem(entry, direction) {
  const { homeBase, repoBase, prefix } = resolveSyncArea(entry.area);
  const homePath = path.join(homeBase, entry.label);
  const repoPath = path.join(repoBase, entry.label);
  const isToRepo = direction === 'to-repo';
  // fixedFlow：src 恆為本機端、dest 恆為 repo 端（由 merge 函式內部依 direction 決定流向）
  const src = entry.fixedFlow || isToRepo ? homePath : repoPath;
  const dest = entry.fixedFlow || isToRepo ? repoPath : homePath;
  return { label: entry.label, src, dest, type: entry.type, prefix };
}

/**
 * 建立同步項目清單：map SYNC_MANIFEST → SyncItem[]
 * @param {'to-repo'|'to-local'} direction - 同步方向
 * @returns {SyncItem[]}
 */
function buildSyncItems(direction) {
  return SYNC_MANIFEST.map(entry => materializeSyncItem(entry, direction));
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
 * 比較 stripped 內容與 repo 檔案，回傳 diff status（呼叫端確保 repo 檔存在）
 * 先判斷是否僅 EOL 差異，避免 CRLF/LF 被誤判為 changed
 * @param {string} strippedContent - 已去裝置欄位的內容
 * @param {string} repoPath
 * @param {string} op - 讀取操作名稱（中文）
 * @returns {null|'eol'|'changed'}
 */
function compareStrippedToRepo(strippedContent, repoPath, op) {
  const repoBuf = readFileSafe(repoPath, op);
  const strippedBuf = Buffer.from(strippedContent);
  if (repoBuf.equals(strippedBuf)) return null;
  return isEolOnlyDiff(repoBuf, strippedBuf) ? 'eol' : 'changed';
}

/**
 * 回傳 settings 的顯示用淺副本：env 每個值遮罩為 '***'（僅顯示層，不影響差異判定）。
 * env 改採黑名單後同步進 repo 的 env key 可能含未過濾機密值——diff 預覽不得顯示其值。
 * 純值變更（key 不變）遮罩後兩側同為 '***'、於預覽中只會看到狀態改變，不再顯示值本身，但摘要仍以未遮罩內容判為 changed。
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function maskEnvValuesForDisplay(obj) {
  if (!obj || typeof obj.env !== 'object' || obj.env === null) return obj;
  const env = {};
  for (const key of Object.keys(obj.env)) env[key] = '***';
  return { ...obj, env };
}

/**
 * 統一構造同步項目的顯示標籤：`<prefix><label>[/rel]`。
 * prefix 由 materialize 保證存在；`|| 'claude/'` 為手工建構 item 的防呆 fallback。
 * @param {SyncItem} item
 * @param {string} [rel] - dir 型項目的相對子路徑
 * @returns {string}
 */
function itemLabel(item, rel) {
  return `${item.prefix || 'claude/'}${item.label}${rel ? `/${rel}` : ''}`;
}

/**
 * 為 settings 項目產生 diff result entry（direction-aware，與實際 apply 判斷對齊）
 * to-repo：本機 stripped → repo；to-local：repo → 本機（本機缺檔時回 'new'，避免 preview 漏列）
 * @param {SyncItem} item
 * @param {'to-repo'|'to-local'} direction
 * @returns {{label: string, status: string|null, src: string|null, dest: string, verboseSrc: string, verboseDest: string, itemType: string}}
 */
function diffSettingsItem(item, direction) {
  const localPath = path.join(CLAUDE_HOME, 'settings.json');
  const repoPath = path.join(REPO_ROOT, 'claude', 'settings.json');
  const base = {
    label: itemLabel(item),
    dest: repoPath, verboseSrc: localPath, verboseDest: repoPath, itemType: 'settings',
  };

  if (direction === 'to-local') {
    // repo → 本機：repo 缺檔則無可同步；本機缺檔則將新增（與 mergeSettingsJson('to-local') 對齊）。
    // 本機 stripped 僅供比對；安全審核由 safety:check 處理。
    if (!fs.existsSync(repoPath)) return { ...base, status: null, src: null };
    if (!fs.existsSync(localPath)) return { ...base, status: 'new', src: null };
    const stripped = loadStrippedSettings(localPath);
    if (stripped === null) return { ...base, status: null, src: null };
    return { ...base, status: compareStrippedToRepo(stripped.serialized, repoPath, '讀取 repo 設定'), src: null };
  }

  // to-repo：本機 stripped → repo。狀態以未遮罩內容判定；顯示層遮罩 env 值。
  if (!fs.existsSync(localPath)) return { ...base, status: null, src: null };
  const stripped = loadStrippedSettings(localPath);
  if (stripped === null) return { ...base, status: null, src: null };
  const tmpSrc = createTmpDiffFile('json', serializeSettings(maskEnvValuesForDisplay(stripped.clean)));
  const repoExists = fs.existsSync(repoPath);
  const status = repoExists
    ? compareStrippedToRepo(stripped.serialized, repoPath, '讀取 repo 設定')
    : 'new';
  const dest = repoExists
    ? createTmpDiffFile('json', serializeSettings(maskEnvValuesForDisplay(readJson(repoPath))))
    : repoPath;
  return { ...base, status, src: tmpSrc, dest, droppedKeys: stripped.dropped };
}

/**
 * Codex config.toml 的 to-local diff：鏡射 mergeCodexConfigToLocal 的判斷（merged vs 本機 content）
 * @param {object} base - 共用回傳欄位
 * @param {string} localPath
 * @param {string} repoPath
 * @returns {object}
 */
function diffCodexConfigToLocal(base, localPath, repoPath) {
  const portable = loadPortableCodexConfig(repoPath);
  if (!portable) return { ...base, status: null, src: null };  // repo 無可攜欄位 → apply 不動
  const localExists = fs.existsSync(localPath);
  const localContent = localExists ? readFileSafe(localPath, '讀取本機 Codex 設定', 'utf8') : '';
  const merged = mergePortableCodexConfig(localContent, portable.data);
  if (localContent === merged) return { ...base, status: null, src: null };
  if (!localExists) return { ...base, status: 'new', src: null };
  const status = isEolOnlyDiff(Buffer.from(localContent), Buffer.from(merged)) ? 'eol' : 'changed';
  return { ...base, status, src: null };
}

/**
 * 為 Codex config.toml 產生 diff result entry（direction-aware，與實際 apply 判斷對齊）
 * @param {SyncItem} item
 * @param {'to-repo'|'to-local'} direction
 * @returns {{label: string, status: string|null, src: string|null, dest: string, verboseSrc: string, verboseDest: string, itemType: string}}
 */
function diffCodexConfigItem(item, direction) {
  const localPath = path.join(CODEX_HOME, 'config.toml');
  const repoPath = path.join(REPO_ROOT, 'codex', 'config.toml');
  const base = {
    label: itemLabel(item),
    dest: repoPath, verboseSrc: localPath, verboseDest: repoPath, itemType: 'codex-config',
  };

  if (direction === 'to-local') return diffCodexConfigToLocal(base, localPath, repoPath);

  // to-repo：本機 portable → repo（portable 為 null 代表本機無可同步欄位，視同無差異）
  if (!fs.existsSync(localPath)) return { ...base, status: null, src: null };
  const portable = getPortableCodexConfig(localPath);
  if (portable === null) return { ...base, status: null, src: null };
  const tmpSrc = createTmpDiffFile('toml', portable);
  // 空字串也視為「新增」，避免 truthy 檢查吞掉 portable === '' 的合法新檔
  const status = fs.existsSync(repoPath)
    ? compareStrippedToRepo(portable, repoPath, '讀取 repo Codex 設定')
    : 'new';
  return { ...base, status, src: tmpSrc };
}

/**
 * 產生 file 型項目的 diff 結果 entry
 * @param {SyncItem} item
 * @returns {object}
 */
function diffFileItem(item) {
  return {
    label: itemLabel(item),
    status: diffFile(item.src, item.dest),
    src: item.src,
    dest: item.dest,
    verboseSrc: item.src,
    verboseDest: item.dest,
    itemType: 'file',
  };
}

/**
 * 產生 dir 型項目的 diff 結果 entries（每個有差異的檔案一筆；無差異則空陣列）
 * @param {SyncItem} item
 * @returns {object[]}
 */
function diffDirItems(item) {
  // repo 源目錄整個不存在時 mirrorDir 起頭守衛提早返回、不刪本機檔（保守安全設計）；
  // 標記 preserved 讓 to-local 預覽不把這類 deleted 誤報為「將刪除」。
  const srcMissing = !fs.existsSync(item.src);
  return diffDir(item.src, item.dest, item.excludePatterns || []).map(d => {
    const src = path.join(item.src, d.rel);
    const dest = path.join(item.dest, d.rel);
    const entry = {
      label: itemLabel(item, d.rel),
      status: d.status, src, dest, verboseSrc: src, verboseDest: dest, itemType: 'dir',
    };
    if (d.status === 'deleted' && srcMissing) entry.preserved = true;
    return entry;
  });
}

/**
 * apply：merge 型（settings / codex-config）共用——回傳變更記錄陣列（0 或 1 筆）
 * @param {() => boolean} mergeFn - 已綁定 direction/dryRun 的 merge 呼叫
 * @param {string} label
 * @returns {Array<{action: string, label: string}>}
 */
function applyMergeItem(mergeFn, label) {
  return mergeFn() ? [{ action: 'updated', label }] : [];
}

/**
 * apply：file 型——回傳變更記錄陣列（0 或 1 筆）
 * @param {SyncItem} item
 * @param {boolean} dryRun
 * @returns {Array<{action: string, label: string}>}
 */
function applyFileItem(item, dryRun) {
  const existed = fs.existsSync(item.dest);
  if (!copyFile(item.src, item.dest, false, dryRun)) return [];
  return [{ action: existed ? 'updated' : 'added', label: itemLabel(item) }];
}

/**
 * apply：dir 型——回傳各檔變更記錄陣列
 * @param {SyncItem} item
 * @param {boolean} dryRun
 * @returns {Array<{action: string, label: string}>}
 */
function applyDirItem(item, dryRun) {
  return mirrorDir(item.src, item.dest, item.excludePatterns || [], false, dryRun)
    .map(c => ({ action: c.action, label: itemLabel(item, c.rel) }));
}

/**
 * 將變更 action 對應到狀態圖示 key
 * @param {string} action - 'added' | 'updated' | 'deleted'
 * @returns {string}
 */
function actionToIcon(action) {
  return action === 'added' ? 'added' : action === 'deleted' ? 'deleted' : 'changed';
}

/**
 * 直接依 SyncItem.type 分派 diff，避免額外的 handler 表。
 * @param {SyncItem} item
 * @param {'to-repo'|'to-local'} direction
 * @returns {Array<{label: string, status: string|null, src: string|null, dest: string, verboseSrc: string, verboseDest: string, itemType: string}>}
 */
function diffSyncItem(item, direction) {
  switch (item.type) {
    case 'settings': return [diffSettingsItem(item, direction)];
    case 'codex-config': return [diffCodexConfigItem(item, direction)];
    case 'file': return [diffFileItem(item)];
    case 'dir': return diffDirItems(item);
    default: return [];
  }
}

/**
 * 直接依 SyncItem.type 分派 apply，避免額外的 handler 表。
 * @param {SyncItem} item
 * @param {'to-repo'|'to-local'} direction
 * @param {boolean} dryRun
 * @returns {Array<{action: string, label: string}>}
 */
function applySyncItem(item, direction, dryRun) {
  switch (item.type) {
    case 'settings': return applyMergeItem(() => mergeSettingsJson(direction, dryRun), 'settings.json');
    case 'codex-config': return applyMergeItem(() => mergeCodexConfigToml(direction, dryRun), 'codex/config.toml');
    case 'file': return applyFileItem(item, dryRun);
    case 'dir': return applyDirItem(item, dryRun);
    default: return [];
  }
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
    result.push(...diffSyncItem(item, direction));
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
  const record = (c) => {
    stats[c.action]++;
    changeLog.push(`${c.label} (${c.action})`);
    printStatusLine(actionToIcon(c.action), c.label);
  };

  for (const item of items) {
    let changes;
    try {
      changes = applySyncItem(item, direction, dryRun);
    } catch (e) {
      // 單項中途失敗：先把該項已完成的變更（mirrorDir 附掛的 partialChanges）補進
      // 統計與輸出，再把整體已套用清單附掛給呼叫端（logPartialApply 記 audit log）——
      // 與 handleSignal 的訊號中斷警告互補，讓「例外中斷」路徑的部分寫入同樣可見
      if (e instanceof SyncError) {
        for (const c of e.context.partialChanges || []) record({ action: c.action, label: itemLabel(item, c.rel) });
        delete e.context.partialChanges;
        e.context.applied = { stats, changeLog };
      }
      throw e;
    }
    for (const c of changes) record(c);
  }

  return { stats, changeLog };
}

/**
 * apply 中途拋錯時交代部分結果：印出已寫入筆數警告，並將已套用變更記入
 * .sync-history.log（audit trail 不因中斷而全失）。dry-run 無實際寫入，不記 log。
 * 一律清除 err.context.applied，避免 formatError 印出物件 dump。
 * @param {'to-repo'|'to-local'} direction
 * @param {unknown} err - applySyncItems 拋出的錯誤
 * @param {boolean} dryRun
 * @returns {void}
 */
function logPartialApply(direction, err, dryRun) {
  if (!(err instanceof SyncError) || !err.context.applied) return;
  const { changeLog } = err.context.applied;
  delete err.context.applied;
  if (dryRun) return;
  console.error(col.yellow(`\n  [warn] 同步因錯誤中斷：已寫入 ${changeLog.length} 筆變更（如上所列），其餘項目未執行`));
  if (changeLog.length > 0) appendSyncLog(direction, [...changeLog, '(因錯誤中斷，後續項目未執行)']);
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
  console.log(col.dim(`   git add -A && git commit -m "sync: from ${os.hostname()}" && git push`));
}

// =============================================================================
// Section: Safety Check -- 唯讀安全檢查
// 掃描與輸出邏輯在 safety-check.js；此處僅注入共用工具並轉接 dispatch。
// =============================================================================

/** lazy singleton：延後到執行期建立，避開對 const 相依（col／REPO_ROOT 等）的 TDZ。 */
let _safetyChecker = null;
function safetyChecker() {
  if (!_safetyChecker) {
    _safetyChecker = safetyCheckModule.createSafetyChecker({
      REPO_ROOT, getFiles, readFileSafe, readJson, toRelativePath, maskHome, col,
      EXIT_OK, EXIT_DIFF, EXIT_ERROR,
    });
  }
  return _safetyChecker;
}

function runSafetyChecks() {
  return safetyChecker().runSafetyChecks();
}

function runSafetyCheck() {
  return safetyChecker().runSafetyCheck();
}

// =============================================================================
// Section: Commands -- 各指令的實作
// diff, to-repo, to-local, safety:check, skills:diff, skills:add, help
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
    const label = itemLabel(item);
    if (!result.some(d => d.label === label)) {
      result.push({
        label,
        status: null,
        src: item.src,
        dest: item.dest,
        verboseSrc: item.src,
        verboseDest: item.dest,
        itemType: item.type,
      });
    }
  }

  // 補上無差異的 dir 項目（以摘要行呈現，證明已被檢查）
  for (const item of items) {
    if (item.type !== 'dir') continue;
    const prefix = `${itemLabel(item)}/`;
    const hasAny = result.some(d => d.label.startsWith(prefix));
    if (!hasAny) {
      result.push({
        label: prefix,
        status: null,
        src: item.src,
        dest: item.dest,
        verboseSrc: item.src,
        verboseDest: item.dest,
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
  else if (item.status === 'changed' || item.status === 'eol') summary[skill].changed++;
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
 * status 指令：依序執行 diff 與 skills:diff（設定 + skills 差異一次看）
 * @param {ParsedArgs} opts - CLI 引數
 * @returns {number} exit code（有任一差異即回傳 EXIT_DIFF）
 */
function runStatus(opts) {
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
  } catch (e) {
    logPartialApply('to-repo', e, dryRun);
    throw e;
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
    else if (d.status === 'deleted' && d.preserved) printStatusLine('up', d.label, '本機保留（repo 無此目錄，不會刪除）');
    else if (d.status === 'deleted') printStatusLine('deleted', d.label, '將刪除');
  }

  const previewStats = { added: 0, updated: 0, deleted: 0 };
  for (const d of diffResults) {
    if (d.status === 'deleted' && d.preserved) continue; // mirrorDir 不會刪，不計入
    const key = statusToStatsKey(d.status);
    if (key) previewStats[key]++;
  }
  return previewStats;
}

/**
 * 詢問使用者並實際套用變更（to-local）
 * @param {SyncItem[]} items
 * @param {boolean} [autoYes=false] - 是否略過確認（--yes/--force）
 * @returns {Promise<number>} exit code
 */
async function confirmAndApply(items, autoYes = false) {
  console.log('');
  const confirmed = await askConfirm(col.bold('  套用以上變更？(y/N) '), autoYes);
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
  } catch (e) {
    logPartialApply('to-local', e, false);
    throw e;
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

  return confirmAndApply(items, opts.yes);
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
 * 計算 repo 與本機 skills 的三向集合差（純函式）
 * @param {Record<string, unknown>} repoSkills
 * @param {Record<string, unknown>} localSkills
 * @returns {{onlyInRepo: string[], onlyInLocal: string[], inBoth: string[]}}
 */
function computeSkillsDiff(repoSkills, localSkills) {
  return {
    onlyInRepo:  Object.keys(repoSkills).filter(n => !localSkills[n]),
    onlyInLocal: Object.keys(localSkills).filter(n => !repoSkills[n]),
    inBoth:      Object.keys(repoSkills).filter(n =>  localSkills[n]),
  };
}

/**
 * 清除字串中的控制字元（含 ANSI escape、換行），避免 lock 檔的 source 值
 * 被原樣 echo 進終端造成 log injection。未驗證來源的縱深防禦。
 * @param {string} s
 * @returns {string}
 */
function sanitizeForTerminal(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x1f\x7f]/g, '');
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

  const repoSkills = loadSkillsFromLock(path.join(REPO_ROOT, 'skills-lock.json'));
  const localSkills = loadSkillsFromLock(LOCAL_SKILL_LOCK);
  const { onlyInRepo, onlyInLocal, inBoth } = computeSkillsDiff(repoSkills, localSkills);

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
        console.log(`    npx skills add ${sanitizeForTerminal(skill.source)} -g -y --skill ${sanitizeForTerminal(name)}`);
      }
    }
  }

  if (onlyInLocal.length > 0) {
    console.log(col.bold('\n  -- 本機多裝的 skills --'));
    console.log(col.dim('    （A）加入 repo 紀錄：'));
    for (const name of onlyInLocal) {
      const skill = localSkills[name];
      if (skill && skill.source) {
        console.log(`      npm run skills:add -- ${sanitizeForTerminal(name)} ${sanitizeForTerminal(skill.source)}`);
      } else {
        console.log(`      npm run skills:add -- ${sanitizeForTerminal(name)} <source>`);
      }
    }
    console.log(col.dim('    （B）從本機移除：'));
    for (const name of onlyInLocal) {
      console.log(`      npx skills remove ${sanitizeForTerminal(name)} -g -y`);
    }
  }

  console.log('');
  return (onlyInRepo.length > 0 || onlyInLocal.length > 0) ? EXIT_DIFF : EXIT_OK;
}

/**
 * 驗證 skill name 格式：只允許英數、底線、點、連字號
 * 防止換行、ANSI escape、控制字元造成 terminal log injection
 * @param {string} name
 * @throws {SyncError}
 */
function validateSkillName(name) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new SyncError(
      'skill name 含非法字元（僅允許英數、底線、點、連字號）',
      ERR.INVALID_ARGS,
      { name },
    );
  }
}

/**
 * 驗證 skill source 格式：禁止控制字元、空白、ANSI escape
 * 防止 terminal log injection 與誤導性建議指令
 * @param {string} source
 * @throws {SyncError}
 */
function validateSkillSource(source) {
  // \x00-\x1f 涵蓋 \n \r \t \x1b（ESC）等控制字元；空白與 \x7f（DEL）一併禁止
  if (/[\x00-\x20\x7f]/.test(source)) {
    throw new SyncError(
      'skill source 含非法字元（控制字元或空白）',
      ERR.INVALID_ARGS,
      { source },
    );
  }
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
    const parts = arg1.replace('https://skills.sh/', '').split('/').filter(Boolean);
    if (parts.length < 3) {
      throw new SyncError(
        '無法解析 skills.sh URL，格式應為 https://skills.sh/<org>/<repo>/<skill>',
        ERR.INVALID_ARGS,
        { url: arg1 },
      );
    }
    const name = parts[2];
    const source = `${parts[0]}/${parts[1]}`;
    validateSkillName(name);
    validateSkillSource(source);
    return { name, source };
  }

  if (arg1 && arg2) {
    validateSkillName(arg1);
    validateSkillSource(arg2);
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

  if (!lock.skills || typeof lock.skills !== 'object' || Array.isArray(lock.skills)) lock.skills = {};

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
  // 與 skills:add 一致：驗證 name 格式，防 terminal log injection（name 會輸出到建議指令）
  validateSkillName(name);

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
  console.log(col.bold('\n  ai-config-sync init'));
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

  const ok = await askConfirm(col.bold('  確定要繼續？(y/N) '), opts.yes);
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
      let content;
      try { content = fs.readFileSync(srcAbs, 'utf8'); }
      catch (e) { throw toSyncFsError(e, srcAbs, '讀取範本'); }
      writeTextSafe(destAbs, content);
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

/**
 * help 指令：顯示所有可用指令與說明
 * @returns {void}
 */
function runHelp() {
  const pkg = readPackageJson();
  const version = pkg ? pkg.version : 'unknown';

  console.log(col.bold(`\n  ai-config-sync v${version}`));
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
  console.log(`    ${col.cyan('--yes')}                  略過互動確認（非互動環境必加，別名 --force）`);
  console.log(`    ${col.cyan('--no-color')}             關閉色彩輸出（亦支援 NO_COLOR 環境變數）`);
  console.log(`    ${col.cyan('--verbose')}              顯示詳細路徑與檔案大小`);
  console.log(`    ${col.cyan('--version')}              顯示版本號（別名 -v）`);
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
    yes: false,
    noColor: false,
    verbose: false,
    showVersion: false,
    showHelp: false,
    extraArgs: [],
  };

  let pastSeparator = false;

  for (const arg of args) {
    if (arg === '--') {
      // `--` 之後的所有引數皆視為 extraArgs（支援以 `-` 開頭的 skill 名稱等）
      pastSeparator = true;
    } else if (pastSeparator) {
      result.extraArgs.push(arg);
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--yes' || arg === '--force') {
      result.yes = true;
    } else if (arg === '--no-color') {
      result.noColor = true;
    } else if (arg === '--verbose') {
      result.verbose = true;
    } else if (arg === '--version' || arg === '-v') {
      result.showVersion = true;
    } else if (arg === '--help' || arg === '-h') {
      result.showHelp = true;
    } else if (arg.startsWith('-')) {
      // 不在白名單的旗標（含 typo 如 --dryrun、--dri-run）：拒絕而非靜默忽略。
      // 否則 `--dry-run` 打錯字會略過預覽直接真寫入，使安全閘門失效。
      throw new SyncError(`未知旗標：${arg}`, ERR.INVALID_ARGS);
    } else {
      if (result.command === null) {
        // 第一個 positional arg 是指令；未知指令保留原值，由 main() 處理錯誤
        result.command = COMMAND_ALIASES[arg] || arg;
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
 * 向使用者提問並等待確認。
 * - autoYes 為 true（--yes/--force）時直接視為同意，不提問。
 * - 非互動環境（stdin 非 TTY，如 CI／pipe／/dev/null）拋錯而非靜默等待：
 *   否則 to-local 會永久 hang，或在 EOF 下 callback 不觸發、靜默 exit 0 什麼都沒做。
 * @param {string} question - 問題文字
 * @param {boolean} [autoYes=false] - 是否略過提問直接同意
 * @returns {Promise<boolean>} 使用者是否確認
 * @throws {SyncError} 非互動環境且未指定 autoYes
 */
function askConfirm(question, autoYes = false) {
  if (autoYes) return Promise.resolve(true);
  if (!process.stdin.isTTY) {
    return Promise.reject(new SyncError(
      '非互動環境無法等待確認；請改用 --dry-run 預覽，或加 --yes 略過確認',
      ERR.INVALID_ARGS,
    ));
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    // rl.close() 會同步觸發 'close' 事件，若無守衛會讓 resolve(false) 搶在答案前生效
    let answered = false;
    rl.question(question, answer => {
      answered = true;
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
    // Ctrl+D（EOF）等未作答就關閉 readline 時，才視為未確認
    rl.on('close', () => { if (!answered) resolve(false); });
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
  const opts = parseArgs();
  if (opts.noColor) disableColor();

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
  if (!COMMANDS[opts.command]) {
    throw new SyncError(`未知指令：${opts.command}`, ERR.INVALID_ARGS);
  }

  return await runCommand(opts.command, opts);
}

/**
 * 直接以 switch 分派指令，避免 handler 注入層。
 * @param {string} command
 * @param {ParsedArgs} opts
 * @returns {number|Promise<number>}
 */
async function runCommand(command, opts) {
  switch (command) {
    case 'diff': return runDiff(opts);
    case 'status': return runStatus(opts);
    case 'to-repo': return runToRepo(opts);
    case 'to-local': return runToLocal(opts);
    case 'safety:check': return runSafetyCheck();
    case 'skills:diff': return runSkillsDiff();
    case 'skills:add': return runSkillsAdd(opts);
    case 'skills:remove': return runSkillsRemove(opts);
    case 'init': return runInit(opts);
    case 'help': runHelp(); return EXIT_OK;
    default: throw new SyncError(`未知指令：${command}`, ERR.INVALID_ARGS);
  }
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
    collectSkillDiffSummary,
    buildFullDiffList,
    diffFile,
    diffDir,
    isEolOnlyDiff,
    matchExclude,
    isPathInside,
    getFiles,
    mirrorDir,
    copyFile,
    createTmpDiffFile,
    applySyncItems,
    diffSyncItems,
    diffDirItems,
    printToLocalPreview,
    buildSyncItems,
    materializeSyncItem,
    SYNC_MANIFEST,
    actionToIcon,
    mergeSettingsBetween,
    readFileSafe,
    readJson,
    writeFileSafe,
    toSyncFsError,
    askConfirm,
    runSkillsRemove,
    runSafetyCheck,
    runSafetyChecks,
    computeSkillsDiff,
    sanitizeForTerminal,
    validateSkillName,
    statusToStatsKey,
    parseSkillSource,
    parseArgs,
    toRelativePath,
    maskHome,
    serializeSettings,
    loadStrippedSettings,
    getStrippedSettings,
    partitionSettingsTopLevel,
    parsePortableCodexConfig,
    serializePortableCodexConfig,
    mergePortableCodexConfig,
    loadPortableCodexConfig,
    getPortableCodexConfig,
    loadSkillsFromLock,
    extractDeviceValues,
    mergeDeviceValues,
    DEVICE_SETTINGS_KEYS,
    SENSITIVE_KEY_PATTERN,
    SECRET_VALUE_PATTERN,
    HOME_PATH_PATTERN,
    DEVICE_ENV_KEYS,
    SETTINGS_HARD_BLOCK_KEYS,
    PRIVATE_KEY_PATTERN,
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
    formatError,
  };
}
