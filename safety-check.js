'use strict';

// =============================================================================
// safety-check.js -- safety:check 唯讀安全掃描模組
//
// 從 sync.js 抽出的獨立模組：承載掃描範圍收集、文字掃描、結構化 key path
// 掃描、issue 產生與 report 格式化。對外入口仍是 `node sync.js safety:check`
// 與 `npm run safety:check`，本檔不作為獨立 CLI 執行。
//
// 邊界原則（見 openspec/changes/extract-safety-check-module/design.md）：
// - 不反向 require sync.js；共用工具（REPO_ROOT、getFiles、readFileSafe、
//   readJson、toRelativePath、maskHome、col、EXIT_*）由 sync.js 經
//   createSafetyChecker(deps) 注入，sync.js 以 lazy singleton 建立 checker
//   （避開 const 相依的 TDZ），runSafetyCheck／runSafetyChecks 僅為轉接。
// - safety 專屬常數（SENSITIVE_KEY_PATTERN 等 pattern、SETTINGS_HARD_BLOCK_KEYS、
//   CODEX_CONFIG_HARD_BLOCK_SECTIONS、掃描範圍）由本檔持有並匯出，測試直接
//   require 本模組（sync.js 不 re-export）。
//
// TOML 解析直接 require toml-reader.js 的 readTomlStatements（純函式、零 IO，
// 不經 deps 注入；非 sync.js 故不違反反向 require 禁令）：不自製逐行 regex，
// 統一 header／kv 判斷並具備跨行狀態感知（多行陣列、"""／''' 三引號字串併入
// 續行）——既辨識 array-of-tables（[[x]]）／尾註解／內部空白等合法 header 變體，
// 也杜絕字串內的 [x] 樣式被誤判為 section header 而錯標 key 歸屬。
// scanTomlKeyWarnings 除敏感命名 key 的 warning 外，另對命中
// CODEX_CONFIG_HARD_BLOCK_SECTIONS 的 section header 回報 hard block
// （只印 section 路徑、不印值）。
//
// codex config.toml 已不再同步（改由 README 列建議設定、使用者手動套用），
// 本檔的 .toml 掃描保留為純防禦性覆蓋：repo 內若出現任何 .toml（人工新增或
// 未來新同步項），機密 section 與敏感命名 key 仍被攔下。
//
// text pattern 掃描（scanSafetyTextFile：secret／私鑰／HOME 路徑）於
// runSafetyChecks 逐檔迴圈中對命中 SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES 的檔略過。
// **該清單目前為空**——排除的粒度必須是「具體的上游鏡射子目錄」，不得是整個
// 同步來源根（曾誤列 agents/skills/，等於整棵跨工具 skill 樹不受掃描），詳見常數註解。
// =============================================================================

const fs = require('fs');
const path = require('path');
const { readTomlStatements, splitTomlKey } = require('./toml-reader.js');

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
 */
const HOME_PATH_PATTERN = /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)|\/(?:home|Users)\/\w|\/root\//;

/**
 * 通用 HOME 路徑遮罩（不限本機 HOME）：把任何裝置的家目錄前綴 + 使用者名稱段替換為 `~`。
 * `maskHome` 只做本機 HOME 字串替換，對「從別台裝置來的設定檔」無效——例如
 * `[mcp_servers."C:\\Users\\alice\\srv"]` 的 section 名會被原樣印出，洩漏 alice。
 */
const ANY_HOME_PATH_PATTERN = /(?:[A-Za-z]:(?:\\{1,2}|\/)Users|\/home|\/Users|\/root)(?:\\{1,2}|\/)[^\\/"'\s]+/g;

function maskAnyHomePath(text) {
  return text.replace(ANY_HOME_PATH_PATTERN, '~');
}

/** 私鑰片段偵測（只回報位置，不輸出內容） */
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

/** repo settings.json 內出現即為 hard block 的 top-level 欄位 */
const SETTINGS_HARD_BLOCK_KEYS = ['hooks', 'apiKeyHelper', 'awsCredentialExport', 'awsAuthRefresh', 'otelHeadersHelper'];

/**
 * repo `.toml` 內出現即為 hard block 的機密載體 section 前綴。config.toml 已不再
 * 同步（沒有同步層會先剝除），此為唯一防線——防人工把含 API key／MCP 憑證的
 * config.toml 放進 repo。比照 SETTINGS_HARD_BLOCK_KEYS 對 settings.json 的守備。
 *
 * 注意：本防線與 MCP 同步機制**無因果關係**。MCP 同步已整批移除（見
 * openspec/changes/archive/*-remove-mcp-sync），但「有人手動複製 ~/.codex/config.toml
 * 進 repo 備份」的風險並未因此降低，故 `mcp_servers` 仍留在清單中，`toml-reader.js`
 * 亦隨之保留。不要把它們當成 MCP 同步的遺留物清掉。
 */
const CODEX_CONFIG_HARD_BLOCK_SECTIONS = ['model_providers', 'mcp_servers'];

/**
 * repo `.toml` 內出現即為 warning 的裝置狀態 section 前綴：這些 section 綁定單一
 * 裝置（設定檔路徑、歷史、shell 環境），放進 repo 多半是誤加，出現時提示人工確認。
 */
const CODEX_CONFIG_DEVICE_WARN_SECTIONS = ['profiles', 'history', 'shell_environment_policy'];

/** safety:check 僅掃同步來源與 skills manifest，不掃 test/openspec/README 等文件 */
const SAFETY_SCAN_DIRS = ['claude', 'codex', 'agents'];
const SAFETY_SCAN_FILES = ['skills-lock.json'];

/**
 * text pattern 掃描（secret／私鑰／HOME 路徑）排除的外部套件文件目錄前綴
 * （相對 REPO_ROOT 的 POSIX 前綴）。**目前為空**：唯一的排除項曾是 `agents/skills/`，
 * 但那是三個同步來源根目錄之一的**全部內容**，且其下的 skill 皆為本 repo 手寫、
 * 非「原樣鏡射的第三方套件文件」——整個跨工具全域 skill 樹因此完全不受 secret／
 * 私鑰／HOME 路徑掃描，等同在最大的同步來源上開了個洞。
 *
 * 日後若真的引入原樣鏡射的上游套件文件（為說明偵測規則本就含 token／路徑樣式，
 * 掃它天生整類 false positive），只列**該 package 的具體子目錄**（如
 * `agents/skills/<pkg>/references/`），不得整棵樹排除。排除只作用於 text 掃描；
 * 結構化 .json／.toml 掃描（含 hard block）不受影響。
 */
const SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES = [];

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
 *   getFiles: (dir: string) => string[],
 *   readFileSafe: (filePath: string, op?: string, encoding?: string) => string|Buffer,
 *   readJson: (filePath: string) => object,
 *   toRelativePath: (filePath: string) => string,
 *   maskHome: (text: string) => string,
 *   col: Record<string, (s: string) => string>,
 *   EXIT_OK: number, EXIT_DIFF: number, EXIT_ERROR: number,
 * }} deps
 * @returns {{ runSafetyCheck: () => number, runSafetyChecks: () => object[], printSafetyReport: (issues: object[]) => void }}
 */
function createSafetyChecker(deps) {
  const { REPO_ROOT, getFiles, readFileSafe, readJson, toRelativePath, maskHome, col, EXIT_OK, EXIT_DIFF, EXIT_ERROR } = deps;

  // detail 除本機 HOME 遮罩外，再套一次通用 HOME 路徑遮罩：section／key path 原文
  // 可能內嵌**別台裝置**的家目錄，maskHome 的字串比對抓不到（見 ANY_HOME_PATH_PATTERN）
  function addSafetyIssue(issues, severity, category, filePath, detail = '') {
    issues.push({ severity, category, file: toRelativePath(filePath), detail: maskAnyHomePath(maskHome(detail)) });
  }

  function collectSafetyScanFiles() {
    const files = [];
    for (const dir of SAFETY_SCAN_DIRS) {
      const root = path.join(REPO_ROOT, dir);
      for (const rel of getFiles(root)) files.push(path.join(root, rel));
    }
    for (const rel of SAFETY_SCAN_FILES) {
      const filePath = path.join(REPO_ROOT, rel);
      if (fs.existsSync(filePath)) files.push(filePath);
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
      for (const key of Object.keys(data.env)) addSafetyIssue(issues, 'warning', 'env key 需人工審核', filePath, `env.${key}`);
    }
    scanSensitiveKeyPaths(data, filePath, issues, '', true);
  }

  function scanJsonKeyWarnings(filePath, issues) {
    scanSensitiveKeyPaths(readJson(filePath), filePath, issues);
  }

  function scanTomlKeyWarnings(filePath, issues) {
    const content = String(readFileSafe(filePath, '讀取 TOML 安全檢查檔案', 'utf8'));
    // 使用 toml-reader 的狀態感知語句讀取器：統一 header／kv 判斷、正確處理多行
    // 陣列、三引號字串與含 `]` 的引號 section 名，避免自製逐行 regex 把字串內的
    // `[x]` 樣式誤判為 section header（section 歸屬錯標）。
    //
    // malformed header（name === null）一律 hard block 並清空 section：section
    // 名不可信時，機密 section 判斷失去依據，寧可 fail closed 讓人工檢視，也不
    // 沿用前一個 section 名（那會讓機密 section 的 hard block 靜默降級成 warning）。
    let section = '';
    for (const st of readTomlStatements(content)) {
      if (st.type === 'section') { section = handleTomlSection(st, filePath, issues); continue; }
      if (st.type !== 'kv') continue;
      const keyPath = section ? `${section}.${st.key}` : st.key;
      if (SENSITIVE_KEY_PATTERN.test(keyPath)) addSafetyIssue(issues, 'warning', '敏感命名 key path', filePath, keyPath);
    }
  }

  /**
   * 處理一筆 section statement，回傳其後 kv 應歸屬的 section 名（不可信時回 ''）。
   * 三條 fail-closed 路徑（皆 hard block + 清空 section）：
   * 1. malformed header（reason 'header'）
   * 2. 未閉合 value 造成的不可信邊界（reason 'unterminated-value'）
   * 3. section 名含無法解碼的跳脫序列（splitTomlKey 回 null）
   */
  function handleTomlSection(st, filePath, issues) {
    if (st.name === null) {
      const category = st.reason === 'unterminated-value'
        ? '未閉合的 TOML value（其後 section 歸屬不可信）'
        : '無法解析的 TOML section header';
      addSafetyIssue(issues, 'hard', category, filePath, `line ${st.line}`);
      return '';
    }
    if (splitTomlKey(st.name) === null) {
      addSafetyIssue(issues, 'hard', '無法解碼的 TOML section 名', filePath, `line ${st.line}`);
      return '';
    }
    if (isCodexSecretSection(st.name)) {
      addSafetyIssue(issues, 'hard', '不應同步 codex 機密 section', filePath, st.name);
    } else if (isCodexDeviceWarnSection(st.name)) {
      addSafetyIssue(issues, 'warning', 'codex 裝置狀態 section 需人工審核', filePath, st.name);
    }
    return st.name;
  }

  // 比對 section 的第一個 dotted 片段（引號感知去引號 + 跳脫解碼後）：`[mcp_servers]`／
  // `[mcp_servers.foo]`／`["mcp_servers"]`／`["mcp_servers"]` 均命中，杜絕以引號
  // 包裝或跳脫序列繞過 hard block（splitTomlKey 正規化，見 toml-reader.js）。
  // 呼叫端已先擋掉 splitTomlKey 回 null 的情況（handleTomlSection）。
  function isCodexSecretSection(section) {
    const [first] = splitTomlKey(section);
    return CODEX_CONFIG_HARD_BLOCK_SECTIONS.includes(first);
  }

  function isCodexDeviceWarnSection(section) {
    const [first] = splitTomlKey(section);
    return CODEX_CONFIG_DEVICE_WARN_SECTIONS.includes(first);
  }

  function scanSafetyStructuredFile(filePath, issues) {
    const rel = toRelativePath(filePath).replace(/\\/g, '/');
    if (rel === 'claude/settings.json') scanClaudeSettingsSafety(filePath, issues);
    else if (rel.endsWith('.json')) scanJsonKeyWarnings(filePath, issues);
    else if (rel.endsWith('.toml')) scanTomlKeyWarnings(filePath, issues);
  }

  function isTextScanExcluded(filePath) {
    const rel = toRelativePath(filePath).replace(/\\/g, '/');
    return SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES.some(prefix => rel.startsWith(prefix));
  }

  function runSafetyChecks() {
    const issues = [];
    for (const filePath of collectSafetyScanFiles()) {
      // 外部套件文件（skills）只略過 text pattern 掃描；結構化掃描仍跑
      // （對 .md no-op、對未來 .json／.toml 保留 hard block 偵測）
      if (!isTextScanExcluded(filePath)) scanSafetyTextFile(filePath, issues);
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

  return { runSafetyCheck, runSafetyChecks, printSafetyReport };
}

// 只導出有外部消費者（sync.js 或 test/）的成員。findFirstMatchingLine／HOME_PATH_PATTERN／
// PRIVATE_KEY_PATTERN／SAFETY_SCAN_FILES 僅供本檔內部使用，刻意不導出以縮小對外契約面
module.exports = {
  createSafetyChecker,
  SENSITIVE_KEY_PATTERN,
  SECRET_VALUE_PATTERN,
  SETTINGS_HARD_BLOCK_KEYS,
  CODEX_CONFIG_HARD_BLOCK_SECTIONS,
  CODEX_CONFIG_DEVICE_WARN_SECTIONS,
  SAFETY_SCAN_DIRS,
  SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES,
};
