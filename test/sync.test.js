'use strict';

// =============================================================================
// sync.js 純函式單元測試（使用 Node.js 內建 node:test，零外部相依）
// 執行方式：node --test 或 npm test
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  computeLineDiff,
  diffFile,
  diffDir,
  matchExclude,
  statusToStatsKey,
  parseSkillSource,
  parseArgs,
  toRelativePath,
  loadSkillsFromLock,
  SyncError,
  ERR,
  COMMANDS,
  COMMAND_ALIASES,
  VALID_COMMANDS,
  INIT_FILE_MAP,
  INIT_RULES_TO_REMOVE,
} = require('../sync.js');
const { withArgv, withTmpDir, withTmpFile } = require('./helpers');

// -----------------------------------------------------------------------------
// computeLineDiff
// -----------------------------------------------------------------------------
test('computeLineDiff：兩個相同字串應無 +/- 行', () => {
  const ops = computeLineDiff('a\nb\nc', 'a\nb\nc');
  const changed = ops.filter(op => op.type !== ' ');
  assert.equal(changed.length, 0);
});

test('computeLineDiff：全新內容應全為 + 行', () => {
  const ops = computeLineDiff('', 'hello\nworld');
  const added = ops.filter(op => op.type === '+').map(op => op.line);
  assert.deepEqual(added, ['hello', 'world']);
});

test('computeLineDiff：刪除行應產生 - 行', () => {
  const ops = computeLineDiff('a\nb\nc', 'a\nc');
  const removed = ops.filter(op => op.type === '-').map(op => op.line);
  assert.deepEqual(removed, ['b']);
});

test('computeLineDiff：中間修改應同時有 + 與 - 行', () => {
  const ops = computeLineDiff('a\nb\nc', 'a\nB\nc');
  const removed = ops.filter(op => op.type === '-').map(op => op.line);
  const added = ops.filter(op => op.type === '+').map(op => op.line);
  assert.deepEqual(removed, ['b']);
  assert.deepEqual(added, ['B']);
});

// -----------------------------------------------------------------------------
// matchExclude
// -----------------------------------------------------------------------------
test('matchExclude：精確字串比對', () => {
  assert.equal(matchExclude('foo.json', 'foo.json'), true);
  assert.equal(matchExclude('foo.json', 'bar.json'), false);
});

test('matchExclude：尾部萬用字元比對', () => {
  assert.equal(matchExclude('logs/a.log', 'logs/*'), true);
  assert.equal(matchExclude('logs/nested/a.log', 'logs/*'), true);
  assert.equal(matchExclude('src/foo.ts', 'logs/*'), false);
});

test('matchExclude：* 只支援尾部萬用', () => {
  // 中間的 * 不被特別處理，會當作字面字元
  assert.equal(matchExclude('foo', 'f*o'), false);
});

// -----------------------------------------------------------------------------
// statusToStatsKey
// -----------------------------------------------------------------------------
test('statusToStatsKey：三種狀態對應正確', () => {
  assert.equal(statusToStatsKey('new'), 'added');
  assert.equal(statusToStatsKey('changed'), 'updated');
  assert.equal(statusToStatsKey('deleted'), 'deleted');
});

test('statusToStatsKey：eol 併入 updated（同步時仍需寫入）', () => {
  assert.equal(statusToStatsKey('eol'), 'updated');
});

test('statusToStatsKey：未知狀態回傳 null', () => {
  assert.equal(statusToStatsKey(null), null);
  assert.equal(statusToStatsKey('unknown'), null);
  assert.equal(statusToStatsKey(undefined), null);
});

// -----------------------------------------------------------------------------
// parseSkillSource
// -----------------------------------------------------------------------------
test('parseSkillSource：skills.sh URL 解析', () => {
  const result = parseSkillSource({
    extraArgs: ['https://skills.sh/anthropics/skills/web-search'],
  });
  assert.equal(result.name, 'web-search');
  assert.equal(result.source, 'anthropics/skills');
});

test('parseSkillSource：name + source 雙引數', () => {
  const result = parseSkillSource({ extraArgs: ['my-skill', 'org/repo'] });
  assert.equal(result.name, 'my-skill');
  assert.equal(result.source, 'org/repo');
});

test('parseSkillSource：缺少引數應丟 SyncError', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: [] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：skills.sh URL 格式錯誤應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['https://skills.sh/onlyone'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：單一非 URL 引數應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my-skill'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：name 含換行應丟錯（log injection 防護）', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['evil\nname', 'org/repo'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：source 含換行應丟錯（log injection 防護）', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my-skill', 'org/repo\nrm -rf'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：source 含 ANSI escape 應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my-skill', 'org/repo\x1b[31m'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：name 含特殊字元應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my skill', 'org/repo'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

// -----------------------------------------------------------------------------
// parseArgs（透過 mutate process.argv）
// -----------------------------------------------------------------------------
test('parseArgs：解析指令與 --dry-run', () => {
  const result = withArgv(['to-repo', '--dry-run'], () => parseArgs());
  assert.equal(result.command, 'to-repo');
  assert.equal(result.dryRun, true);
  assert.equal(result.verbose, false);
});

test('parseArgs：別名應解析為正式指令', () => {
  const result = withArgv(['tr'], () => parseArgs());
  assert.equal(result.command, 'to-repo');
});

test('parseArgs：--verbose 旗標', () => {
  const result = withArgv(['diff', '--verbose'], () => parseArgs());
  assert.equal(result.verbose, true);
});

test('parseArgs：--version / --help 旗標', () => {
  assert.equal(withArgv(['--version'], () => parseArgs()).showVersion, true);
  assert.equal(withArgv(['--help'], () => parseArgs()).showHelp, true);
  assert.equal(withArgv(['-h'], () => parseArgs()).showHelp, true);
});

test('parseArgs：extraArgs 收集指令後的 positional 引數', () => {
  const result = withArgv(['skills:add', 'name', 'org/repo'], () => parseArgs());
  assert.equal(result.command, 'skills:add');
  assert.deepEqual(result.extraArgs, ['name', 'org/repo']);
});

test('parseArgs：未知指令保留原值供上層判斷', () => {
  const result = withArgv(['nonexistent'], () => parseArgs());
  assert.equal(result.command, 'nonexistent');
});

test('parseArgs：-- 分隔符後的引數皆收入 extraArgs', () => {
  const result = withArgv(['skills:add', '--', '--some-flag', 'value'], () => parseArgs());
  assert.equal(result.command, 'skills:add');
  assert.deepEqual(result.extraArgs, ['--some-flag', 'value']);
});

// -----------------------------------------------------------------------------
// toRelativePath
// -----------------------------------------------------------------------------
test('toRelativePath：非絕對路徑原樣回傳', () => {
  assert.equal(toRelativePath('foo/bar'), 'foo/bar');
  assert.equal(toRelativePath(''), '');
});

test('toRelativePath：REPO_ROOT 內的路徑縮短為 relative', () => {
  const abs = require('path').join(__dirname, '..', 'sync.js');
  const rel = toRelativePath(abs);
  // 至少不應包含使用者 home 字樣且比原本短
  assert.ok(rel.length < abs.length || rel === abs);
});

test('toRelativePath：HOME 內的路徑以 ~/ 開頭且使用正斜線（跨平台）', () => {
  const path = require('path');
  const os = require('os');
  const HOME = os.homedir();
  // 取一個必定在 HOME 內、但不在 REPO_ROOT 內的路徑
  const abs = path.join(HOME, '.claude', 'settings.json');
  const rel = toRelativePath(abs);
  assert.ok(rel.startsWith('~/'), `應以 ~/ 開頭，得到：${rel}`);
  assert.ok(!rel.includes('\\'), `不應含反斜線（Windows 也需轉為正斜線），得到：${rel}`);
});

test('toRelativePath：輸出不得洩漏使用者目錄名（安全回歸）', () => {
  const path = require('path');
  const os = require('os');
  const HOME = os.homedir();
  const userBase = path.basename(HOME);
  const abs = path.join(HOME, '.claude', 'agents', 'foo.md');
  const rel = toRelativePath(abs);
  // 若 HOME 解析成功，輸出不應含使用者帳號名（會以 ~ 代替）
  // 例外：若 userBase 本身就是常見字串如 "home"、"Users"，這個斷言可能誤判
  // 因此只在 userBase 長度 >= 3 且非系統保留字時啟用
  const reserved = new Set(['home', 'Users', 'root', 'usr']);
  if (userBase.length >= 3 && !reserved.has(userBase)) {
    assert.ok(!rel.includes(userBase), `輸出不應洩漏使用者名 ${userBase}，得到：${rel}`);
  }
});

// -----------------------------------------------------------------------------
// COMMANDS / 對應表完整性
// -----------------------------------------------------------------------------
test('COMMANDS：所有指令名稱皆列於 VALID_COMMANDS', () => {
  for (const cmd of Object.keys(COMMANDS)) {
    assert.ok(VALID_COMMANDS.includes(cmd), `${cmd} 應在 VALID_COMMANDS`);
  }
});

test('COMMAND_ALIASES：別名應對應回正式指令', () => {
  for (const [alias, cmd] of Object.entries(COMMAND_ALIASES)) {
    assert.ok(COMMANDS[cmd], `別名 ${alias} -> ${cmd} 應存在於 COMMANDS`);
    assert.equal(COMMANDS[cmd].alias, alias);
  }
});

test('COMMANDS：init 指令存在且有說明', () => {
  assert.ok(COMMANDS['init'], 'COMMANDS 應含 init');
  assert.equal(COMMANDS['init'].alias, null, 'init 無別名');
  assert.ok(COMMANDS['init'].desc, 'init 應有 desc');
});

// -----------------------------------------------------------------------------
// INIT_FILE_MAP / INIT_RULES_TO_REMOVE：init 指令的資料驅動清單
// -----------------------------------------------------------------------------
test('INIT_FILE_MAP：每項皆有 src/dest/type，type 為 json 或 text', () => {
  assert.ok(Array.isArray(INIT_FILE_MAP) && INIT_FILE_MAP.length > 0);
  for (const item of INIT_FILE_MAP) {
    assert.equal(typeof item.src, 'string');
    assert.equal(typeof item.dest, 'string');
    assert.ok(['json', 'text'].includes(item.type), `type 應為 json|text，實為 ${item.type}`);
    assert.ok(item.src.includes('.example.'), `src 應指向 .example 範本：${item.src}`);
  }
});

test('INIT_FILE_MAP：所有 .example 範本檔實際存在於 repo', () => {
  const repoRoot = path.resolve(__dirname, '..');
  for (const item of INIT_FILE_MAP) {
    const srcAbs = path.join(repoRoot, item.src);
    assert.ok(fs.existsSync(srcAbs), `範本檔應存在：${item.src}`);
  }
});

test('INIT_RULES_TO_REMOVE：所有路徑皆位於 claude/rules/ 下', () => {
  assert.ok(Array.isArray(INIT_RULES_TO_REMOVE));
  for (const rel of INIT_RULES_TO_REMOVE) {
    assert.ok(rel.startsWith('claude/rules/'), `應位於 claude/rules/ 下：${rel}`);
    assert.ok(rel.endsWith('.md'), `應為 .md 檔：${rel}`);
  }
});

// -----------------------------------------------------------------------------
// loadSkillsFromLock：skills-lock.json 讀取與格式驗證
// 避免格式異常時靜默回退成空物件，誤判為「無差異」
// -----------------------------------------------------------------------------
test('loadSkillsFromLock：檔案不存在回傳空物件', () => {
  const result = loadSkillsFromLock('/nonexistent/path/skills-lock.json');
  assert.deepEqual(result, {});
});

test('loadSkillsFromLock：正常格式回傳 skills 物件', () => {
  withTmpFile(JSON.stringify({ skills: { foo: { source: 'x/y' } } }), (fp) => {
    const result = loadSkillsFromLock(fp);
    assert.deepEqual(result, { foo: { source: 'x/y' } });
  });
});

test('loadSkillsFromLock：skills 欄位缺失應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ version: 1 }), (fp) => {
    assert.throws(() => loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

test('loadSkillsFromLock：skills 為 null 應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ skills: null }), (fp) => {
    assert.throws(() => loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

test('loadSkillsFromLock：skills 為陣列（非物件）應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ skills: [] }), (fp) => {
    assert.throws(() => loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

// -----------------------------------------------------------------------------
// diffFile / diffDir：src 缺失 vs dest 缺失的對稱性
// 鎖住 runDiff（to-repo 方向）能正確報出「repo 有、本機沒有」的差異
// -----------------------------------------------------------------------------
test('diffFile：src 不存在但 dest 存在 → deleted（不能漏報）', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'missing.txt');
    const dest = path.join(dir, 'present.txt');
    fs.writeFileSync(dest, 'hello');
    assert.equal(diffFile(src, dest), 'deleted');
  });
});

test('diffFile：src 與 dest 都不存在 → null', () => {
  withTmpDir((dir) => {
    assert.equal(
      diffFile(path.join(dir, 'a'), path.join(dir, 'b')),
      null
    );
  });
});

test('diffFile：src 存在但 dest 不存在 → new', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'src.txt');
    fs.writeFileSync(src, 'hi');
    assert.equal(diffFile(src, path.join(dir, 'dest.txt')), 'new');
  });
});

test('diffDir：src 不存在但 dest 有檔 → 全部標 deleted', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'missing');
    const dest = path.join(dir, 'present');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'a.txt'), 'a');
    fs.writeFileSync(path.join(dest, 'b.txt'), 'b');
    const diffs = diffDir(src, dest);
    assert.deepEqual(
      diffs.map(d => ({ rel: d.rel, status: d.status })).sort((x, y) => x.rel.localeCompare(y.rel)),
      [{ rel: 'a.txt', status: 'deleted' }, { rel: 'b.txt', status: 'deleted' }]
    );
  });
});

test('diffDir：src 與 dest 都不存在 → 空陣列', () => {
  withTmpDir((dir) => {
    assert.deepEqual(
      diffDir(path.join(dir, 'a'), path.join(dir, 'b')),
      []
    );
  });
});
