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

// =============================================================================
// 文件殘留：AGENTS.md／README.md 曾在功能移除後繼續指名已刪的函式與欄位
// （32e7806 前的 createXtoolDir／applyXtoolItem、3da90b1 後的 homeLabel／homeRootFile），
// agent 照文件找不到東西或照著把它加回來。反引號內「長得像程式識別字」的 token
// 必須存在於 repo JS；刻意指名已刪或外部專案的名稱，於同一行加
// `<!-- doc-ref-ok: 名稱, 名稱 — 理由 -->`（理由必填）。
// =============================================================================

const DOC_FILES = ['AGENTS.md', 'README.md'];
const DOC_REF_OK_RE = /<!--\s*doc-ref-ok:\s*([^—>]+?)\s*—\s*\S[^>]*-->/;

/** camelCase、PascalCase 帶內部大寫、UPPER_SNAKE，或 `*.js` 檔名；其餘（指令、旗標、路徑、一般字）不檢查。 */
function classifyDocToken(raw) {
  const tok = raw.replace(/\(.*\)$/, '').replace(/^\.\//, '');
  if (/^(test\/)?[\w.-]+\.js$/.test(tok)) return { kind: 'file', name: tok.replace(/^test\//, '') };
  if (/^[a-z_$][\w$]*[a-z0-9][A-Z][\w$]*$/.test(tok)) return { kind: 'id', name: tok };
  if (/^[A-Z][a-z0-9]+[A-Z][\w$]*$/.test(tok)) return { kind: 'id', name: tok };
  if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(tok)) return { kind: 'id', name: tok };
  return null;
}

/** 回傳 docs 中指名、但 repo JS 找不到的識別字／檔名（docs：{ 檔名: 內容 }，jsFiles：{ 相對路徑: 原始碼 }）。 */
function findStaleDocRefs(docs, jsFiles) {
  const code = Object.values(jsFiles).join('\n');
  const baseNames = new Set(Object.keys(jsFiles).map(f => path.posix.basename(f)));
  const out = [];
  for (const [doc, text] of Object.entries(docs)) {
    text.split('\n').forEach((line, i) => {
      const okMatch = line.match(DOC_REF_OK_RE);
      const allowed = new Set(okMatch ? okMatch[1].split(/[,，、]/).map(s => s.trim()) : []);
      for (const [, raw] of line.matchAll(/`([^`\s]+)`/g)) {
        const t = classifyDocToken(raw);
        if (!t || allowed.has(t.name)) continue;
        const exists = t.kind === 'file' ? baseNames.has(t.name) : wordRe(t.name).test(code);
        if (!exists) out.push(`${doc}:${i + 1} → ${t.name}`);
      }
    });
  }
  return out;
}

test('文件殘留：AGENTS.md／README.md 指名的識別字與 .js 檔皆存在', () => {
  const docs = Object.fromEntries(DOC_FILES.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  const found = findStaleDocRefs(docs, loadRepoSources());
  assert.deepEqual(found, [],
    `文件指名的名稱在 repo JS 找不到——改寫成現行名稱或刪掉該句；刻意指名已刪／外部名稱時於同行加 <!-- doc-ref-ok: 名稱 — 理由 -->：\n${found.join('\n')}`);
});

test('文件殘留：偵測器能抓到過去的真實錯誤（32e7806 createXtoolDir、3da90b1 homeLabel）', () => {
  const js = { 'sync.js': 'function createSafetyChecker() {}\nconst DEVICE_SETTINGS_KEYS = [];\n' };
  const docs = {
    'AGENTS.md': [
      'DI factory（`createSafetyChecker`／`createXtoolDir`）',
      '可選 `homeLabel` 欄位；`DEVICE_SETTINGS_KEYS` 不比；`sync.js`、`gone.js`',
      '`skills.js` 已移除 <!-- doc-ref-ok: skills.js — 禁止恢復的指名 -->',
      '`skills.js` 無理由豁免無效 <!-- doc-ref-ok: skills.js -->',
      '`node sync.js diff`、`--dry-run`、`claude/settings.json`、`to-local` 不檢查',
    ].join('\n'),
  };
  assert.deepEqual(findStaleDocRefs(docs, js), [
    'AGENTS.md:1 → createXtoolDir',
    'AGENTS.md:2 → homeLabel',
    'AGENTS.md:2 → gone.js',
    'AGENTS.md:4 → skills.js',
  ]);
});
