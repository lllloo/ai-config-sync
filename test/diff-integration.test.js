'use strict';

// =============================================================================
// 整合測試：透過 spawn 子程序驗證 runDiff（to-repo 方向）
// 鎖住「本機 HOME 缺檔時，repo 端的檔案會被報為 deleted」這個情境
// 對應修復：diffFile/diffDir 在 src 不存在但 dest 存在時應回 'deleted'
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { noColorEnv } = require('./helpers.js');

const SYNC_JS = path.join(__dirname, '..', 'sync.js');

function runDiffWithFakeHome(tmpHome) {
  return spawnSync(process.execPath, [SYNC_JS, 'diff'], {
    env: noColorEnv({ USERPROFILE: tmpHome, HOME: tmpHome }),
    encoding: 'utf8',
  });
}

test('runDiff (to-repo)：本機 HOME 為空 → 應回 EXIT_DIFF 並列出 deleted', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-diff-home-'));
  try {
    const result = runDiffWithFakeHome(tmpHome);
    assert.equal(result.status, 1, `預期 EXIT_DIFF=1，實得 ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /repo 有、本機沒有/, '應出現 deleted 訊息');
    assert.match(
      result.stdout,
      /\[-\] claude\/agents\/everything-claude-code\/.*repo 有、本機沒有/,
      '應將 claude/agents/everything-claude-code/ 下的檔案逐一列為 deleted'
    );
    assert.doesNotMatch(result.stdout, /本機與 repo 完全一致/, '不該宣告完全一致');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('runDiff (to-repo)：本機 HOME 為空 → codex/AGENTS.md 也應被回報', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-diff-home-'));
  try {
    const result = runDiffWithFakeHome(tmpHome);
    assert.match(result.stdout, /codex\/AGENTS\.md/, '應列出 codex/AGENTS.md');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// =============================================================================
// 明確裝置鍵不列為一般差異；敏感命名不再進「未同步」摘要，改走一般 settings diff
// =============================================================================

const REPO_SETTINGS = require(path.join(__dirname, '..', 'claude', 'settings.json'));

// 以 repo 可攜設定為底、疊上額外 top-level key，讓 settings 明細差異只落在被排除的 key
function makeHomeWithSettings(extra) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-diff-home-'));
  const claudeDir = path.join(tmpHome, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({ ...REPO_SETTINGS, ...extra }, null, 2)
  );
  return tmpHome;
}

test('runDiff：僅 DEVICE_SETTINGS_KEYS 明列鍵被排除時，不印「未同步」行', () => {
  const tmpHome = makeHomeWithSettings({ model: 'opus', autoUpdatesChannel: 'stable' });
  try {
    const result = runDiffWithFakeHome(tmpHome);
    assert.doesNotMatch(result.stdout, /未同步/, '預期裝置鍵不應觸發「未同步」行');
    assert.doesNotMatch(result.stdout, /\bmodel\b/, '不應列出 model');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('runDiff：敏感命名 key 不再產生「未同步」摘要，改列一般 settings 差異', () => {
  const tmpHome = makeHomeWithSettings({ sessionDefaults: { compact: true } });
  try {
    const result = runDiffWithFakeHome(tmpHome);
    assert.match(result.stdout, /claude\/settings\.json/, 'settings.json 應被列為有差異');
    assert.doesNotMatch(result.stdout, /未同步/, '敏感命名不應被列為未同步摘要');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// env-blacklist Decision 2：settings.json 差異不外洩 env 值
test('runDiff：settings 差異不外洩 env 值', () => {
  const leakMarker = 'hunter2-leak-marker-xyz';
  // DB_PASS 乾淨名+乾淨值 → 仍應能觸發 settings 差異，但輸出不得包含值本身
  const tmpHome = makeHomeWithSettings({ env: { ...REPO_SETTINGS.env, DB_PASS: leakMarker } });
  try {
    const result = runDiffWithFakeHome(tmpHome);
    assert.match(result.stdout, /claude\/settings\.json/, 'settings.json 應被列為有差異');
    assert.doesNotMatch(result.stdout, new RegExp(leakMarker), '輸出不得顯示 env 值');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
