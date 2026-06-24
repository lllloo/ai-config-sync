'use strict';

// =============================================================================
// 邊界條件與進階覆蓋測試（node:test，零外部相依）
// 涵蓋 spec.md 建議的高/中/低優先新增測試項目
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeLineDiff,
  computeSimpleLineDiff,
  matchExclude,
  parseArgs,
  parseSkillSource,
  toRelativePath,
  maskHome,
  isEolOnlyDiff,
  isPathInside,
  mirrorDir,
  readFileSafe,
  writeFileSafe,
  runSkillsRemove,
  validateSkillName,
  SyncError,
  ERR,
  EXIT_OK,
  EXIT_DIFF,
  EXIT_ERROR,
  COMMANDS,
  COMMAND_ALIASES,
  VALID_COMMANDS,
  attachCommandHandlers,
  formatError,
} = require('../sync.js');
const fs = require('node:fs');
const path = require('node:path');
const { withArgv, withTmpDir } = require('./helpers');

// =============================================================================
// 高優先：computeSimpleLineDiff（大檔案 fallback）
// =============================================================================

test('computeSimpleLineDiff：刪除行標記為 -，新增行標記為 +', () => {
  const ops = computeSimpleLineDiff(['a', 'b', 'c'], ['a', 'c', 'd']);
  const removed = ops.filter(op => op.type === '-').map(op => op.line);
  const added = ops.filter(op => op.type === '+').map(op => op.line);
  assert.deepEqual(removed, ['b']);
  assert.deepEqual(added, ['d']);
});

test('computeSimpleLineDiff：相同內容無 +/- 行', () => {
  const ops = computeSimpleLineDiff(['x', 'y'], ['x', 'y']);
  const changed = ops.filter(op => op.type !== ' ');
  assert.equal(changed.length, 0);
});

test('computeSimpleLineDiff：結果帶 isApproximate 標記', () => {
  const ops = computeSimpleLineDiff(['a'], ['b']);
  assert.ok(ops.length > 0);
  assert.equal(ops[0].isApproximate, true);
});

test('computeSimpleLineDiff：空陣列對空陣列回傳空', () => {
  const ops = computeSimpleLineDiff([], []);
  assert.equal(ops.length, 0);
});

test('computeLineDiff：超過 LCS_MAX_LINES 時 fallback 到 simple diff', () => {
  // 製造 > 2000 行的 diff 觸發 fallback
  const big = Array.from({ length: 1500 }, (_, i) => `line-${i}`);
  const big2 = Array.from({ length: 1500 }, (_, i) => `line-${i}-v2`);
  const ops = computeLineDiff(big.join('\n'), big2.join('\n'));
  // fallback 結果的第一個元素應帶 isApproximate
  assert.equal(ops[0].isApproximate, true);
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
// 高優先：attachCommandHandlers 後所有 handler 非 null
// =============================================================================

test('attachCommandHandlers：呼叫後所有 COMMANDS handler 應為函式', () => {
  attachCommandHandlers();
  for (const [cmd, entry] of Object.entries(COMMANDS)) {
    assert.equal(typeof entry.handler, 'function',
      `COMMANDS['${cmd}'].handler 應為函式`);
  }
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

// =============================================================================
// COMMANDS / ALIASES 一致性（更嚴格的驗證）
// =============================================================================

test('VALID_COMMANDS 與 COMMANDS keys 完全一致', () => {
  const commandKeys = Object.keys(COMMANDS).sort();
  const validSorted = [...VALID_COMMANDS].sort();
  assert.deepEqual(commandKeys, validSorted);
});

test('COMMAND_ALIASES 值皆指向 COMMANDS 中存在的 key', () => {
  for (const [alias, cmd] of Object.entries(COMMAND_ALIASES)) {
    assert.ok(cmd in COMMANDS,
      `別名 ${alias} 指向 ${cmd}，但 COMMANDS 中不存在`);
  }
});

test('DEVICE_FIELDS 包含 model 與 effortLevel', () => {
  const { DEVICE_FIELDS } = require('../sync.js');
  assert.ok(DEVICE_FIELDS.includes('model'));
  assert.ok(DEVICE_FIELDS.includes('effortLevel'));
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

    const changed = mirrorDir(src, dest, [], false, true); // dryRun=true

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
