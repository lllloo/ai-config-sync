'use strict';

// =============================================================================
// 殘留把關：移除功能後留下的死 export、死 import 曾多次靠事後人工清理
// （db785d2、ed09fcf、c2d9a52）。此處改為機械檢查，錯誤訊息直接指名要刪什麼。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXPORTING_MODULES = ['sync.js', 'safety-check.js', 'test/helpers.js'];

function listRepoJs(root) {
  const tests = fs.readdirSync(path.join(root, 'test'))
    // 本檔的自我測試字串含歷史死碼名稱，不得算作消費者
    .filter(f => f.endsWith('.js') && f !== path.basename(__filename))
    .map(f => `test/${f}`);
  return ['sync.js', 'safety-check.js', ...tests];
}

/** 剝掉整行註解（`//`、`/*`、JSDoc 的 `*` 行）；不動行內字串，避免 `'test/*.js'` 之類被誤當註解。 */
function stripCommentLines(src) {
  return src.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
}

function parseExportNames(src) {
  const m = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  if (!m) return [];
  return stripCommentLines(m[1]).split(',')
    .map(s => s.trim().split(':')[0].trim())
    .filter(Boolean);
}

const wordRe = (name, flags) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, flags);

/** 各模組匯出、但其他任何 repo JS 都沒提到的名稱（sources：{ 相對路徑: 原始碼 }）。 */
function findUnconsumedExports(sources, modules) {
  const out = [];
  for (const mod of modules) {
    if (!(mod in sources)) continue;
    const others = Object.keys(sources).filter(f => f !== mod).map(f => stripCommentLines(sources[f]));
    for (const name of parseExportNames(sources[mod])) {
      if (!others.some(code => wordRe(name).test(code))) out.push(`${mod} → ${name}`);
    }
  }
  return out;
}

/** 測試檔自 repo 模組 destructure 出來、但模組沒匯出或檔內沒再用到的名稱。 */
function findBadImports(sources, modules) {
  const exportsOf = Object.fromEntries(modules.filter(m => m in sources).map(m => [m, parseExportNames(sources[m])]));
  const out = [];
  const reqRe = /const\s*\{([^}]*)\}\s*=\s*require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  for (const file of Object.keys(sources).filter(f => f.startsWith('test/'))) {
    const code = stripCommentLines(sources[file]);
    for (const [, names, rel] of code.matchAll(reqRe)) {
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
      if (!target.endsWith('.js')) target += '.js';
      if (!exportsOf[target]) continue;
      for (const entry of names.split(',').map(s => s.trim()).filter(Boolean)) {
        const key = entry.split(':')[0].trim();
        const local = entry.split(':').pop().trim();
        if (!exportsOf[target].includes(key)) out.push(`${file}：${key} 不是 ${target} 的匯出`);
        else if ((code.match(wordRe(local, 'g')) || []).length < 2) out.push(`${file}：${local} 匯入後未使用`);
      }
    }
  }
  return out;
}

function loadRepoSources() {
  return Object.fromEntries(listRepoJs(ROOT).map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
}

test('殘留把關：每個 module.exports 名稱至少有一個外部消費者', () => {
  const found = findUnconsumedExports(loadRepoSources(), EXPORTING_MODULES);
  assert.deepEqual(found, [], `以下匯出無任何消費者，請從 module.exports 移除（模組內部仍用就留函式本體）：\n${found.join('\n')}`);
});

test('殘留把關：測試檔匯入的名稱必須存在且有使用', () => {
  const found = findBadImports(loadRepoSources(), EXPORTING_MODULES);
  assert.deepEqual(found, [], `請從該檔的 require destructure 移除：\n${found.join('\n')}`);
});

test('殘留把關：偵測器能抓到過去的真實錯誤（db785d2 lstatSyncSafe、ed09fcf ensureSymlink）', () => {
  const sources = {
    'sync.js': 'function lstatSyncSafe() {}\nfunction used() {}\nmodule.exports = {\n  // 註解\n  used,\n  lstatSyncSafe,\n};\n',
    'test/a.test.js': "const { used, ensureSymlink, unusedOne } = require('../sync.js');\n// lstatSyncSafe 只在註解出現不算消費\nused();\nconst glob = 'test/*.js';\n",
  };
  assert.deepEqual(findUnconsumedExports(sources, ['sync.js']), ['sync.js → lstatSyncSafe']);
  assert.deepEqual(findBadImports(sources, ['sync.js']), [
    'test/a.test.js：ensureSymlink 不是 sync.js 的匯出',
    'test/a.test.js：unusedOne 不是 sync.js 的匯出',
  ]);
  sources['sync.js'] = sources['sync.js'].replace('  used,', '  used,\n  unusedOne,');
  assert.ok(findBadImports(sources, ['sync.js']).includes('test/a.test.js：unusedOne 匯入後未使用'));
});
