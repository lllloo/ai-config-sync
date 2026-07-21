'use strict';

// =============================================================================
// 檔案系統／symlink 工具的單元測試：cleanEmptyDirs、symlinkWithFallback、
// createSymlinkAtomic、ensureSymlink，以及「部分失敗可見度」的兩個核心不變式
// mergeXtoolPartialChanges 與 warnPartialApply。
//
// 沙箱策略：把 sync.js（及其三個 runtime 相依檔）複製進 tmp 目錄當「repo」，並在
// require 之前把 process.env.HOME 指向另一個 tmp 目錄——sync.js 的 HOME／
// CLAUDE_SKILLS_HOME／AGENTS_SKILLS_HOME 等常數在 require 當下由 os.homedir()
// 求值，故 require 後模組內所有本機路徑都落在沙箱內，絕不觸碰真實 ~/.claude、
// ~/.agents、~/.codex。withSandbox 內有 os.homedir() 斷言把關這件事。
//
// 非匯出函式（cleanEmptyDirs／createSymlinkAtomic／symlinkWithFallback／
// mergeXtoolPartialChanges／warnPartialApply）刻意「經由其匯出的呼叫端」測，
// 不為了可測性去改 sync.js 的匯出或邏輯：
//   cleanEmptyDirs            ← mirrorDir
//   createSymlinkAtomic       ← ensureSymlink
//   symlinkWithFallback       ← ensureSymlink（Windows 分支以 stub 模擬）
//   mergeXtoolPartialChanges  ← applyXtoolItem（中途失敗）
//   warnPartialApply          ← spawn 真實 to-local（中途失敗）
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-fs-symlink-'));
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

/** 在沙箱 repo 內建立一個含 1.md／2.md 的 skill 來源目錄 */
function makeSkill(repo, name) {
  const dir = path.join(repo, 'agents', 'skills', name);
  writeText(path.join(dir, '1.md'), `${name}-one`);
  writeText(path.join(dir, '2.md'), `${name}-two`);
  return dir;
}

function xtoolItem(repo, home) {
  return {
    area: 'agents',
    label: 'skills',
    type: 'xtool-skills',
    src: path.join(repo, 'agents', 'skills'),
    dest: path.join(home, '.agents', 'skills'),
  };
}

/** 在 dest 佔位成目錄，讓 copyFile 讀取 dest 時得到 EISDIR、拋 SyncError */
function blockDest(home, skill, rel) {
  const p = path.join(home, '.agents', 'skills', skill, rel);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'occupied.txt'), 'x');
}

// -----------------------------------------------------------------------------
// mergeXtoolPartialChanges（經 applyXtoolItem）
// CLAUDE.md 明列的不變式：先前已完成 skill 的變更與 mirrorDir 附掛的「當前 skill
// 內部」變更**必須併入**，直接指派會抹掉其中一邊，讓已寫入磁碟的檔案零可見度。
// -----------------------------------------------------------------------------

test('mergeXtoolPartialChanges：兩邊都有內容時併入、不得抹掉任一邊', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'agents', 'skills');
    makeSkill(repo, 'alpha');
    makeSkill(repo, 'beta');
    // readdir 順序不保證字母序，故以實際順序決定「先完成的」與「失敗的」skill
    const [okName, failName] = sync.listSkillNames(src);
    const files = sync.getFiles(path.join(src, failName));
    // 失敗 skill 的第二個檔案才擋 → 第一個檔已寫入（inner 非空）
    blockDest(home, failName, files[1]);

    let err = null;
    try {
      sync.applyXtoolItem(xtoolItem(repo, home), 'to-repo', false);
    } catch (e) { err = e; }

    assert.ok(err instanceof sync.SyncError, '中途失敗應拋 SyncError');
    const rels = (err.context.partialChanges || []).map(c => c.rel);
    // 先前已完成的 skill（done 側）不得被抹掉
    assert.deepEqual(
      rels.filter(r => r.startsWith(`${okName}/`)).sort(),
      [`${okName}/1.md`, `${okName}/2.md`],
      'done 側（先前已完成 skill）的變更必須保留',
    );
    // 當前 skill 的內部變更（inner 側）亦不得被抹掉，且須補 <name>/ 前綴
    assert.ok(rels.includes(`${failName}/${files[0]}`),
      'inner 側（當前 skill 內部）的變更必須保留並補上 <name>/ 前綴');
    assert.equal(rels.length, 3, '併入後應為 done 2 筆 + inner 1 筆');
    assert.ok(rels.every(r => r.includes('/')), '所有 rel 都應帶 skill 名前綴');
  });
});

test('mergeXtoolPartialChanges：done 為空時仍保留 inner 並補 <name>/ 前綴', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'agents', 'skills');
    makeSkill(repo, 'solo'); // 只有一個 skill → 失敗前無已完成 skill
    const files = sync.getFiles(path.join(src, 'solo'));
    blockDest(home, 'solo', files[1]);

    let err = null;
    try {
      sync.applyXtoolItem(xtoolItem(repo, home), 'to-repo', false);
    } catch (e) { err = e; }

    assert.ok(err instanceof sync.SyncError);
    assert.deepEqual(
      (err.context.partialChanges || []).map(c => c.rel),
      [`solo/${files[0]}`],
      'inner 側單獨存在時仍須附掛且帶前綴',
    );
  });
});

test('mergeXtoolPartialChanges：inner 為空時保留 done（不得被空陣列覆寫）', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'agents', 'skills');
    makeSkill(repo, 'alpha');
    makeSkill(repo, 'beta');
    const [okName, failName] = sync.listSkillNames(src);
    const files = sync.getFiles(path.join(src, failName));
    // 擋住失敗 skill 的**第一個**檔案 → 該 skill 內部零變更，inner 為空
    blockDest(home, failName, files[0]);

    let err = null;
    try {
      sync.applyXtoolItem(xtoolItem(repo, home), 'to-repo', false);
    } catch (e) { err = e; }

    assert.ok(err instanceof sync.SyncError);
    assert.deepEqual(
      (err.context.partialChanges || []).map(c => c.rel).sort(),
      [`${okName}/1.md`, `${okName}/2.md`],
      'inner 為空時 done 側不得遺失',
    );
  });
});

test('mergeXtoolPartialChanges：已寫入的檔案確實落在磁碟上（可見度非虛報）', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'agents', 'skills');
    makeSkill(repo, 'alpha');
    makeSkill(repo, 'beta');
    const [okName, failName] = sync.listSkillNames(src);
    const files = sync.getFiles(path.join(src, failName));
    blockDest(home, failName, files[1]);

    try { sync.applyXtoolItem(xtoolItem(repo, home), 'to-repo', false); } catch (_) { /* expected */ }

    for (const rel of [`${okName}/1.md`, `${okName}/2.md`, `${failName}/${files[0]}`]) {
      assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', rel)),
        `回報為已寫入的 ${rel} 應真的存在於磁碟`);
    }
  });
});

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
  return { root, repo, home };
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

test('cleanEmptyDirs：dest 不存在時不拋例外', () => {
  withSandbox(({ sync, repo, home }) => {
    const src = path.join(repo, 'src');
    writeText(path.join(src, 'a.md'), 'a');
    const dest = path.join(home, 'never-existed');
    assert.doesNotThrow(() => sync.mirrorDir(src, dest, [], false));
  });
});

// -----------------------------------------------------------------------------
// ensureSymlink / createSymlinkAtomic（正常路徑）
// -----------------------------------------------------------------------------

test('ensureSymlink：不存在時建立 symlink（action added）', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    writeText(path.join(target, 'SKILL.md'), 'body');

    const res = sync.ensureSymlink(target, link, false);

    assert.deepEqual(res, { action: 'added' });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), '應建成 symlink 而非實體目錄');
    assert.equal(fs.readlinkSync(link), target, 'symlink 應指向 target');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'body',
      '經 symlink 應能讀到正典內容');
  });
});

test('ensureSymlink：已是正確 symlink 時回 null 且不重建（幂等）', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });
    sync.ensureSymlink(target, link, false);
    const before = fs.lstatSync(link).ino;

    assert.equal(sync.ensureSymlink(target, link, false), null, '幂等：第二次應回 null');
    assert.equal(fs.lstatSync(link).ino, before, 'symlink 不得被刪建（inode 應不變）');
  });
});

test('ensureSymlink：symlink 指向錯誤 target 時自我修復（action updated）', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const wrong = path.join(home, '.agents', 'skills', 'other');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(wrong, { recursive: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(wrong, link, 'dir');

    const res = sync.ensureSymlink(target, link, false);

    assert.deepEqual(res, { action: 'updated' });
    assert.equal(fs.readlinkSync(link), target, '應改指向正確 target');
  });
});

test('ensureSymlink：懸空 symlink 指向正確 target 時仍視為幂等（回 null）', () => {
  withSandbox(({ sync, home }) => {
    // 判斷一律走 lstat + readlink，不依賴 existsSync（懸空 link 對 existsSync 為 false）
    const target = path.join(home, '.agents', 'skills', 'not-yet');
    const link = path.join(home, '.claude', 'skills', 'not-yet');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'dir');
    assert.equal(fs.existsSync(link), false, '前提：此為懸空 symlink');

    assert.equal(sync.ensureSymlink(target, link, false), null,
      '懸空但指向正確 target 應不動它');
  });
});

test('ensureSymlink：懸空且指向錯誤 target 時重建', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(home, 'nowhere'), link, 'dir');

    const res = sync.ensureSymlink(target, link, false);

    assert.deepEqual(res, { action: 'updated' });
    assert.equal(fs.readlinkSync(link), target);
  });
});

test('ensureSymlink：真實目錄佔用時 rm 後改建 symlink（D5 轉換）', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    writeText(path.join(target, 'SKILL.md'), 'canon');
    writeText(path.join(link, 'SKILL.md'), 'old-real-dir');

    const res = sync.ensureSymlink(target, link, false);

    assert.deepEqual(res, { action: 'updated' });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), '真實目錄應被轉成 symlink');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'canon',
      '轉換後讀到的應是正典內容');
  });
});

test('ensureSymlink：真實檔案佔用時亦轉成 symlink', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });
    writeText(link, 'a plain file');

    const res = sync.ensureSymlink(target, link, false);

    assert.deepEqual(res, { action: 'updated' });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
  });
});

test('ensureSymlink：dry-run 回報 action 但不落地', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });

    assert.deepEqual(sync.ensureSymlink(target, link, true), { action: 'added' });
    assert.equal(fs.existsSync(path.dirname(link)), false, 'dry-run 不得建立任何路徑');

    // 真實目錄佔用的 dry-run：回報 updated，但不得刪掉本機目錄
    writeText(path.join(link, 'mine.md'), 'mine');
    assert.deepEqual(sync.ensureSymlink(target, link, true), { action: 'updated' });
    assert.equal(fs.readFileSync(path.join(link, 'mine.md'), 'utf8'), 'mine',
      'dry-run 不得刪除既有真實目錄');
  });
});

// -----------------------------------------------------------------------------
// createSymlinkAtomic / symlinkWithFallback（失敗路徑）
// -----------------------------------------------------------------------------

test('createSymlinkAtomic：父目錄不可寫時拋 SyncError 且不留暫存檔', { skip: process.getuid && process.getuid() === 0 ? 'root 無視權限' : false }, () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const parent = path.join(home, '.claude', 'skills');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(parent, { recursive: true });
    fs.chmodSync(parent, 0o500); // r-x：可讀不可寫
    try {
      assert.throws(
        () => sync.ensureSymlink(target, path.join(parent, 'demo'), false),
        (e) => e instanceof sync.SyncError && e.code === sync.ERR.PERMISSION,
      );
      assert.deepEqual(fs.readdirSync(parent), [], '失敗後不得殘留 .tmp 檔');
    } finally {
      fs.chmodSync(parent, 0o700);
    }
  });
});

test('createSymlinkAtomic：rename 失敗時清掉暫存 symlink 並拋 SyncError', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const parent = path.join(home, '.claude', 'skills');
    const link = path.join(parent, 'demo');
    fs.mkdirSync(target, { recursive: true });

    const origRename = fs.renameSync;
    fs.renameSync = () => { const e = new Error('boom'); e.code = 'EIO'; throw e; };
    try {
      assert.throws(
        () => sync.ensureSymlink(target, link, false),
        (e) => e instanceof sync.SyncError,
      );
    } finally {
      fs.renameSync = origRename;
    }
    assert.deepEqual(fs.readdirSync(parent).filter(n => n.includes('.tmp.')), [],
      'rename 失敗後暫存 symlink 須被清除');
    assert.equal(fs.existsSync(link), false, '失敗後不得留下半建的 link');
  });
});

test('symlinkWithFallback：非 Windows 平台 symlink 失敗時不提 junction', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });

    const origSymlink = fs.symlinkSync;
    fs.symlinkSync = () => { const e = new Error('nope'); e.code = 'EPERM'; throw e; };
    try {
      assert.throws(
        () => sync.ensureSymlink(target, link, false),
        (e) => e instanceof sync.SyncError && !/junction/i.test(e.message),
      );
    } finally {
      fs.symlinkSync = origSymlink;
    }
  });
});

// -----------------------------------------------------------------------------
// Windows junction fallback
// process.platform 與 fs.symlinkSync 皆以 stub 模擬——sync.js 於呼叫當下才讀
// process.platform，且與測試共用同一個 node:fs 模組實例，故無需真的在 Windows 上跑，
// 也不必為可測性改動 sync.js。
// -----------------------------------------------------------------------------

/** 暫時把 process.platform 假冒成 win32 */
function withPlatform(platform, fn) {
  const desc = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', desc); }
}

/** 暫時替換 fs.symlinkSync */
function withSymlinkStub(stub, fn) {
  const orig = fs.symlinkSync;
  fs.symlinkSync = stub;
  try { return fn(); } finally { fs.symlinkSync = orig; }
}

test('symlinkWithFallback：Windows 下 dir symlink 失敗時退回 junction 並成功', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    writeText(path.join(target, 'SKILL.md'), 'body');

    const origSymlink = fs.symlinkSync;
    const types = [];
    const stub = (t, p, type) => {
      types.push(type);
      // 模擬 Windows 無開發者模式：dir symlink 需權限而失敗，junction 免權限成功
      if (type === 'dir') { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; }
      return origSymlink(t, p, 'dir'); // Linux 無 junction，以一般 symlink 代行
    };

    const res = withPlatform('win32', () => withSymlinkStub(stub, () =>
      sync.ensureSymlink(target, link, false)));

    assert.deepEqual(res, { action: 'added' });
    assert.deepEqual(types, ['dir', 'junction'], '應先試 dir、失敗後才試 junction');
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'fallback 後連結應建立完成');
  });
});

test('symlinkWithFallback：Windows 下 dir 與 junction 皆失敗時拋權限不足 SyncError', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });

    const stub = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };

    assert.throws(
      () => withPlatform('win32', () => withSymlinkStub(stub, () =>
        sync.ensureSymlink(target, link, false))),
      (e) => e instanceof sync.SyncError
        && e.code === sync.ERR.IO_ERROR
        && /junction/.test(e.message)
        && /Windows/.test(e.message),
      'Windows 雙重失敗應給出可辨識的權限不足訊息',
    );
    assert.equal(fs.existsSync(link), false, '失敗後不得留下半建的 link');
  });
});

test('symlinkWithFallback：Windows 錯誤訊息以 ~ 遮罩 HOME、不洩漏使用者路徑', () => {
  withSandbox(({ sync, home }) => {
    const target = path.join(home, '.agents', 'skills', 'demo');
    const link = path.join(home, '.claude', 'skills', 'demo');
    fs.mkdirSync(target, { recursive: true });
    const stub = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };

    try {
      withPlatform('win32', () => withSymlinkStub(stub, () =>
        sync.ensureSymlink(target, link, false)));
      assert.fail('應拋錯');
    } catch (e) {
      assert.ok(!e.message.includes(home), `訊息不得含 HOME 絕對路徑：${e.message}`);
      assert.match(e.message, /~[/\\]\.claude/, '路徑應以 ~ 遮罩');
    }
  });
});
