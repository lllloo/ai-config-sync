'use strict';

// =============================================================================
// skills.js 單元測試：對稱 toml-reader.test.js，集中驗證 skills 模組的純函式與
// deps-bound helper（不經 sync.js re-export），證明 skills.js 可獨立於 sync.js 測試。
//
// - computeSkillsDiff／sanitizeForTerminal 為模組層純函式，直接 require。
// - loadSkillsFromLock／validateSkillName／validateSkillSource／parseSkillSource
//   為 deps-bound，經 createSkillsHandler 注入 SyncError／ERR／readJson 後由回傳
//   物件取得（runCommand 只用三個對外方法，這些 helper 是 re-export／測試 seam）。
// runSkillsAdd／runSkillsRemove 的端到端行為（含寫入 skills-lock.json）由
// apply-integration.test.js 沙箱 spawn 覆蓋，name 驗證拒絕路徑由 boundary.test.js 覆蓋。
// runSkillsDiff 的建議指令輸出（兩分支對稱性）於本檔尾以攔截 console.log 直接覆蓋。
// =============================================================================

const assert = require('node:assert');
const { test } = require('node:test');

const fs = require('node:fs');
const path = require('node:path');

const { createSkillsHandler, computeSkillsDiff, sanitizeForTerminal } = require('../skills.js');
const { SyncError, ERR, readJson, EXIT_OK, EXIT_DIFF } = require('../sync.js');
const { withTmpFile, withTmpDir } = require('./helpers.js');

// 建立測試用 handler：display 相依以 no-op 注入（runSkillsDiff 輸出另由 captureSkillsDiff 覆蓋）。
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

// --- runSkillsDiff 建議指令：兩分支對資訊不全的處理須對稱 ----------------------
// 回歸：onlyInRepo 分支原本只在 skill.source 存在時才印建議，缺 source 的 skill 會
// 出現在 down 狀態行卻無任何下一步指令——與 onlyInLocal 分支（有 <source> 佔位
// fallback）不對稱，使用者看得到差異卻無從行動。

/**
 * 以 tmp 目錄為 REPO_ROOT 執行 runSkillsDiff 並攔截 console.log 輸出
 * @param {object} repoLock - 要寫入 REPO_ROOT/skills-lock.json 的內容
 * @returns {{ lines: string[], code: number }}
 */
function captureSkillsDiff(repoLock) {
  return withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'skills-lock.json'), JSON.stringify(repoLock));
    const handler = createSkillsHandler({
      REPO_ROOT: dir,
      LOCAL_SKILL_LOCK: path.join(dir, 'nonexistent-local.json'),
      EXIT_OK, EXIT_DIFF,
      SyncError, ERR, readJson,
      writeJsonSafe: () => {},
      printSectionDivider: () => {},
      printStatusLine: () => {},
      col: new Proxy({}, { get: () => (s) => s }),
    });
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try { return { lines, code: handler.runSkillsDiff() }; }
    finally { console.log = original; }
  });
}

test('runSkillsDiff：repo lock 項目缺 source 時仍輸出建議指令（以 <source> 佔位）', () => {
  const { lines, code } = captureSkillsDiff({ version: 1, skills: { orphan: {} } });
  const out = lines.join('\n');
  assert.match(out, /npx skills add <source> -g -y --skill orphan/,
    `缺 source 的 skill 仍須有下一步指令，實際輸出：\n${out}`);
  assert.equal(code, EXIT_DIFF);
});

test('runSkillsDiff：repo lock 項目有 source 時輸出實際來源', () => {
  const { lines } = captureSkillsDiff({ version: 1, skills: { foo: { source: 'org/repo' } } });
  const out = lines.join('\n');
  assert.match(out, /npx skills add org\/repo -g -y --skill foo/);
  assert.doesNotMatch(out, /<source>/, '有 source 時不應退回佔位符');
});

// --- 成員關係一律以 hasOwnProperty 判定，不用真值索引 --------------------------
// 回歸：以 `!localSkills[n]` 判成員會走原型鏈，且以真值而非存在性判定。
// validateSkillName 的 regex 允許 constructor／valueOf／__proto__ 等字面，路徑可達。

test('computeSkillsDiff：原型鏈屬性名不得被誤判為存在（constructor / toString）', () => {
  const r = computeSkillsDiff({ constructor: { source: 'org/repo' }, toString: {} }, {});
  assert.deepEqual(r.onlyInRepo.sort(), ['constructor', 'toString'],
    '本機沒有的 skill 即使名為 constructor 也須歸 onlyInRepo');
  assert.deepEqual(r.inBoth, []);
});

test('computeSkillsDiff：__proto__ 經 JSON.parse 為 own property，須正常參與比對', () => {
  const repo = JSON.parse('{"__proto__": {"source": "org/repo"}}');
  const local = JSON.parse('{"__proto__": {"source": "org/repo"}}');
  assert.deepEqual(computeSkillsDiff(repo, local).inBoth, ['__proto__']);
  assert.deepEqual(computeSkillsDiff(repo, {}).onlyInRepo, ['__proto__']);
});

test('computeSkillsDiff：值為 falsy 的登記項仍算存在', () => {
  const r = computeSkillsDiff({ nulled: {} }, JSON.parse('{"nulled": null}'));
  assert.deepEqual(r.inBoth, ['nulled'], '本機 lock 值為 null 仍是已安裝');
  assert.deepEqual(r.onlyInRepo, []);
});

// --- runSkillsDiff 狀態行須經 sanitizeForTerminal -----------------------------
// 回歸：狀態行原本把 lock 檔的 name 原樣傳給 printStatusLine，未清洗；
// ~/.agents/.skill-lock.json 由第三方 npx skills 寫入，屬未驗證來源。

/**
 * 以 tmp 目錄同時提供 repo 與本機 lock，攔截 printStatusLine 收到的 label
 * @param {object} repoLock
 * @param {object} localLock
 * @returns {string[]} printStatusLine 收到的 label 清單
 */
function captureStatusLabels(repoLock, localLock) {
  return withTmpDir((dir) => {
    const localPath = path.join(dir, 'local-lock.json');
    fs.writeFileSync(path.join(dir, 'skills-lock.json'), JSON.stringify(repoLock));
    fs.writeFileSync(localPath, JSON.stringify(localLock));
    const labels = [];
    const handler = createSkillsHandler({
      REPO_ROOT: dir,
      LOCAL_SKILL_LOCK: localPath,
      EXIT_OK, EXIT_DIFF,
      SyncError, ERR, readJson,
      writeJsonSafe: () => {},
      printSectionDivider: () => {},
      printStatusLine: (_type, label) => { labels.push(label); },
      col: new Proxy({}, { get: () => (s) => s }),
    });
    const original = console.log;
    console.log = () => {};
    try { handler.runSkillsDiff(); } finally { console.log = original; }
    return labels;
  });
}

test('runSkillsDiff：三種狀態行的 name 皆經 sanitizeForTerminal 清洗', () => {
  const labels = captureStatusLabels(
    { version: 1, skills: { 'both\x1b[2K': {}, 'repo\ronly': {} } },
    { version: 1, skills: { 'both\x1b[2K': {}, 'local\nonly': {} } },
  );
  assert.deepEqual(labels.sort(), ['both[2K', 'localonly', 'repoonly'],
    `狀態行不得含控制字元，實際：${JSON.stringify(labels)}`);
});

// --- runSkillsAdd / runSkillsRemove 的成員判定與副作用 ------------------------
// 回歸：兩者原本以 `lock.skills[name]` 真值索引判定，名為 constructor 的 skill
// 會被誤判為「已存在」（add 永遠加不進去）／「存在」（remove 空轉卻回報成功）。

/**
 * 在 tmp REPO_ROOT 執行 add/remove，回傳輸出、exit code 與實際落盤的 lock
 * @param {'add'|'remove'} kind
 * @param {object} repoLock - 初始 skills-lock.json 內容
 * @param {string[]} extraArgs
 * @returns {{ out: string, code: number, written: object|null }}
 */
function runSkillsMutation(kind, repoLock, extraArgs) {
  return withTmpDir((dir) => {
    fs.writeFileSync(path.join(dir, 'skills-lock.json'), JSON.stringify(repoLock));
    let written = null;
    const handler = createSkillsHandler({
      REPO_ROOT: dir,
      LOCAL_SKILL_LOCK: path.join(dir, 'nonexistent-local.json'),
      EXIT_OK, EXIT_DIFF,
      SyncError, ERR, readJson,
      writeJsonSafe: (_fp, data) => { written = data; },
      printSectionDivider: () => {},
      printStatusLine: () => {},
      col: new Proxy({}, { get: () => (s) => s }),
    });
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
      const run = kind === 'add' ? handler.runSkillsAdd : handler.runSkillsRemove;
      const code = run({ extraArgs });
      return { out: lines.join('\n'), code, written };
    } finally { console.log = original; }
  });
}

test('runSkillsAdd：名為 constructor 的 skill 不被原型鏈誤判為已存在', () => {
  const { out, written } = runSkillsMutation('add', { version: 1, skills: {} }, ['constructor', 'org/repo']);
  assert.match(out, /已加入 constructor/, `應實際加入，實際輸出：\n${out}`);
  assert.deepEqual(written.skills.constructor, { source: 'org/repo', sourceType: 'github' });
});

test('runSkillsAdd：已存在時輸出經清洗的 source、不覆寫', () => {
  const { out, written } = runSkillsMutation(
    'add',
    { version: 1, skills: { foo: { source: 'org/re\x1b[2Kpo' } } },
    ['foo', 'other/repo'],
  );
  assert.match(out, /source: org\/re\[2Kpo/, `重複提示的 source 須清洗，實際：\n${out}`);
  assert.equal(written, null, '已存在時不得寫檔');
});

test('runSkillsAdd：已存在但缺 source 時提示不印 undefined', () => {
  const { out } = runSkillsMutation('add', { version: 1, skills: { foo: {} } }, ['foo', 'org/repo']);
  assert.doesNotMatch(out, /undefined/, `缺 source 不應 echo undefined，實際：\n${out}`);
});

test('runSkillsRemove：名為 constructor 但未登記時視為不存在、不寫檔', () => {
  const { out, code, written } = runSkillsMutation('remove', { version: 1, skills: {} }, ['constructor']);
  assert.match(out, /constructor 不在 skills-lock\.json 中/, `實際輸出：\n${out}`);
  assert.equal(code, EXIT_OK);
  assert.equal(written, null, '不存在時不得重寫 skills-lock.json');
});

test('runSkillsRemove：已登記的 skill 正常移除', () => {
  const { out, written } = runSkillsMutation(
    'remove',
    { version: 1, skills: { foo: { source: 'org/repo' }, bar: { source: 'org/repo' } } },
    ['foo'],
  );
  assert.match(out, /已移除 foo/, `實際輸出：\n${out}`);
  assert.deepEqual(Object.keys(written.skills), ['bar']);
});
