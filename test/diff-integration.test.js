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

const SYNC_JS = path.join(__dirname, '..', 'sync.js');

function runDiffWithFakeHome(tmpHome) {
  return spawnSync(process.execPath, [SYNC_JS, 'diff'], {
    env: { ...process.env, USERPROFILE: tmpHome, HOME: tmpHome },
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
