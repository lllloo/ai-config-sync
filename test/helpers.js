'use strict';

// =============================================================================
// 測試共用 helper（零外部相依）
// 集中 withArgv / withTmpDir / withTmpFile，避免在多個測試檔重複定義
// =============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 暫時改寫 process.argv 執行 fn，結束後還原
 * @template T
 * @param {string[]} argv - 不含 ['node', 'sync.js'] 前綴
 * @param {() => T} fn
 * @returns {T}
 */
function withArgv(argv, fn) {
  const original = process.argv;
  process.argv = ['node', 'sync.js', ...argv];
  try { return fn(); } finally { process.argv = original; }
}

/**
 * 建立臨時目錄執行 fn，結束後遞迴刪除
 * @template T
 * @param {(dir: string) => T} fn
 * @returns {T}
 */
function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-config-sync-test-'));
  try { return fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * 在臨時目錄建立 skills-lock.json 並執行 fn
 * @template T
 * @param {string|null} contentOrSkip - 要寫入的內容；傳 null 則不建檔（僅給路徑）
 * @param {(filePath: string) => T} fn
 * @returns {T}
 */
function withTmpFile(contentOrSkip, fn) {
  return withTmpDir((dir) => {
    const fp = path.join(dir, 'skills-lock.json');
    if (contentOrSkip !== null) fs.writeFileSync(fp, contentOrSkip);
    return fn(fp);
  });
}

/**
 * 產生 spawn 子行程用的無色彩環境：設 NO_COLOR 並剔除外層繼承的 FORCE_COLOR，
 * 讓整合測試的純文字斷言不受終端環境影響（外層設 FORCE_COLOR 時，子行程雖為
 * pipe 非 TTY 仍會輸出 ANSI 色碼，插在圖示與檔名之間破壞 regex 鄰接性）。
 * @param {Record<string, string>} [overrides] - 額外覆寫的環境變數（如 HOME）
 * @returns {NodeJS.ProcessEnv}
 */
function noColorEnv(overrides = {}) {
  const env = { ...process.env, NO_COLOR: '1', ...overrides };
  delete env.FORCE_COLOR;
  return env;
}

module.exports = { withArgv, withTmpDir, withTmpFile, noColorEnv };
