'use strict';

// =============================================================================
// safety-check.js -- safety:check 唯讀安全掃描模組
//
// 從 sync.js 抽出的獨立模組：承載掃描範圍收集、文字掃描、結構化 key path
// 掃描、issue 產生與 report 格式化。對外入口仍是 `node sync.js safety:check`，
// 本檔不作為獨立 CLI 執行。
//
// 邊界原則：
// - 不反向 require sync.js；共用工具（REPO_ROOT、toSyncFsError、readFileSafe、
//   readJson、toRelativePath、maskHome、col、EXIT_*）由 sync.js 經
//   createSafetyChecker(deps) 注入，sync.js 以 lazy singleton 建立 checker
//   （避開 const 相依的 TDZ），runSafetyCheck／runSafetyChecks 僅為轉接。
// - safety 專屬常數（SENSITIVE_KEY_PATTERN 等 pattern、SETTINGS_HARD_BLOCK_KEYS、
//   掃描範圍）由本檔持有並匯出，測試直接 require 本模組（sync.js 不 re-export）。
// - 掃描範圍的目錄走訪（getFiles，含 symlink 逃逸防護）由本檔持有：sync.js 的
//   同步項目皆為單檔，目錄走訪只剩 safety:check 使用。
// =============================================================================

const fs = require('fs');
const path = require('path');

/** 敏感命名 review pattern：僅供 safety:check warning，不參與同步剝除。 */
const SENSITIVE_KEY_PATTERN = /(key|token|secret|credential|password|auth|cert|cookie|session|jwt|helper|refresh)/i;

/**
 * 機密樣式值偵測（已知 token 前綴），用於 safety:check hard block。
 * 前綴清單天生無法窮舉（自訂 token 必漏），只作補漏。
 * 涵蓋：Anthropic/OpenAI sk-、Stripe sk_live_/sk_test_、GitHub ghp_/github_pat_、
 * GitLab glpat-、AWS AKIA、Google AIza、SendGrid SG.、npm npm_、Slack xox?-／xapp-、JWT eyJ
 */
const SECRET_VALUE_PATTERN = /\b(sk-[\w-]{8,}|sk_(?:live|test)_\w{8,}|ghp_\w{20,}|github_pat_|glpat-|AKIA[0-9A-Z]{16}|AIza[\w-]{16,}|SG\.[\w-]{16,}|npm_\w{20,}|xox[baprs]-|xapp-|eyJ[\w-]{10,}\.)/;

/**
 * 絕對家目錄路徑偵測（C:\Users\、/Users/、/home/、/root/）——完整使用者路徑不得進 repo。
 * Windows 分支的分隔類別必須吃 1~2 個反斜線：主力平台是 Windows 11，而路徑落在
 * JSON（settings.json）時磁碟原文是跳脫過的 `C:\\Users\\name`，只吃單一分隔字元會漏掉。
 * WSL UNC 分支（`wslpath -w` 產物 `\\wsl.localhost\<distro>\home\<user>`、`\\wsl$\…`）
 * 以反斜線分隔，`/home/` 分支抓不到；只在 distro 段後接 `home\<user>`／`root\` 時命中，
 * 說明用的佔位寫法（`\\wsl.localhost\<Distro>\...`）不誤判。
 */
const HOME_PATH_PATTERN = /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)|\/(?:home|Users)\/\w|\/root\/|wsl(?:\.localhost|\$)\\{1,2}[^\\\s]+\\{1,2}(?:home\\{1,2}\w|root\\)/;

/**
 * 通用 HOME 路徑遮罩（不限本機 HOME）：把任何裝置的家目錄前綴 + 使用者名稱段替換為 `~`。
 * `maskHome` 只做本機 HOME 字串替換，對「從別台裝置來的設定檔」無效——例如
 * key path 內嵌的別台家目錄會被原樣印出，洩漏 alice。
 */
const ANY_HOME_PATH_PATTERN = /(?:[A-Za-z]:(?:\\{1,2}|\/)Users|\/home|\/Users|\/root)(?:\\{1,2}|\/)[^\\/"'\s]+/g;

function maskAnyHomePath(text) {
  return text.replace(ANY_HOME_PATH_PATTERN, '~');
}

/**
 * detail 輸出遮罩用的 SECRET_VALUE_PATTERN 延伸版：偵測用 pattern 的部分 alternative
 * 只比對「前綴」（glpat-／xoxb- 等），拿來遮罩會只遮掉前綴、token 本體照印，
 * 故往後多吃連續的 token 字元。detail 通常是 key 名或行號，正常內容
 * 不含這些前綴，誤遮風險可忽略。
 */
const SECRET_REDACT_PATTERN = new RegExp(`${SECRET_VALUE_PATTERN.source}[\\w.-]*`, 'g');

/** detail 層 secret 遮罩：命中 token 樣式的片段整段換成 ***（不輸出原值） */
function maskSecretValues(text) {
  return text.replace(SECRET_REDACT_PATTERN, '***');
}

/** 私鑰片段偵測（只回報位置，不輸出內容） */
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** repo settings.json 內出現即為 hard block 的 top-level 欄位 */
const SETTINGS_HARD_BLOCK_KEYS = ['hooks', 'apiKeyHelper', 'awsCredentialExport', 'awsAuthRefresh', 'otelHeadersHelper'];

/**
 * 已人工審核過的 claude/settings.json env key：不再每次報「env key 需人工審核」warning。
 * 只關 warning——值仍受 text 掃描（已知 token、私鑰、HOME 路徑）把關；不在清單的新 key 照報。
 * 不得收命中 SENSITIVE_KEY_PATTERN 的 key（測試把關），那類即使列入也照報。增減須同步改 README。
 */
const SAFETY_REVIEWED_ENV_KEYS = [
  'EDITOR',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_DISABLE_MOUSE',
  'CLAUDE_CODE_DISABLE_MOUSE_CLICKS',
];

/** 已審核且非敏感命名的 env key 才略過 warning（敏感命名為縱深防禦，即使誤列也照報） */
function isReviewedEnvKey(key) {
  return SAFETY_REVIEWED_ENV_KEYS.includes(key) && !SENSITIVE_KEY_PATTERN.test(key);
}

/** safety:check 僅掃同步來源，不掃 test/docs/README 等文件 */
const SAFETY_SCAN_DIRS = ['claude', 'codex', 'gemini'];

/** 走訪掃描範圍時永遠略過的檔名 */
const SCAN_EXCLUDE_NAMES = ['.DS_Store'];

/**
 * 判斷 target 路徑（已解析的 realpath）是否落在 root 目錄（或其子目錄）之內
 * 用於阻擋 symlink 逃逸出掃描目錄
 * @param {string} targetReal - 已 realpath 的目標絕對路徑
 * @param {string} rootReal - 已 realpath 的根目錄絕對路徑
 * @returns {boolean}
 */
function isPathInside(targetReal, rootReal) {
  if (targetReal === rootReal) return true;
  const root = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return targetReal.startsWith(root);
}

/** 純函式：回傳第一個命中 pattern 的行號（1-based），無則 null */
function findFirstMatchingLine(content, pattern) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i + 1;
  }
  return null;
}

/**
 * 建立 safety checker：以 dependency injection 接收 sync.js 的共用工具，
 * 內部掃描與輸出函式閉包捕捉 deps，避免逐一穿參或反向 require。
 * @param {{
 *   REPO_ROOT: string,
 *   toSyncFsError: (e: Error, filePath: string, op: string) => Error,
 *   readFileSafe: (filePath: string, op?: string, encoding?: string) => string|Buffer,
 *   readJson: (filePath: string) => object,
 *   toRelativePath: (filePath: string) => string,
 *   maskHome: (text: string) => string,
 *   col: Record<string, (s: string) => string>,
 *   EXIT_OK: number, EXIT_DIFF: number, EXIT_ERROR: number,
 * }} deps
 * @returns {{ runSafetyCheck: () => number, runSafetyChecks: () => object[], printSafetyReport: (issues: object[]) => void, getFiles: (dir: string) => string[] }}
 */
function createSafetyChecker(deps) {
  const { REPO_ROOT, toSyncFsError, readFileSafe, readJson, toRelativePath, maskHome, col, EXIT_OK, EXIT_DIFF, EXIT_ERROR } = deps;

  /**
   * 遞迴列出目錄下所有檔案的相對路徑
   * - 目錄不存在（ENOENT）視為空集，其他 IO 錯誤必須拋出避免誤判
   *   （空集被下游當作「無檔案」，若靜默吞錯會讓 safety:check 漏掃整個目錄卻回報通過）
   * - symlink 指向的檔案若 realpath 逃出 dir 外，直接跳過（防止把 ~/.ssh 等敏感檔當成掃描對象）
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
      if (SCAN_EXCLUDE_NAMES.includes(entry.name)) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink() && !isSymlinkFileInside(entryPath, rootReal)) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(...getFiles(entryPath, rel, rootReal));
      } else {
        result.push(rel);
      }
    }
    return result;
  }

  // symlink 須指向根目錄內的檔案才納入；ENOENT（broken link）靜默跳過，
  // 其他 IO 錯誤 warn 後跳過，方便排查。指向目錄的 symlink 一律不跟進。
  function isSymlinkFileInside(entryPath, rootReal) {
    let real;
    try {
      real = fs.realpathSync(entryPath);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn(col.yellow(`  [warn] 解析 symlink 失敗（${e.code}）：${toRelativePath(entryPath)}`));
      }
      return false;
    }
    if (!isPathInside(real, rootReal)) return false;
    try {
      return !fs.statSync(entryPath).isDirectory();
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn(col.yellow(`  [warn] 讀取 symlink 屬性失敗（${e.code}）：${toRelativePath(entryPath)}`));
      }
      return false;
    }
  }

  // detail 除本機 HOME 遮罩外，再套通用 HOME 路徑遮罩（key path 原文可能
  // 內嵌**別台裝置**的家目錄，maskHome 抓不到，見 ANY_HOME_PATH_PATTERN）與 secret
  // 遮罩（token 反常地作為 key 名而非 value 時，keyPath 會經 detail
  // 原樣輸出，違反「只列位置、不輸出值」的不變式，見 SECRET_REDACT_PATTERN）
  function addSafetyIssue(issues, severity, category, filePath, detail = '') {
    issues.push({
      severity, category, file: toRelativePath(filePath),
      detail: maskSecretValues(maskAnyHomePath(maskHome(detail))),
    });
  }

  function collectSafetyScanFiles() {
    const files = [];
    for (const dir of SAFETY_SCAN_DIRS) {
      const root = path.join(REPO_ROOT, dir);
      for (const rel of getFiles(root)) files.push(path.join(root, rel));
    }
    return files;
  }

  function scanSafetyTextFile(filePath, issues) {
    const content = String(readFileSafe(filePath, '讀取安全檢查檔案', 'utf8'));
    const checks = [
      ['疑似機密值', SECRET_VALUE_PATTERN],
      ['私鑰片段', PRIVATE_KEY_PATTERN],
      ['絕對 HOME 路徑', HOME_PATH_PATTERN],
    ];
    for (const [category, pattern] of checks) {
      const line = findFirstMatchingLine(content, pattern);
      if (line !== null) addSafetyIssue(issues, 'hard', category, filePath, `line ${line}`);
    }
  }

  function scanSensitiveKeyPaths(node, filePath, issues, trail = '', skipEnv = false) {
    if (node === null || typeof node !== 'object') return;
    for (const [key, val] of Object.entries(node)) {
      const next = trail ? `${trail}.${key}` : key;
      if (trail === '' && SETTINGS_HARD_BLOCK_KEYS.includes(key)) continue;
      if (skipEnv && next === 'env') continue;
      if (SENSITIVE_KEY_PATTERN.test(key)) addSafetyIssue(issues, 'warning', '敏感命名 key path', filePath, next);
      scanSensitiveKeyPaths(val, filePath, issues, next, skipEnv);
    }
  }

  function scanClaudeSettingsSafety(filePath, issues) {
    const data = readJson(filePath);
    for (const key of SETTINGS_HARD_BLOCK_KEYS) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        addSafetyIssue(issues, 'hard', '不應同步 settings 欄位', filePath, key);
      }
    }
    if (data.env && typeof data.env === 'object') {
      for (const key of Object.keys(data.env)) {
        if (!isReviewedEnvKey(key)) addSafetyIssue(issues, 'warning', 'env key 需人工審核', filePath, `env.${key}`);
      }
    }
    scanSensitiveKeyPaths(data, filePath, issues, '', true);
  }

  function scanJsonKeyWarnings(filePath, issues) {
    scanSensitiveKeyPaths(readJson(filePath), filePath, issues);
  }

  function scanSafetyStructuredFile(filePath, issues) {
    const rel = toRelativePath(filePath).replace(/\\/g, '/');
    if (rel === 'claude/settings.json') scanClaudeSettingsSafety(filePath, issues);
    else if (rel.endsWith('.json')) scanJsonKeyWarnings(filePath, issues);
  }

  function runSafetyChecks() {
    const issues = [];
    for (const filePath of collectSafetyScanFiles()) {
      scanSafetyTextFile(filePath, issues);
      scanSafetyStructuredFile(filePath, issues);
    }
    return issues;
  }

  function printSafetyIssueGroup(title, issues) {
    if (!issues.length) return;
    console.log(col.bold(`  ${title}:`));
    for (const issue of issues) {
      const detail = issue.detail ? `（${issue.detail}）` : '';
      console.log(`    ${issue.category}：${issue.file}${detail}`);
    }
    console.log('');
  }

  function printSafetyReport(issues) {
    const hard = issues.filter(i => i.severity === 'hard');
    const warnings = issues.filter(i => i.severity === 'warning');
    console.log(col.bold('\n  safety:check 同步來源安全檢查\n'));
    if (!issues.length) {
      console.log(col.green('  未發現 hard block 或 warning\n'));
      return;
    }
    printSafetyIssueGroup('Hard blocks', hard);
    printSafetyIssueGroup('Warnings', warnings);
    console.log(hard.length ? col.red('  結果：發現 hard block\n') : col.yellow('  結果：僅有 warning\n'));
  }

  function runSafetyCheck() {
    const issues = runSafetyChecks();
    printSafetyReport(issues);
    if (issues.some(i => i.severity === 'hard')) return EXIT_ERROR;
    return issues.length ? EXIT_DIFF : EXIT_OK;
  }

  return { runSafetyCheck, runSafetyChecks, printSafetyReport, getFiles };
}

// 只導出有外部消費者（sync.js 或 test/）的成員。findFirstMatchingLine／HOME_PATH_PATTERN／
// PRIVATE_KEY_PATTERN 僅供本檔內部使用，刻意不導出以縮小對外契約面
module.exports = {
  createSafetyChecker,
  SENSITIVE_KEY_PATTERN,
  SECRET_VALUE_PATTERN,
  maskSecretValues,
  SETTINGS_HARD_BLOCK_KEYS,
  SAFETY_REVIEWED_ENV_KEYS,
  SAFETY_SCAN_DIRS,
  isPathInside,
};
