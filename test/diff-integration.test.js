'use strict';

// =============================================================================
// 整合測試：沙箱化 repo + HOME，透過 spawn 子程序驗證 runDiff（to-repo 方向）
// 把 sync.js + safety-check.js + toml-reader.js + skills.js 複製進 tmp 當 repo，並自控 repo
// 內容，使斷言不依賴作者真實 repo 的 agents／settings 資料（避免資料變動即 fail）。
//
// 鎖住：
//   - 本機 HOME 缺檔時，repo 端檔案報為 deleted（src 不存在但 dest 存在 → 'deleted'）
//   - settings.json 黑名單混合制：裝置鍵不列一般差異、敏感命名走一般 diff、env 值不外洩
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { noColorEnv } = require('./helpers.js');

const SYNC_RUNTIME_FILES = ['sync.js', 'safety-check.js', 'toml-reader.js', 'skills.js'];

// 沙箱 repo 的基準可攜 settings：repo 與本機共用此底，本機再疊 extra，
// 使 settings 明細差異只落在測試指定的 key 上。
const BASE_SETTINGS = { permissions: { allow: ['Bash'] }, env: { EDITOR: 'vim' } };

function setupSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-diff-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  for (const name of SYNC_RUNTIME_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(repo, name));
  }
  // 自控 repo 內容：一個 commands package 檔、codex/AGENTS.md、可攜 settings
  writeFile(path.join(repo, 'claude', 'commands', 'pkg', 'sample.md'), 'CMD-SAMPLE');
  writeFile(path.join(repo, 'codex', 'AGENTS.md'), 'CODEX-AGENTS');
  writeJson(path.join(repo, 'claude', 'settings.json'), BASE_SETTINGS);
  return { repo, home, root };
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

function runDiff(repo, home) {
  return spawnSync(process.execPath, [path.join(repo, 'sync.js'), 'diff'], {
    cwd: repo,
    env: noColorEnv({ HOME: home, USERPROFILE: home }),
    encoding: 'utf8',
  });
}

// 以沙箱 repo 的可攜設定為底，疊上 extra 寫進本機 HOME
function seedHomeSettings(home, extra) {
  writeJson(path.join(home, '.claude', 'settings.json'), { ...BASE_SETTINGS, ...extra });
}

test('runDiff (to-repo)：本機 HOME 為空 → 回 EXIT_DIFF 並將 repo 檔逐一列為 deleted', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const result = runDiff(repo, home);
    assert.equal(result.status, 1, `預期 EXIT_DIFF=1，實得 ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /repo 有、本機沒有/, '應出現 deleted 訊息');
    assert.match(result.stdout, /\[-\] claude\/commands\/pkg\/sample\.md.*repo 有、本機沒有/,
      '應將 repo commands 目錄下的檔案逐一列為 deleted');
    assert.doesNotMatch(result.stdout, /本機與 repo 完全一致/, '不該宣告完全一致');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runDiff (to-repo)：本機 HOME 為空 → codex/AGENTS.md 也應被回報', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const result = runDiff(repo, home);
    assert.match(result.stdout, /codex\/AGENTS\.md/, '應列出 codex/AGENTS.md');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// settings.json 黑名單混合制：裝置鍵不列一般差異、敏感命名走一般 diff、env 值不外洩
// -----------------------------------------------------------------------------

test('runDiff：僅 DEVICE_SETTINGS_KEYS 明列鍵不同時，不印「未同步」行、不列裝置鍵', () => {
  const { repo, home, root } = setupSandbox();
  try {
    seedHomeSettings(home, { model: 'opus', autoUpdatesChannel: 'stable' });
    const result = runDiff(repo, home);
    assert.doesNotMatch(result.stdout, /未同步/, '裝置鍵不應觸發「未同步」行');
    assert.doesNotMatch(result.stdout, /\bmodel\b/, '不應列出 model');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runDiff：敏感命名 key 不再產生「未同步」摘要，改列一般 settings 差異', () => {
  const { repo, home, root } = setupSandbox();
  try {
    seedHomeSettings(home, { sessionDefaults: { compact: true } });
    const result = runDiff(repo, home);
    assert.match(result.stdout, /claude\/settings\.json/, 'settings.json 應被列為有差異');
    assert.doesNotMatch(result.stdout, /未同步/, '敏感命名不應被列為未同步摘要');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runDiff：settings 差異不外洩 env 值', () => {
  const { repo, home, root } = setupSandbox();
  const leakMarker = 'hunter2-leak-marker-xyz';
  try {
    // DB_PASS 乾淨名+乾淨值 → 仍觸發 settings 差異，但輸出不得包含值本身
    seedHomeSettings(home, { env: { ...BASE_SETTINGS.env, DB_PASS: leakMarker } });
    const result = runDiff(repo, home);
    assert.match(result.stdout, /claude\/settings\.json/, 'settings.json 應被列為有差異');
    assert.doesNotMatch(result.stdout, new RegExp(leakMarker), '輸出不得顯示 env 值');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
