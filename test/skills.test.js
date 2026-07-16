'use strict';

// =============================================================================
// skills.js 單元測試：對稱 toml-reader.test.js，集中驗證 skills 模組的純函式與
// deps-bound helper（不經 sync.js re-export），證明 skills.js 可獨立於 sync.js 測試。
//
// - computeSkillsDiff／sanitizeForTerminal 為模組層純函式，直接 require。
// - loadSkillsFromLock／validateSkillName／validateSkillSource／parseSkillSource
//   為 deps-bound，經 createSkillsHandler 注入 SyncError／ERR／readJson 後由回傳
//   物件取得（runCommand 只用三個對外方法，這些 helper 是 re-export／測試 seam）。
// runSkillsDiff／runSkillsAdd／runSkillsRemove 的端到端行為由整合／邊界測試覆蓋。
// =============================================================================

const assert = require('node:assert');
const { test } = require('node:test');

const { createSkillsHandler, computeSkillsDiff, sanitizeForTerminal } = require('../skills.js');
const { SyncError, ERR, readJson, EXIT_OK, EXIT_DIFF } = require('../sync.js');
const { withTmpFile } = require('./helpers.js');

// 建立測試用 handler：display 相依以 no-op 注入（本檔不測 runSkillsDiff 輸出）。
function makeHandler() {
  return createSkillsHandler({
    REPO_ROOT: '/tmp/nonexistent-repo',
    LOCAL_SKILL_LOCK: '/tmp/nonexistent/.skill-lock.json',
    EXIT_OK, EXIT_DIFF,
    SyncError, ERR, readJson,
    writeJsonSafe: () => {},
    printSectionDivider: () => {},
    printStatusLine: () => {},
    col: new Proxy({}, { get: () => (s) => s }),
  });
}

// --- computeSkillsDiff（純函式）-----------------------------------------------

test('computeSkillsDiff：正確分出 onlyInRepo / onlyInLocal / inBoth', () => {
  const repo = { a: {}, b: {}, c: {} };
  const local = { b: {}, c: {}, d: {} };
  const r = computeSkillsDiff(repo, local);
  assert.deepEqual(r.onlyInRepo, ['a']);
  assert.deepEqual(r.onlyInLocal, ['d']);
  assert.deepEqual(r.inBoth, ['b', 'c']);
});

test('computeSkillsDiff：兩邊皆空時三類皆空', () => {
  const r = computeSkillsDiff({}, {});
  assert.deepEqual(r.onlyInRepo, []);
  assert.deepEqual(r.onlyInLocal, []);
  assert.deepEqual(r.inBoth, []);
});

// --- sanitizeForTerminal（純函式）--------------------------------------------

test('sanitizeForTerminal：剝除 ANSI escape、換行與控制字元', () => {
  assert.equal(sanitizeForTerminal('a\x1b[31mb\nc\r\x07'), 'a[31mbc');
});

// --- validateSkillName / validateSkillSource（deps-bound）---------------------

test('validateSkillName：含 ANSI escape / 換行的 name 拋 INVALID_ARGS，合法 name 通過', () => {
  const h = makeHandler();
  assert.throws(() => h.validateSkillName('\x1b[2Jevil'), e => e instanceof SyncError && e.code === ERR.INVALID_ARGS);
  assert.throws(() => h.validateSkillName('a\nb'), e => e.code === ERR.INVALID_ARGS);
  assert.doesNotThrow(() => h.validateSkillName('valid.skill_name-1'));
});

test('validateSkillSource：含控制字元或空白拋 INVALID_ARGS，合法 source 通過', () => {
  const h = makeHandler();
  assert.throws(() => h.validateSkillSource('org/repo\x1b[31m'), e => e instanceof SyncError && e.code === ERR.INVALID_ARGS);
  assert.throws(() => h.validateSkillSource('org repo'), e => e.code === ERR.INVALID_ARGS);
  assert.doesNotThrow(() => h.validateSkillSource('anthropics/skills'));
});

// --- parseSkillSource（deps-bound）-------------------------------------------

test('parseSkillSource：skills.sh URL 解析', () => {
  const h = makeHandler();
  const result = h.parseSkillSource({
    extraArgs: ['https://skills.sh/anthropics/skills/web-search'],
  });
  assert.deepEqual(result, { name: 'web-search', source: 'anthropics/skills' });
});

test('parseSkillSource：URL 有尾部斜線仍可解析', () => {
  const h = makeHandler();
  const result = h.parseSkillSource({
    extraArgs: ['https://skills.sh/org/repo/skill/'],
  });
  assert.deepEqual(result, { name: 'skill', source: 'org/repo' });
});

test('parseSkillSource：name + source 雙引數', () => {
  const h = makeHandler();
  const result = h.parseSkillSource({ extraArgs: ['my-skill', 'org/repo'] });
  assert.deepEqual(result, { name: 'my-skill', source: 'org/repo' });
});

test('parseSkillSource：缺少引數應丟 SyncError', () => {
  const h = makeHandler();
  assert.throws(
    () => h.parseSkillSource({ extraArgs: [] }),
    e => e instanceof SyncError && e.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：URL 格式錯誤應丟錯', () => {
  const h = makeHandler();
  assert.throws(
    () => h.parseSkillSource({ extraArgs: ['https://skills.sh/only-one'] }),
    e => e.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：name 含換行應丟錯（log injection 防護）', () => {
  const h = makeHandler();
  assert.throws(
    () => h.parseSkillSource({ extraArgs: ['evil\nname', 'org/repo'] }),
    e => e.code === ERR.INVALID_ARGS,
  );
});

// --- loadSkillsFromLock（deps-bound）-----------------------------------------

test('loadSkillsFromLock：檔案不存在回傳空物件', () => {
  const h = makeHandler();
  const result = h.loadSkillsFromLock('/nonexistent/path/skills-lock.json');
  assert.deepEqual(result, {});
});

test('loadSkillsFromLock：正常格式回傳 skills 物件', () => {
  withTmpFile(JSON.stringify({ version: 1, skills: { foo: { source: 'org/repo' } } }), (fp) => {
    const h = makeHandler();
    const result = h.loadSkillsFromLock(fp);
    assert.deepEqual(result, { foo: { source: 'org/repo' } });
  });
});

test('loadSkillsFromLock：skills 欄位缺失應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ version: 1 }), (fp) => {
    const h = makeHandler();
    assert.throws(() => h.loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

test('loadSkillsFromLock：skills 為陣列（非物件）應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ version: 1, skills: [] }), (fp) => {
    const h = makeHandler();
    assert.throws(() => h.loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});
