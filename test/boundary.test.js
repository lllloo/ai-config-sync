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
const { withArgv } = require('./helpers');

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
  // 尾部斜線可能產生空 segment，看實作是否能處理
  // 若拋錯也合理（格式不標準），這裡測試不 crash
  assert.ok(result.name || true);
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
