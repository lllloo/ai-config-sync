'use strict';

// =============================================================================
// 邊界條件與進階覆蓋測試（node:test，零外部相依）
// 涵蓋 spec.md 建議的高/中/低優先新增測試項目
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchExclude,
  parseArgs,
  assertNoSwallowedNpmFlags,
  parseSkillSource,
  toRelativePath,
  maskHome,
  isEolOnlyDiff,
  isPathInside,
  getFiles,
  mirrorDir,
  copyFile,
  ensureSymlink,
  applySyncItems,
  readFileSafe,
  readJson,
  writeFileSafe,
  toSyncFsError,
  askConfirm,
  runSkillsRemove,
  validateSkillName,
  SyncError,
  ERR,
  EXIT_OK,
  EXIT_DIFF,
  EXIT_ERROR,
  COMMANDS,
  COMMAND_ALIASES,
  formatError,
} = require('../sync.js');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { withArgv, withTmpDir, noColorEnv } = require('./helpers');

// =============================================================================
// 安全：askConfirm 在非互動環境的行為（避免 to-local 卡死或靜默 no-op）
// =============================================================================

test('askConfirm：autoYes 為 true 直接同意，不觸碰 stdin', async () => {
  assert.equal(await askConfirm('問？', true), true);
});

// 回歸：互動 TTY 下輸入 y 必須回 true（rl.close() 同步觸發 close 事件的競態，
// 曾使 resolve(false) 搶在答案前生效，導致確認後仍顯示「已取消」）
test('askConfirm：互動 TTY 輸入 y 回 true，close 事件不搶先', async () => {
  const { PassThrough } = require('stream');
  const fakeIn = new PassThrough();
  fakeIn.isTTY = true;
  const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { value: fakeIn, configurable: true });
  try {
    const p = askConfirm('問？', false);
    fakeIn.write('y\n');
    assert.equal(await p, true);
  } finally {
    Object.defineProperty(process, 'stdin', descriptor);
  }
});

test('askConfirm：非 TTY 環境（無 autoYes）拋 INVALID_ARGS 而非卡住', async () => {
  // 顯式覆寫 isTTY 模擬 CI / pipe，避免在互動式終端跑測試時建 readline 卡死
  const original = process.stdin.isTTY;
  process.stdin.isTTY = false;
  try {
    await assert.rejects(
      askConfirm('問？', false),
      (e) => e instanceof SyncError && e.code === ERR.INVALID_ARGS,
    );
  } finally {
    process.stdin.isTTY = original;
  }
});

// =============================================================================
// 安全：readJson 解析失敗不得把檔案內容片段（可能含密鑰）帶進錯誤
// =============================================================================

test('readJson：JSON 解析失敗的錯誤不洩漏內容片段（密鑰）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    // 故意損壞（缺收尾），且在出錯位置附近埋一個假密鑰
    fs.writeFileSync(fp, '{ "apiKey": "sk-ant-SECRET12345", "x": ');
    let err;
    try { readJson(fp); } catch (e) { err = e; }
    assert.ok(err instanceof SyncError, '應拋 SyncError');
    assert.equal(err.code, ERR.JSON_PARSE);
    // message 與 context 任何字串化結果都不得出現密鑰
    const blob = err.message + JSON.stringify(err.context || {});
    assert.ok(!blob.includes('sk-ant-SECRET12345'), '錯誤不得含密鑰片段');
    assert.ok(!('parseError' in (err.context || {})), 'context 不得保留 parseError');
  });
});

// =============================================================================
// 高優先：SyncError 建構
// =============================================================================

test('SyncError：具有正確的 name、code、context 屬性', () => {
  const err = new SyncError('test msg', ERR.FILE_NOT_FOUND, { path: '/tmp/x' });
  assert.equal(err.name, 'SyncError');
  assert.equal(err.code, ERR.FILE_NOT_FOUND);
  assert.deepEqual(err.context, { path: '/tmp/x' });
  assert.equal(err.message, 'test msg');
  assert.ok(err instanceof Error, 'SyncError 應為 Error 子類');
});

test('SyncError：context 預設為空物件', () => {
  const err = new SyncError('msg', ERR.IO_ERROR);
  assert.deepEqual(err.context, {});
});

// -----------------------------------------------------------------------------
// toSyncFsError：fs 錯誤碼 → SyncError 分類映射
// EACCES/EPERM → PERMISSION，其餘 → IO_ERROR；訊息不嵌入 Node 原生 e.message、路徑經遮罩
// -----------------------------------------------------------------------------
test('toSyncFsError：EACCES → PERMISSION', () => {
  const err = toSyncFsError({ code: 'EACCES' }, '/tmp/x', '寫入');
  assert.ok(err instanceof SyncError, '應為 SyncError');
  assert.equal(err.code, ERR.PERMISSION, 'EACCES 須映射為 PERMISSION');
  assert.match(err.message, /權限不足/);
});

test('toSyncFsError：EPERM → PERMISSION', () => {
  const err = toSyncFsError({ code: 'EPERM' }, '/tmp/x', '重新命名');
  assert.equal(err.code, ERR.PERMISSION, 'EPERM 須映射為 PERMISSION');
});

test('toSyncFsError：其餘錯誤碼（ENOSPC/EXDEV 等）→ IO_ERROR，且訊息帶錯誤碼', () => {
  const err = toSyncFsError({ code: 'ENOSPC' }, '/tmp/x', '寫入');
  assert.equal(err.code, ERR.IO_ERROR, '非權限類須映射為 IO_ERROR');
  assert.match(err.message, /ENOSPC/, '訊息應帶上 fs 錯誤碼');
});

test('toSyncFsError：訊息不嵌入 Node 原生 e.message，HOME 路徑經遮罩', () => {
  const os = require('node:os');
  const secretPath = path.join(os.homedir(), '.claude', 'settings.json');
  // e.message 含絕對路徑，不得滲入 SyncError 訊息
  const err = toSyncFsError({ code: 'EACCES', message: `EACCES: ${secretPath}` }, secretPath, '讀取');
  assert.ok(!err.message.includes(os.homedir()), '訊息不得洩漏 HOME 絕對路徑');
  assert.ok(!err.message.includes('EACCES: '), '不得嵌入 Node 原生 e.message');
});

// =============================================================================
// 高優先：formatError 處理
// =============================================================================

test('formatError：SyncError 不拋錯，輸出到 stderr', () => {
  const err = new SyncError('boom', ERR.GIT_ERROR, { path: '/tmp' });
  // formatError 回傳 void，不應拋出
  assert.doesNotThrow(() => formatError(err));
});

test('formatError：非 SyncError 走 fallback 不拋錯', () => {
  const err = new TypeError('unexpected');
  assert.doesNotThrow(() => formatError(err));
});

// =============================================================================
// 中優先：matchExclude 邊界
// =============================================================================

test('matchExclude：空字串 pattern 不匹配任何內容', () => {
  assert.equal(matchExclude('foo.json', ''), false);
  assert.equal(matchExclude('', ''), true);  // 空字串精確匹配空字串
});

test('matchExclude：空字串 rel 只匹配空 pattern', () => {
  assert.equal(matchExclude('', 'foo'), false);
  assert.equal(matchExclude('', '*'), true);  // '*' 尾部萬用匹配空 prefix
});

// =============================================================================
// 中優先：parseArgs 邊界
// =============================================================================

test('parseArgs：無引數時 command 為 null', () => {
  const result = withArgv([], () => parseArgs());
  assert.equal(result.command, null);
  assert.equal(result.dryRun, false);
  assert.equal(result.verbose, false);
});

test('parseArgs：僅 -- 時 command 為 null，extraArgs 為空', () => {
  const result = withArgv(['--'], () => parseArgs());
  assert.equal(result.command, null);
  assert.deepEqual(result.extraArgs, []);
});

test('parseArgs：所有別名皆可正確解析', () => {
  for (const [alias, expected] of Object.entries(COMMAND_ALIASES)) {
    const result = withArgv([alias], () => parseArgs());
    assert.equal(result.command, expected,
      `別名 '${alias}' 應解析為 '${expected}'`);
  }
});

// =============================================================================
// npm 吞旗標防護：`npm run to-repo --dry-run` 的旗標被 npm 攔截、argv 收不到，
// 只留下 npm_config_* 環境變數——偵測到即 fail fast，不得靜默以真寫入模式執行
// =============================================================================

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('assertNoSwallowedNpmFlags：npm_config_dry_run=true 拋 INVALID_ARGS', () => {
  withEnv({ npm_config_dry_run: 'true' }, () => {
    assert.throws(() => assertNoSwallowedNpmFlags(), (e) => {
      assert.ok(e instanceof SyncError);
      assert.equal(e.code, ERR.INVALID_ARGS);
      assert.ok(e.message.includes('--dry-run'), '訊息應點名被吞的旗標');
      assert.ok(e.message.includes('--'), '訊息應教學 -- 分隔用法');
      return true;
    });
  });
});

test('assertNoSwallowedNpmFlags：npm_config_yes=true 拋 INVALID_ARGS', () => {
  withEnv({ npm_config_yes: 'true' }, () => {
    assert.throws(() => assertNoSwallowedNpmFlags(), (e) => {
      assert.ok(e instanceof SyncError && e.code === ERR.INVALID_ARGS);
      assert.ok(e.message.includes('--yes'));
      return true;
    });
  });
});

test('assertNoSwallowedNpmFlags：無 npm_config_* 旗標時不拋錯', () => {
  withEnv({ npm_config_dry_run: undefined, npm_config_yes: undefined }, () => {
    assert.doesNotThrow(() => assertNoSwallowedNpmFlags());
  });
});

// =============================================================================
// 中優先：toRelativePath 邊界
// =============================================================================

test('toRelativePath：HOME 外的絕對路徑處理', () => {
  // 給一個不太可能在 HOME 或 REPO_ROOT 內的路徑
  const weirdPath = '/nonexistent/very/deep/path/file.txt';
  const result = toRelativePath(weirdPath);
  // 在 Windows 上非絕對路徑會原樣回傳；在 Unix 上可能保留或縮短
  assert.equal(typeof result, 'string');
  // 不應為空
  assert.ok(result.length > 0);
});

// =============================================================================
// 中優先：loadStrippedSettings JSON 格式錯誤
// =============================================================================

test('loadStrippedSettings：JSON 格式錯誤時拋出 SyncError', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { loadStrippedSettings } = require('../sync.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  try {
    const fp = path.join(dir, 'bad.json');
    fs.writeFileSync(fp, '{ invalid json !!!');
    assert.throws(
      () => loadStrippedSettings(fp),
      (err) => err instanceof SyncError && err.code === ERR.JSON_PARSE,
      'JSON 格式錯誤應丟 SyncError(JSON_PARSE)',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// 低優先：parseSkillSource URL 變體
// =============================================================================

test('parseSkillSource：URL 有尾部斜線仍可解析', () => {
  const result = parseSkillSource({
    extraArgs: ['https://skills.sh/org/repo/skill/'],
  });
  assert.equal(result.name, 'skill');
  assert.equal(result.source, 'org/repo');
});

test('parseSkillSource：URL 有多餘路徑段', () => {
  // https://skills.sh/org/repo/skill/extra — 4+ segments after host
  // 預期只取前三段
  const result = parseSkillSource({
    extraArgs: ['https://skills.sh/org/repo/skill/extra'],
  });
  assert.equal(result.name, 'skill');
  assert.equal(result.source, 'org/repo');
});

// =============================================================================
// Exit code 常數驗證
// =============================================================================

test('Exit code 常數語義正確', () => {
  assert.equal(EXIT_OK, 0);
  assert.equal(EXIT_DIFF, 1);
  assert.equal(EXIT_ERROR, 2);
});

// =============================================================================
// ERR 常數完整性
// =============================================================================

test('ERR 常數涵蓋所有必要錯誤代碼', () => {
  const required = [
    'FILE_NOT_FOUND', 'JSON_PARSE', 'GIT_ERROR',
    'PERMISSION', 'INVALID_ARGS', 'IO_ERROR',
  ];
  for (const code of required) {
    assert.ok(ERR[code], `ERR 應包含 ${code}`);
    assert.equal(ERR[code], code, `ERR.${code} 值應為 '${code}'`);
  }
});

test('COMMAND_ALIASES 值皆指向 COMMANDS 中存在的 key', () => {
  for (const [alias, cmd] of Object.entries(COMMAND_ALIASES)) {
    assert.ok(cmd in COMMANDS,
      `別名 ${alias} 指向 ${cmd}，但 COMMANDS 中不存在`);
  }
});

test('DEVICE_SETTINGS_KEYS 含裝置欄位 model／tui（黑名單正面保證）', () => {
  const { DEVICE_SETTINGS_KEYS } = require('../sync.js');
  assert.ok(DEVICE_SETTINGS_KEYS.includes('model'));
  assert.ok(DEVICE_SETTINGS_KEYS.includes('tui'));
});

// =============================================================================
// 高優先：isEolOnlyDiff（四條 diff 路徑共用的核心判斷，先前零覆蓋）
// 語義：normalize = CRLF→LF + 去尾部換行；相等即視為「僅換行差異」
// =============================================================================

test('isEolOnlyDiff：LF vs CRLF 同內容 → true', () => {
  assert.equal(isEolOnlyDiff(Buffer.from('a\nb\n'), Buffer.from('a\r\nb\r\n')), true);
});

test('isEolOnlyDiff：有無尾部換行差異 → true', () => {
  assert.equal(isEolOnlyDiff(Buffer.from('hello'), Buffer.from('hello\n')), true);
});

test('isEolOnlyDiff：尾部多個換行視為等價 → true', () => {
  assert.equal(isEolOnlyDiff(Buffer.from('x\n'), Buffer.from('x\n\n\n')), true);
});

test('isEolOnlyDiff：真實內容差異（一字不同）→ false', () => {
  assert.equal(isEolOnlyDiff(Buffer.from('foo\n'), Buffer.from('bar\n')), false);
});

test('isEolOnlyDiff：內容差異即使換行也不同 → false（不可被換行正規化吞掉）', () => {
  assert.equal(isEolOnlyDiff(Buffer.from('a\nb'), Buffer.from('a\r\nc\r\n')), false);
});

test('isEolOnlyDiff：行中（非尾部）插入空行屬內容差異 → false', () => {
  // normalize 只移除「尾部」換行，中間空行不會被吸收
  assert.equal(isEolOnlyDiff(Buffer.from('a\nb'), Buffer.from('a\n\nb')), false);
});

// =============================================================================
// 高優先：isPathInside（symlink 逃逸防線，先前零覆蓋）
// 以 path.join 建構路徑以跨平台正確處理 path.sep
// =============================================================================

test('isPathInside：target 等於 root → true', () => {
  const root = path.join('base', 'repo');
  assert.equal(isPathInside(root, root), true);
});

test('isPathInside：target 是 root 子路徑 → true', () => {
  const root = path.join('base', 'repo');
  assert.equal(isPathInside(path.join(root, 'a', 'b.txt'), root), true);
});

test('isPathInside：target 在 root 外（sibling）→ false', () => {
  const base = 'base';
  assert.equal(isPathInside(path.join(base, 'other'), path.join(base, 'repo')), false);
});

test('isPathInside：前綴陷阱 foo vs foobar → false（防 startsWith 誤判）', () => {
  const base = 'base';
  // foobar 以 foo 為字串前綴，但不在 foo 目錄內；:519 補 path.sep 正是為此
  assert.equal(isPathInside(path.join(base, 'foobar'), path.join(base, 'foo')), false);
});

test('isPathInside：root 帶尾部分隔符仍正確判定子路徑 → true', () => {
  const root = path.join('base', 'repo');
  assert.equal(isPathInside(path.join(root, 'x.txt'), root + path.sep), true);
});

// =============================================================================
// 高優先：mirrorDir 的刪除路徑（破壞性操作，先前零覆蓋）
// =============================================================================

function seedFile(dir, rel, content) {
  const fp = path.join(dir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
}

test('mirrorDir：dest 多餘檔被刪除，changed 標記 deleted', () => {
  withTmpDir((base) => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    seedFile(src, 'a.txt', 'A');
    seedFile(dest, 'a.txt', 'A');
    seedFile(dest, 'b.txt', 'STALE'); // src 沒有 → 應被刪

    const changed = mirrorDir(src, dest);

    assert.equal(fs.existsSync(path.join(dest, 'b.txt')), false, 'b.txt 應被刪除');
    assert.equal(fs.existsSync(path.join(dest, 'a.txt')), true, 'a.txt 應保留');
    assert.ok(
      changed.some(c => c.rel === 'b.txt' && c.action === 'deleted'),
      'changed 應含 {rel:b.txt, action:deleted}'
    );
  });
});

test('mirrorDir：dry-run 報告 deleted 但不實際刪檔', () => {
  withTmpDir((base) => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    seedFile(src, 'a.txt', 'A');
    seedFile(dest, 'a.txt', 'A');
    seedFile(dest, 'b.txt', 'STALE');

    const changed = mirrorDir(src, dest, [], true); // dryRun=true

    assert.equal(fs.existsSync(path.join(dest, 'b.txt')), true, 'dry-run 不得實刪');
    assert.ok(changed.some(c => c.rel === 'b.txt' && c.action === 'deleted'));
  });
});

test('mirrorDir：excludePatterns 命中的 dest 檔不被刪除', () => {
  withTmpDir((base) => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    seedFile(src, 'a.txt', 'A');
    seedFile(dest, 'a.txt', 'A');
    seedFile(dest, 'keep.log', 'KEEP'); // src 無，但被 exclude → 不刪

    const changed = mirrorDir(src, dest, ['keep.log']);

    assert.equal(fs.existsSync(path.join(dest, 'keep.log')), true, 'exclude 檔不應被刪');
    assert.ok(!changed.some(c => c.rel === 'keep.log'), 'exclude 檔不應出現在 changed');
  });
});

test('mirrorDir：src 新檔寫入 dest，changed 標記 added', () => {
  withTmpDir((base) => {
    const src = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    seedFile(src, 'nested/new.txt', 'NEW');

    const changed = mirrorDir(src, dest);

    assert.equal(fs.readFileSync(path.join(dest, 'nested', 'new.txt'), 'utf8'), 'NEW');
    assert.ok(changed.some(c => c.rel === 'nested/new.txt' && c.action === 'added'));
  });
});

// =============================================================================
// readFileSafe：fs 例外須包成 SyncError（不得讓裸 Error 穿透 formatError）
// =============================================================================

test('readFileSafe：讀取存在檔 → 回傳內容（指定 encoding 回字串）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'f.txt');
    fs.writeFileSync(fp, 'DATA');
    assert.equal(readFileSafe(fp, '讀取', 'utf8'), 'DATA');
    assert.ok(Buffer.isBuffer(readFileSafe(fp, '讀取')), '省略 encoding 應回 Buffer');
  });
});

test('readFileSafe：讀取不存在檔 → 拋 SyncError（非裸 Error）含 path context', () => {
  withTmpDir((dir) => {
    const missing = path.join(dir, 'nope.txt');
    assert.throws(
      () => readFileSafe(missing, '讀取設定'),
      (err) => {
        assert.ok(err instanceof SyncError, '須為 SyncError 而非裸 Error');
        assert.equal(err.context.path, missing, 'context 須帶 path 供脫敏輸出');
        assert.ok(err.message.includes('讀取設定'), '訊息須含操作脈絡');
        return true;
      }
    );
  });
});

// =============================================================================
// writeFileSafe：原子寫入（tmp+rename），成功後不留暫存檔、自動建中間目錄
// =============================================================================

test('writeFileSafe：寫入 string/Buffer 內容正確，且自動建立中間目錄', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'a', 'b', 'out.txt');
    writeFileSafe(fp, 'STR', '寫入');
    assert.equal(fs.readFileSync(fp, 'utf8'), 'STR');
    writeFileSafe(fp, Buffer.from('BUF'), '寫入');
    assert.equal(fs.readFileSync(fp, 'utf8'), 'BUF', '應覆蓋為 Buffer 內容');
  });
});

test('writeFileSafe：成功寫入後不殘留 .tmp 暫存檔', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'out.txt');
    writeFileSafe(fp, 'DATA', '寫入');
    const leftover = fs.readdirSync(dir).filter(n => n.includes('.tmp.'));
    assert.deepEqual(leftover, [], '不應殘留 .tmp.<pid> 暫存檔');
  });
});

test('readFileSafe：HOME 下檔案的錯誤訊息經遮罩，不洩漏絕對 HOME 路徑', () => {
  const home = require('node:os').homedir();
  const missing = path.join(home, '__ai_config_sync_nonexist__', 'x.txt');
  assert.throws(
    () => readFileSafe(missing, '讀取'),
    (err) => {
      assert.ok(err instanceof SyncError);
      // message 須走 toRelativePath：不得含完整 HOME 絕對路徑，須以 ~ 遮罩
      assert.ok(!err.message.includes(home), 'message 不應含完整 HOME 絕對路徑');
      assert.ok(err.message.includes('~/'), 'message 應以 ~ 遮罩 HOME');
      assert.equal(err.context.path, missing, 'context.path 保留原值供內部使用');
      return true;
    }
  );
});

// =============================================================================
// validateSkillName / runSkillsRemove：輸入驗證防 terminal log injection
// =============================================================================

test('validateSkillName：含 ANSI escape / 換行的 name 拋 INVALID_ARGS，合法 name 通過', () => {
  assert.throws(() => validateSkillName('\x1b[2Jevil'), e => e instanceof SyncError && e.code === ERR.INVALID_ARGS);
  assert.throws(() => validateSkillName('a\nb'), e => e.code === ERR.INVALID_ARGS);
  assert.doesNotThrow(() => validateSkillName('valid.skill_name-1'));
});

test('runSkillsRemove：含 ANSI escape 的 name 在驗證階段被擋（非落到「不存在」靜默回傳）', () => {
  // mutation-safe：若移除 validateSkillName 呼叫，此 name 會落到「不在 lock → return EXIT_OK」而不拋
  assert.throws(
    () => runSkillsRemove({ extraArgs: ['\x1b[2Jmalicious'] }),
    (err) => {
      assert.ok(err instanceof SyncError);
      assert.equal(err.code, ERR.INVALID_ARGS);
      return true;
    }
  );
});

// =============================================================================
// maskHome / formatError：非結構化錯誤訊息的 HOME 路徑縱深遮罩
// =============================================================================

test('maskHome：替換文字中的 HOME 絕對路徑為 ~（含正/反斜線）', () => {
  const home = require('node:os').homedir();
  const msg = `ENOENT: open '${path.join(home, '.claude', 'x')}'`;
  const masked = maskHome(msg);
  assert.ok(!masked.includes(home), '不應殘留完整 HOME 路徑');
  assert.ok(masked.includes('~'), '應以 ~ 遮罩');
  assert.equal(maskHome(''), '', '空字串原樣回傳');
});

test('formatError：非 SyncError 訊息的 HOME 路徑被遮罩（mutation-safe）', () => {
  const home = require('node:os').homedir();
  const orig = console.error;
  let cap = '';
  console.error = (s) => { cap += String(s); };
  try {
    formatError(new Error(`boom '${path.join(home, '.claude', 'y')}'`));
  } finally {
    console.error = orig;
  }
  assert.ok(!cap.includes(home), '非 SyncError 輸出不應含完整 HOME 路徑');
});

// =============================================================================
// 安全：getFiles 的 symlink 逃逸防護（整合，非僅 isPathInside 零件）
// 阻止 symlink 把同步目錄外的敏感檔（~/.ssh 等）吸進 repo
// =============================================================================

const itUnix = process.platform === 'win32' ? test.skip : test;

itUnix('getFiles：逃逸到目錄外的 symlink 不被列入', () => {
  withTmpDir((dir) => {
    // 目錄外的「敏感」檔
    const outside = path.join(dir, 'outside-secret');
    fs.writeFileSync(outside, 'SECRET');
    // 同步根目錄與其內的正常檔
    const root = path.join(dir, 'root');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'normal.txt'), 'ok');
    // 根目錄內指向外部檔的 symlink
    fs.symlinkSync(outside, path.join(root, 'escape.txt'));

    const files = getFiles(root);
    assert.deepEqual(files.sort(), ['normal.txt'], '逃逸 symlink 不得被列入，只留真實檔');
  });
});

itUnix('getFiles：broken symlink 被靜默跳過（不拋錯）', () => {
  withTmpDir((dir) => {
    const root = path.join(dir, 'root');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'real.txt'), 'x');
    fs.symlinkSync(path.join(dir, 'does-not-exist'), path.join(root, 'broken.txt'));

    let files;
    assert.doesNotThrow(() => { files = getFiles(root); });
    assert.deepEqual(files.sort(), ['real.txt'], 'broken symlink 應被跳過');
  });
});

itUnix('getFiles：指向根目錄內部的 symlink 檔會被納入', () => {
  withTmpDir((dir) => {
    const root = path.join(dir, 'root');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'real.txt'), 'x');
    // 指向「根目錄內」的 symlink，未逃逸 → 應納入
    fs.symlinkSync(path.join(root, 'real.txt'), path.join(root, 'alias.txt'));

    const files = getFiles(root);
    assert.deepEqual(files.sort(), ['alias.txt', 'real.txt']);
  });
});

test('getFiles：目錄不存在回傳空集（不拋錯）', () => {
  withTmpDir((dir) => {
    assert.deepEqual(getFiles(path.join(dir, 'absent')), []);
  });
});

// =============================================================================
// 破壞性 apply 路徑：copyFile 各分支 + applySyncItems 型別派發/統計/dry-run
// （此前僅靠人工 smoke test，無自動回歸防護）
// =============================================================================

test('copyFile：src 不存在回傳 false 且不建立 dest', () => {
  withTmpDir((dir) => {
    const dest = path.join(dir, 'dest.txt');
    assert.equal(copyFile(path.join(dir, 'nope.txt'), dest), false);
    assert.equal(fs.existsSync(dest), false);
  });
});

test('copyFile：dry-run 不寫入但正確回報「將會寫入」', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'src.txt');
    const dest = path.join(dir, 'dest.txt');
    fs.writeFileSync(src, 'A');

    // dest 不存在 → 將新增
    assert.equal(copyFile(src, dest, true), true);
    assert.equal(fs.existsSync(dest), false, 'dry-run 不得寫入');

    // dest 內容相同 → 無需寫入
    fs.writeFileSync(dest, 'A');
    assert.equal(copyFile(src, dest, true), false);
    // dest 內容不同 → 將更新
    fs.writeFileSync(dest, 'B');
    assert.equal(copyFile(src, dest, true), true);
  });
});

test('copyFile：非 dry-run 內容相同不重寫，內容不同才寫入', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'src.txt');
    const dest = path.join(dir, 'dest.txt');
    fs.writeFileSync(src, 'A');
    fs.writeFileSync(dest, 'A');
    const mtime = fs.statSync(dest).mtimeMs;
    assert.equal(copyFile(src, dest), false, '內容相同不應寫入');
    assert.equal(fs.statSync(dest).mtimeMs, mtime, '不應重寫');

    fs.writeFileSync(src, 'B');
    assert.equal(copyFile(src, dest), true, '內容不同應寫入');
    assert.equal(fs.readFileSync(dest, 'utf8'), 'B');
  });
});

test('applySyncItems：file + dir 型別套用統計與破壞性刪除（非 dry-run）', () => {
  withTmpDir((dir) => {
    // file 項：src 存在、dest 不存在 → added
    const fileSrc = path.join(dir, 'CLAUDE.md');
    const fileDest = path.join(dir, 'out', 'CLAUDE.md');
    fs.writeFileSync(fileSrc, 'hello');

    // dir 項：src 有 a.txt（新增），dest 有殘留 stale.txt（應刪除）
    const dSrc = path.join(dir, 'src-dir');
    const dDest = path.join(dir, 'dest-dir');
    fs.mkdirSync(dSrc); fs.mkdirSync(dDest);
    fs.writeFileSync(path.join(dSrc, 'a.txt'), '1');
    fs.writeFileSync(path.join(dDest, 'stale.txt'), 'old');

    const items = [
      { label: 'CLAUDE.md', src: fileSrc, dest: fileDest, type: 'file' },
      { label: 'rules', src: dSrc, dest: dDest, type: 'dir' },
    ];
    const { stats, changeLog } = applySyncItems(items, 'to-local', { dryRun: false });

    assert.equal(fs.readFileSync(fileDest, 'utf8'), 'hello', 'file 項應被寫入');
    assert.equal(fs.existsSync(path.join(dDest, 'a.txt')), true, 'dir 新檔應被鏡射');
    assert.equal(fs.existsSync(path.join(dDest, 'stale.txt')), false, 'dest 殘留檔應被刪除');
    assert.equal(stats.added, 2, 'CLAUDE.md + a.txt 共 2 個 added');
    assert.equal(stats.deleted, 1, 'stale.txt 為 1 個 deleted');
    assert.ok(changeLog.some(l => l.includes('CLAUDE.md')), 'changeLog 應含 file 項');
  });
});

test('applySyncItems：dry-run 計入統計但不實際寫入', () => {
  withTmpDir((dir) => {
    const fileSrc = path.join(dir, 'CLAUDE.md');
    const fileDest = path.join(dir, 'out', 'CLAUDE.md');
    fs.writeFileSync(fileSrc, 'hello');

    const items = [{ label: 'CLAUDE.md', src: fileSrc, dest: fileDest, type: 'file' }];
    const { stats } = applySyncItems(items, 'to-local', { dryRun: true });

    assert.equal(stats.added, 1, 'dry-run 仍計入將新增的統計');
    assert.equal(fs.existsSync(fileDest), false, 'dry-run 不得實際寫入');
  });
});

// =============================================================================
// ensureSymlink：幂等建立/修復探索點 symlink（xtool-skills 前置能力）
// 型別判斷一律 lstat；懸空 symlink 須修復不 EEXIST；真實目錄佔用走 D5 轉換
// =============================================================================

itUnix('ensureSymlink：link 不存在 → 建立指向 target 的 symlink（action added）', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'X');
    const link = path.join(dir, 'link');

    const res = ensureSymlink(target, link);
    assert.deepEqual(res, { action: 'added' });
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, '應為 symlink');
    assert.equal(fs.readlinkSync(link), target, '應指向 target');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'X', '內容經 symlink 可達');
  });
});

itUnix('ensureSymlink：已是正確 symlink → 回 null（幂等，不重建）', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');
    fs.symlinkSync(target, link);

    assert.equal(ensureSymlink(target, link), null, '幂等應回 null');
  });
});

itUnix('ensureSymlink：symlink 指向錯誤 → 修正（action updated）', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'target');
    const wrong = path.join(dir, 'wrong');
    fs.mkdirSync(target);
    fs.mkdirSync(wrong);
    const link = path.join(dir, 'link');
    fs.symlinkSync(wrong, link);

    const res = ensureSymlink(target, link);
    assert.deepEqual(res, { action: 'updated' });
    assert.equal(fs.readlinkSync(link), target, '應改指向正確 target');
  });
});

itUnix('ensureSymlink：懸空 symlink（目標不存在）→ unlink 重建，不因 EEXIST 失敗', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');
    // 先建懸空 symlink（指向不存在路徑）
    fs.symlinkSync(path.join(dir, 'ghost'), link);
    assert.equal(fs.existsSync(link), false, '懸空 symlink 對 existsSync 回 false');

    let res;
    assert.doesNotThrow(() => { res = ensureSymlink(target, link); });
    assert.deepEqual(res, { action: 'updated' });
    assert.equal(fs.readlinkSync(link), target);
  });
});

itUnix('ensureSymlink：真實目錄佔用（D5 遷移）→ rm 後建 symlink', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'agents-skill');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'CANON');
    // link 位置是舊機制的真實目錄
    const link = path.join(dir, 'claude-skill');
    fs.mkdirSync(link);
    fs.writeFileSync(path.join(link, 'SKILL.md'), 'OLD');

    const res = ensureSymlink(target, link);
    assert.deepEqual(res, { action: 'updated' });
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, '真實目錄應被轉為 symlink');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'CANON', '內容來自 target 正典');
  });
});

itUnix('ensureSymlink：dry-run 不寫入但回報 action', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');

    const res = ensureSymlink(target, link, true);
    assert.deepEqual(res, { action: 'added' });
    assert.equal(fs.existsSync(link), false, 'dry-run 不得建立 symlink');
  });
});

test('ensureSymlink：Windows dir symlink 失敗時退回 junction（mock 覆蓋）', () => {
  withTmpDir((dir) => {
    const target = path.join(dir, 'target');
    fs.mkdirSync(target);
    const link = path.join(dir, 'link');

    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const origSymlink = fs.symlinkSync;
    const calls = [];
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    fs.symlinkSync = (t, p, type) => {
      calls.push(type);
      if (type === 'dir') { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; }
      return origSymlink(t, p); // junction：在此平台以一般 symlink 落地
    };
    try {
      let res;
      assert.doesNotThrow(() => { res = ensureSymlink(target, link); });
      assert.deepEqual(res, { action: 'added' });
      assert.ok(calls.includes('dir'), '應先嘗試 dir symlink');
      assert.ok(calls.includes('junction'), 'dir 失敗後應退回 junction');
    } finally {
      fs.symlinkSync = origSymlink;
      Object.defineProperty(process, 'platform', origPlatform);
    }
  });
});

// =============================================================================
// safety:check：獨立、唯讀、安全輸出與 exit code
// =============================================================================

// safety:check 執行期依賴 sync.js + safety-check.js + toml-reader.js 三檔，sandbox
// 需同時複製，避免單檔假設回歸（sync.js require 缺任一檔會直接崩）。
const SAFETY_RUNTIME_FILES = ['sync.js', 'safety-check.js', 'toml-reader.js'];

function setupSafetySandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-safety-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  for (const name of SAFETY_RUNTIME_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(repo, name));
  }
  return { repo, root };
}

function runSafety(repo) {
  return spawnSync(process.execPath, [path.join(repo, 'sync.js'), 'safety:check'], {
    cwd: repo,
    env: noColorEnv({ HOME: path.join(repo, 'home'), USERPROFILE: path.join(repo, 'home') }),
    encoding: 'utf8',
  });
}

function writeSafetyJson(repo, rel, obj) {
  const filePath = path.join(repo, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

function writeSafetyText(repo, rel, text) {
  const filePath = path.join(repo, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

test('safety:check：無問題時 exit 0，且不掃 test/openspec/README', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const token = 'sk-' + 'x'.repeat(20);
    writeSafetyText(repo, 'test/fixture.txt', token);
    writeSafetyText(repo, 'openspec/changes/example/spec.md', token);
    writeSafetyText(repo, 'README.md', token);
    const r = runSafety(repo);
    assert.equal(r.status, 0, `非同步來源不應觸發 safety:check\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /未發現/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：只有 warning 時 exit 1，列 key 不列 env 值', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const envValue = 'plain-env-value-marker';
    writeSafetyJson(repo, 'claude/settings.json', {
      env: { ANTHROPIC_API_KEY: envValue },
      keyboardLayout: 'colemak',
    });
    const r = runSafety(repo);
    assert.equal(r.status, 1, `warning 應 exit 1\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /env\.ANTHROPIC_API_KEY/);
    assert.match(r.stdout, /keyboardLayout/);
    assert.doesNotMatch(r.stdout, new RegExp(envValue), '不得輸出 env 值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：settings.json env 值為已知格式 secret → hard block exit 2（不只 warning）', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    // env 已翻黑名單制、值不再 strip；known-format token 由 text 掃描兜底為 hard block。
    // 未知格式 token 天生無法被 pattern 攔（僅剩 key 名 warning + 人工審核），為明文承擔。
    const secret = 'sk-' + 'a'.repeat(24);
    writeSafetyJson(repo, 'claude/settings.json', { env: { ANTHROPIC_API_KEY: secret } });
    const r = runSafety(repo);
    assert.equal(r.status, 2, `env 內已知格式 secret 應 hard block\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /疑似機密值/, '應歸類為疑似機密值 hard block');
    assert.doesNotMatch(r.stdout, new RegExp(secret), '不得輸出 secret 原值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：SECRET_VALUE_PATTERN 各 token 前綴皆 hard block（防 regex 分支誤刪）', () => {
  const samples = [
    'sk-' + 'a'.repeat(20),          // Anthropic/OpenAI
    'sk_live_' + 'a'.repeat(12),     // Stripe
    'ghp_' + 'a'.repeat(24),         // GitHub PAT
    'github_pat_' + 'a'.repeat(10),  // GitHub fine-grained
    'glpat-' + 'a'.repeat(12),       // GitLab
    'AKIA' + 'ABCDEFGHIJKLMNOP',     // AWS
    'AIza' + 'a'.repeat(20),         // Google
    'SG.' + 'a'.repeat(20),          // SendGrid
    'npm_' + 'a'.repeat(24),         // npm
    'xoxb-' + 'a'.repeat(10),        // Slack bot
    'xapp-' + 'a'.repeat(10),        // Slack app
    'eyJ' + 'a'.repeat(12) + '.',    // JWT header
  ];
  for (const token of samples) {
    const { repo, root } = setupSafetySandbox();
    try {
      writeSafetyText(repo, 'claude/statusline.sh', `echo ${token}\n`);
      const r = runSafety(repo);
      assert.equal(r.status, 2, `token 前綴應 hard block: ${token.slice(0, 8)}…\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /疑似機密值/);
      assert.doesNotMatch(r.stdout, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        '不得輸出 secret 原值');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('safety:check：SETTINGS_HARD_BLOCK_KEYS 各 key 皆 hard block（防陣列成員誤刪）', () => {
  const { SETTINGS_HARD_BLOCK_KEYS } = require('../safety-check.js');
  // hooks 以外的 apiKeyHelper／aws*／otel* 為 credential helper，settings.test.js
  // 反覆宣稱「照常同步、由 safety:check hard block 兜底」——此迴圈證明兜底確實存在，
  // 任一 key 被重構移出陣列即紅燈（比照 SECRET_VALUE_PATTERN 的逐項迴圈）。
  for (const key of SETTINGS_HARD_BLOCK_KEYS) {
    const { repo, root } = setupSafetySandbox();
    try {
      writeSafetyJson(repo, 'claude/settings.json', { [key]: 'x' });
      const r = runSafety(repo);
      assert.equal(r.status, 2, `settings key 應 hard block: ${key}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /不應同步 settings 欄位/, `${key} 應歸類為不應同步 settings 欄位`);
      assert.match(r.stdout, new RegExp(key), `輸出應標明命中的 key: ${key}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('safety:check：hard block exit 2，輸出遮罩 secret 與 HOME 路徑', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const token = 'sk-' + 'z'.repeat(20);
    writeSafetyJson(repo, 'claude/settings.json', {
      hooks: { Stop: [{ hooks: [{ command: 'x' }] }] },
      env: { API_TOKEN: token },
      statusLine: { command: 'bash /home/alice/.claude/statusline.sh' },
    });
    writeSafetyText(repo, 'claude/statusline.sh', '-----BEGIN PRIVATE KEY-----\nabc\n');
    const r = runSafety(repo);
    assert.equal(r.status, 2, `hard block 應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /疑似機密值|私鑰片段|絕對 HOME 路徑|不應同步 settings 欄位/);
    assert.match(r.stdout, /hooks/);
    assert.doesNotMatch(r.stdout, new RegExp(token), '不得輸出 secret 原值');
    assert.doesNotMatch(r.stdout, /\/home\/alice/, '不得輸出完整 HOME 路徑');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：repo config.toml 機密 section（model_providers）→ hard block exit 2，只印 section 路徑', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const valueMarker = 'provider-value-marker';
    writeSafetyText(repo, 'codex/config.toml',
      `personality = "x"\n\n[model_providers.openai]\nbase_url = "${valueMarker}"\n`);
    const r = runSafety(repo);
    assert.equal(r.status, 2, `機密 section 應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /不應同步 codex 機密 section/);
    assert.match(r.stdout, /model_providers\.openai/, '應指出 section 路徑');
    assert.doesNotMatch(r.stdout, new RegExp(valueMarker), '不得輸出 section 內的值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：機密 section header 變體（[[x]]／尾註解／內部空白）仍 hard block exit 2', () => {
  const variants = [
    '[[model_providers]]\nbase_url = "v"\n',            // array-of-tables
    '[model_providers.openai] # 尾註解\nbase_url = "v"\n', // 尾註解
    '[ mcp_servers.foo ]\ncommand = "v"\n',              // header 內部空白
  ];
  for (const body of variants) {
    const { repo, root } = setupSafetySandbox();
    try {
      writeSafetyText(repo, 'codex/config.toml', `personality = "x"\n\n${body}`);
      const r = runSafety(repo);
      assert.equal(r.status, 2, `header 變體應 hard block\n${body}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /不應同步 codex 機密 section/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

// 回歸（F2）：section 名含 ] 的引號 key 曾讓 header 解析失敗、key 誤掛前一 section，
// 使機密 section 的 hard block 靜默降級成 warning（exit 2 → exit 1）——CI 若以
// exit 2 當閘門就會放行含 MCP 憑證的 config.toml。
test('safety:check：機密 section 名含 ] 的引號 key 仍 hard block exit 2（不得降級為 warning）', () => {
  const variants = [
    '[mcp_servers."weird]name"]\naccess_password = "v"\n',
    '[[model_providers."x]y"]]\nbase_url = "v"\n',
  ];
  for (const body of variants) {
    const { repo, root } = setupSafetySandbox();
    try {
      writeSafetyText(repo, 'codex/config.toml', `personality = "x"\n\n${body}`);
      const r = runSafety(repo);
      assert.equal(r.status, 2, `引號 section 名應 hard block、不得降級\n${body}\n${r.stdout}`);
      assert.match(r.stdout, /不應同步 codex 機密 section/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

// fail closed：header 解析不出來時 section 名不可信，機密判斷失去依據，
// 寧可 hard block 讓人工檢視，也不沿用前一 section 名而漏判。
test('safety:check：malformed section header → hard block exit 2，只印行號', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const valueMarker = 'malformed-value-marker';
    writeSafetyText(repo, 'codex/config.toml',
      `personality = "x"\n\n[mcp_servers\nbase_url = "${valueMarker}"\n`);
    const r = runSafety(repo);
    assert.equal(r.status, 2, `malformed header 應 hard block\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /無法解析的 TOML section header/);
    assert.match(r.stdout, /line 3/, '應指出行號');
    assert.doesNotMatch(r.stdout, new RegExp(valueMarker), '不得輸出該 section 內的值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：repo config.toml 裝置狀態 section（history 等）→ warning exit 1', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    writeSafetyText(repo, 'codex/config.toml',
      'personality = "x"\n\n[history]\npersistence = "save-all"\n\n[profiles.fast]\nmodel = "o3"\n');
    const r = runSafety(repo);
    assert.equal(r.status, 1, `裝置狀態 section 應 warning exit 1\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /codex 裝置狀態 section 需人工審核/);
    assert.match(r.stdout, /history/, '應指出 section 路徑');
    assert.match(r.stdout, /profiles\.fast/, '前綴子 section 也應命中');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：opencode 主設定含機密值 → hard block exit 2，遮罩原值', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const secret = 'sk-' + 'o'.repeat(24);
    writeSafetyText(repo, 'opencode/opencode.jsonc',
      `{\n  "$schema": "https://opencode.ai/config.json",\n  "apiKey": "${secret}"\n}\n`);
    const r = runSafety(repo);
    assert.equal(r.status, 2, `opencode 主設定機密應 hard block\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /疑似機密值/);
    assert.match(r.stdout, /opencode[\\/]opencode\.jsonc/, '應指出 opencode 主設定檔');
    assert.doesNotMatch(r.stdout, new RegExp(secret), '不得輸出 secret 原值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：opencode/AGENTS.md 含絕對 HOME 路徑 → hard block exit 2，遮罩路徑', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    writeSafetyText(repo, 'opencode/AGENTS.md', '# opencode\n見 /home/alice/.config/opencode/opencode.jsonc\n');
    const r = runSafety(repo);
    assert.equal(r.status, 2, `AGENTS.md 內 HOME 路徑應 hard block\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /絕對 HOME 路徑/);
    assert.doesNotMatch(r.stdout, /\/home\/alice/, '不得輸出完整 HOME 路徑');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：三引號字串內的假 section header 不誤標 key 歸屬（跨行狀態感知）', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    // description 是三引號多行字串，內容剛好含 `[personality]` 樣式；其後 api_token 實際
    // 屬於 [tui]。逐行掃描會把字串內 `[personality]` 誤判成 header、把 api_token 標成
    // personality.api_token。改用 readCodexStatements 後應正確標為 tui.api_token。
    writeSafetyText(repo, 'codex/config.toml',
      '[tui]\ndescription = """\n[personality]\n"""\napi_token = "x"\n');
    const r = runSafety(repo);
    assert.match(r.stdout, /敏感命名 key path/, 'api_token 應觸發敏感命名 warning');
    assert.match(r.stdout, /tui\.api_token/, 'key 應正確歸屬 tui，而非字串內的假 section');
    assert.doesNotMatch(r.stdout, /personality\.api_token/, '不得把 key 誤標到三引號字串內的假 section');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：claude/agents 已自豁免清單移除（agent 庫已不同步）→ 機密樣式照常 hard block', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    // claude/agents 同步項目與豁免已隨 agent 庫移除（不做預防性列名）：
    // 若日後重新引入且含機密樣式，text pattern 應照常攔截
    writeSafetyText(repo, 'claude/agents/pkg/sanitizer.md',
      'pattern: github_pat_' + 'a'.repeat(24) + '\n');
    const r = runSafety(repo);
    assert.equal(r.status, 2, `claude/agents 不再豁免，應 hard block\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /疑似機密值/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：claude/skills 套件文件同樣豁免 text pattern；codex/agents 不再豁免', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    writeSafetyText(repo, 'claude/skills/demo/SKILL.md', '範例：/home/bob/secret 與 ghp_' + 'y'.repeat(24) + '\n');
    const r = runSafety(repo);
    assert.equal(r.status, 0, `claude/skills 應豁免\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /未發現/);

    // codex/agents/ 已自豁免清單移除（repo 目前無此目錄，排除屬預防性列名）：
    // 若日後重新引入且含機密樣式，text pattern 應照常攔截
    writeSafetyText(repo, 'codex/agents/pkg/role.toml', 'note = "sk-' + 'x'.repeat(20) + '"\n');
    const r2 = runSafety(repo);
    assert.equal(r2.status, 2, `codex/agents 不再豁免，應 hard block\n${r2.stdout}\n${r2.stderr}`);
    assert.match(r2.stdout, /疑似機密值/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safety:check：設定來源（statusline.sh）含機密樣式 → 仍 hard block exit 2（防過度排除）', () => {
  const { repo, root } = setupSafetySandbox();
  try {
    const token = 'ghp_' + 'w'.repeat(24);
    writeSafetyText(repo, 'claude/statusline.sh', '#!/bin/bash\necho ' + token + '\n');
    const r = runSafety(repo);
    assert.equal(r.status, 2, `設定來源仍應觸發 hard block\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /疑似機密值/);
    assert.match(r.stdout, /statusline\.sh/);
    assert.doesNotMatch(r.stdout, new RegExp(token), '不得輸出 secret 原值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
