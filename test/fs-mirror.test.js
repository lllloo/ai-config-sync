'use strict';

// =============================================================================
// 目錄鏡射與「部分失敗可見度」的單元測試：cleanEmptyDirs、mirrorDir 與 warnPartialApply。
//
// 沙箱策略：把 sync.js（及其三個 runtime 相依檔）複製進 tmp 目錄當「repo」，並在
// require 之前把 process.env.HOME 指向另一個 tmp 目錄——sync.js 的 HOME／CLAUDE_HOME
// 等常數在 require 當下由 os.homedir() 求值，故 require 後模組內所有本機路徑都落在
// 沙箱內，絕不觸碰真實 ~/.claude、~/.codex。withSandbox 內有 os.homedir() 斷言把關這件事。
//
// 非匯出函式（cleanEmptyDirs／warnPartialApply）刻意「經由其匯出的呼叫端」測，
// 不為了可測性去改 sync.js 的匯出或邏輯：
//   cleanEmptyDirs   ← mirrorDir
//   warnPartialApply ← spawn 真實 to-local（中途失敗）
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

/**
 * 建立沙箱 repo + HOME，於 HOME 生效後 require 沙箱內的 sync.js 副本。
 * @template T
 * @param {(ctx: {sync: object, repo: string, home: string}) => T} fn
 * @returns {T}
 */
function withSandbox(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-fs-mirror-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  for (const name of SYNC_RUNTIME_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(repo, name));
  }
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    // 守門：確認沙箱 HOME 真的生效，否則後續寫入會落到真實 HOME
    assert.equal(os.homedir(), home, '沙箱 HOME 未生效，中止以免寫入真實 HOME');
    assert.notEqual(os.homedir(), REAL_HOME, '沙箱 HOME 不得等於真實 HOME');
    const sync = require(path.join(repo, 'sync.js'));
    return fn({ sync, repo, home });
  } finally {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origUserProfile;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

// -----------------------------------------------------------------------------
// warnPartialApply（經 spawn 真實 to-local）
// -----------------------------------------------------------------------------

/** 建立可 spawn 的沙箱（不改本行程 env） */
function setupSpawnSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-fs-spawn-'));
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
 * （withSandbox 的 os.homedir() 斷言是同一道保護的 in-process 版本。）
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
 * 佈置一個「先寫成功幾筆、再中途失敗」的 to-local：rules 目錄有兩個檔案，
 * 其中一個的本機落點被目錄佔用（copyFile 讀 dest 得 EISDIR）。
 */
function seedPartialFailure(repo, home) {
  writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-CLAUDE');
  writeText(path.join(repo, 'claude', 'rules', 'a.md'), 'rule-a');
  writeText(path.join(repo, 'claude', 'rules', 'b.md'), 'rule-b');
  const blocked = path.join(home, '.claude', 'rules', 'b.md');
  fs.mkdirSync(blocked, { recursive: true });
  fs.writeFileSync(path.join(blocked, 'occupied.txt'), 'x');
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
    writeText(path.join(home, '.claude', 'rules', 'a.md'), 'rule-a');
    writeText(path.join(home, '.claude', 'rules', 'b.md'), 'rule-b');
    // repo 端落點被目錄佔用 → copyFile 讀 dest 得 EISDIR，dry-run 亦會拋
    const blocked = path.join(repo, 'claude', 'rules', 'b.md');
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

// -----------------------------------------------------------------------------
// cleanEmptyDirs（經 mirrorDir）
// -----------------------------------------------------------------------------

test('cleanEmptyDirs：prune 後遞迴清除多層空目錄', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'src');
    const dest = path.join(home, 'dest');
    writeText(path.join(src, 'keep.md'), 'keep');
    // dest 有 src 沒有的巢狀檔案 → 會被 prune，留下的空目錄需被遞迴清除
    writeText(path.join(dest, 'deep', 'deeper', 'gone.md'), 'gone');

    const changed = sync.mirrorDir(src, dest, [], false);

    assert.ok(changed.some(c => c.action === 'deleted'), '殘檔應被 prune');
    assert.equal(fs.existsSync(path.join(dest, 'deep', 'deeper')), false, '最內層空目錄應被清除');
    assert.equal(fs.existsSync(path.join(dest, 'deep')), false, '外層空目錄應一併被清除');
    assert.equal(fs.existsSync(path.join(dest, 'keep.md')), true, 'dest 根目錄本身保留');
  });
});

test('cleanEmptyDirs：仍有檔案的目錄不得被刪', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'src');
    const dest = path.join(home, 'dest');
    writeText(path.join(src, 'sub', 'stay.md'), 'stay');
    writeText(path.join(dest, 'sub', 'stay.md'), 'stay');
    writeText(path.join(dest, 'sub', 'gone.md'), 'gone');

    sync.mirrorDir(src, dest, [], false);

    assert.equal(fs.existsSync(path.join(dest, 'sub', 'gone.md')), false, '殘檔應被刪');
    assert.equal(fs.existsSync(path.join(dest, 'sub', 'stay.md')), true, '非空目錄不得被清除');
  });
});

test('cleanEmptyDirs：dry-run 不清理空目錄', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'src');
    const dest = path.join(home, 'dest');
    writeText(path.join(src, 'keep.md'), 'keep');
    writeText(path.join(dest, 'keep.md'), 'keep');
    fs.mkdirSync(path.join(dest, 'empty', 'nested'), { recursive: true });

    sync.mirrorDir(src, dest, [], true);

    assert.equal(fs.existsSync(path.join(dest, 'empty', 'nested')), true,
      'dry-run 不得動到磁碟');
  });
});

// 註：`cleanEmptyDirs` 開頭的 `if (!fs.existsSync(dir)) return` 從公開入口不可達
// ——唯一呼叫端 mirrorDir 在此之前已 ensureDir(dest) 且包在 `if (existsSync(dest))`
// 內，遞迴呼叫傳的也是剛由 readdir 列出的子目錄。它只防「呼叫與檢查之間目錄被外部
// 刪除」的 race，無法從測試決定性觸發（`assert.doesNotThrow(mirrorDir(...))` 只是
// 走了正常路徑，刪掉那行仍全綠）。故此測試改測真正能保證的事：全新 dest 的建立。
test('mirrorDir：dest 為全新路徑時建立目錄並寫入來源檔（不拋例外）', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'src');
    writeText(path.join(src, 'a.md'), 'a');
    writeText(path.join(src, 'nested', 'b.md'), 'b');
    const dest = path.join(home, 'never-existed');
    assert.equal(fs.existsSync(dest), false, '前提：dest 尚不存在');

    let changed;
    assert.doesNotThrow(() => { changed = sync.mirrorDir(src, dest, [], false); });

    assert.deepEqual(changed.map(c => c.action).sort(), ['added', 'added'],
      '兩個來源檔皆應回報 added');
    assert.equal(fs.readFileSync(path.join(dest, 'a.md'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(dest, 'nested', 'b.md'), 'utf8'), 'b',
      '巢狀來源檔亦須落地，且其目錄不得被空目錄清理誤刪');
  });
});
