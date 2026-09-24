'use strict';

// =============================================================================
// 「部分失敗可見度」測試：warnPartialApply。
//
// 沙箱策略：把 sync.js（及其三個 runtime 相依檔）複製進 tmp 目錄當「repo」，以覆寫
// HOME／USERPROFILE 的子行程 spawn 真實 to-local／to-repo，絕不觸碰真實 ~/.claude、
// ~/.codex（assertSandboxHome 把關）。warnPartialApply 為非匯出函式，刻意經 CLI 入口測，
// 不為了可測性去改 sync.js 的匯出或邏輯。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { noColorEnv } = require('./helpers.js');

// sync.js require('./safety-check.js')（後者 require('./toml-reader.js')）與
// require('./skills.js')，缺任一檔即崩，故四檔同抄（與 apply-integration 一致）。
const SYNC_RUNTIME_FILES = ['sync.js', 'safety-check.js', 'toml-reader.js', 'skills.js'];

const REAL_HOME = os.homedir();

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

// -----------------------------------------------------------------------------
// warnPartialApply（經 spawn 真實 to-local）
// -----------------------------------------------------------------------------

/** 建立可 spawn 的沙箱（不改本行程 env） */
function setupSpawnSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-partial-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  for (const name of SYNC_RUNTIME_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(repo, name));
  }
  spawnSync('git', ['init', '-q'], { cwd: repo });
  assertSandboxHome(home);
  return { root, repo, home };
}

/**
 * 守門：這批測試是全套測試中唯一真的執行 `to-local --yes`、往 `~/.claude` 寫入的
 * 路徑，保護僅靠 noColorEnv 覆寫 HOME／USERPROFILE。覆寫若失效（子行程仍看到真實
 * HOME）就會直接改寫使用者設定，且不會有任何人告訴你。故 spawn 前實測子行程眼中
 * 的 home：POSIX 取 $HOME、Windows 取 %USERPROFILE%，兩邊皆已覆寫，斷言於兩平台同時成立。
 * @param {string} home - 沙箱 HOME
 */
function assertSandboxHome(home) {
  assert.notEqual(home, REAL_HOME, '沙箱 HOME 不得等於真實 HOME');
  const probe = spawnSync(process.execPath, ['-p', 'require("os").homedir()'], {
    env: noColorEnv({ HOME: home, USERPROFILE: home }),
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0, `HOME 探針執行失敗：${probe.stderr}`);
  const childHome = probe.stdout.trim();
  assert.notEqual(childHome, REAL_HOME,
    '子行程仍看到真實 HOME，中止以免 to-local 寫入使用者設定');
  assert.equal(childHome, home, `子行程 HOME 未指向沙箱（實得 ${childHome}）`);
}

function runSync(repo, home, args) {
  return spawnSync(process.execPath, [path.join(repo, 'sync.js'), ...args], {
    cwd: repo,
    env: noColorEnv({ HOME: home, USERPROFILE: home }),
    encoding: 'utf8',
  });
}

/**
 * 佈置一個「先寫成功幾筆、再中途失敗」的 to-local：CLAUDE.md 先寫成功，
 * codex/AGENTS.md 的本機父目錄被一般檔案佔用——預覽的 diff 只見 dest 不存在（列為新增），
 * 到 apply 寫入時才拋錯。
 */
function seedPartialFailure(repo, home) {
  writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-CLAUDE');
  writeText(path.join(repo, 'codex', 'AGENTS.md'), 'REPO-AGENTS');
  writeText(path.join(home, '.codex'), 'occupied');
}

test('warnPartialApply：apply 中途失敗時警告已寫入筆數、exit 2', () => {
  const { root, repo, home } = setupSpawnSandbox();
  try {
    seedPartialFailure(repo, home);
    const r = runSync(repo, home, ['to-local', '--yes']);

    assert.equal(r.status, 2, `中途失敗應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /同步因錯誤中斷：已寫入 \d+ 筆變更/, '應印出部分寫入警告');
    const n = Number(r.stderr.match(/已寫入 (\d+) 筆變更/)[1]);
    assert.ok(n >= 1, `已寫入筆數應 >= 1，實得 ${n}`);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')),
      '警告所指的已寫入變更應真的落地');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 註：to-local --dry-run 只走 printToLocalPreview（diff），不進 applySyncItems，
// 故 warnPartialApply 的 dryRun 分支要從 to-repo --dry-run 進入。
test('warnPartialApply：dry-run 失敗不印「已寫入」警告（無實際寫入）', () => {
  const { root, repo, home } = setupSpawnSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'LOCAL-CLAUDE');
    writeText(path.join(home, '.codex', 'AGENTS.md'), 'LOCAL-AGENTS');
    // repo 端落點被目錄佔用 → copyFile 讀 dest 得 EISDIR，dry-run 亦會拋
    const blocked = path.join(repo, 'codex', 'AGENTS.md');
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(blocked, 'occupied.txt'), 'x');

    const r = runSync(repo, home, ['to-repo', '--dry-run']);

    assert.equal(r.status, 2, `dry-run 中途失敗仍應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /已寫入 \d+ 筆變更/, 'dry-run 不得宣稱已寫入');
    assert.equal(fs.existsSync(path.join(repo, 'claude', 'CLAUDE.md')), false,
      'dry-run 不得真的寫入 repo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('warnPartialApply：錯誤輸出不得 dump err.context.applied 物件', () => {
  const { root, repo, home } = setupSpawnSandbox();
  try {
    seedPartialFailure(repo, home);
    const r = runSync(repo, home, ['to-local', '--yes']);

    assert.doesNotMatch(r.stderr, /changeLog/, 'applied 物件須被刪除、不得出現在輸出');
    assert.doesNotMatch(r.stderr, /\[object Object\]/, '不得印出物件 dump');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
