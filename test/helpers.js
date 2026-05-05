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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-ai-test-'));
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

module.exports = { withArgv, withTmpDir, withTmpFile };
