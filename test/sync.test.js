'use strict';

// =============================================================================
// sync.js 純函式單元測試（使用 Node.js 內建 node:test，零外部相依）
// 執行方式：node --test 或 npm test
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  diffFile,
  diffFileItem,
  diffSyncItems,
  printToLocalPreview,
  readJson,
  statusToStatsKey,
  parseArgs,
  toRelativePath,
  buildSyncItems,
  materializeSyncItem,
  getFiles,
  SYNC_MANIFEST,
  SYNC_AREAS,
  SyncError,
  ERR,
  COMMANDS,
  COMMAND_ALIASES,
  DEVICE_SETTINGS_KEYS,
  KEYED_NOTICE_SETTINGS_KEYS,
  isWsl,
  winPathToWslPath,
  detectWinHome,
  resolveWinHome,
} = require('../sync.js');
const {
  CODEX_CONFIG_HARD_BLOCK_SECTIONS,
  CODEX_CONFIG_DEVICE_WARN_SECTIONS,
  SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES,
  SAFETY_SCAN_DIRS,
} = require('../safety-check.js');
const { withArgv, withTmpDir, withTmpFile, itPosixPerms } = require('./helpers');

// -----------------------------------------------------------------------------
// statusToStatsKey
// -----------------------------------------------------------------------------
test('statusToStatsKey：new→added、changed→updated；deleted 不計入（copyFile 不刪 dest）', () => {
  assert.equal(statusToStatsKey('new'), 'added');
  assert.equal(statusToStatsKey('changed'), 'updated');
  assert.equal(statusToStatsKey('deleted'), null);
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

test('parseArgs：--yes / --force 設定 yes 旗標', () => {
  assert.equal(withArgv(['to-local', '--yes'], () => parseArgs()).yes, true);
  assert.equal(withArgv(['to-local', '--force'], () => parseArgs()).yes, true);
  assert.equal(withArgv(['to-local'], () => parseArgs()).yes, false);
});

test('parseArgs：未知旗標（含 typo）拋 INVALID_ARGS 而非靜默忽略', () => {
  // 安全關鍵：--dry-run 打錯字不得被當成 no-op 而略過預覽真寫入
  for (const bad of ['--dryrun', '--dri-run', '--unknown', '-x']) {
    assert.throws(
      () => withArgv(['to-repo', bad], () => parseArgs()),
      (e) => e instanceof SyncError && e.code === ERR.INVALID_ARGS,
      `應對 ${bad} 拋 INVALID_ARGS`,
    );
  }
});

test('parseArgs：skills:add 的 --agent 原樣轉入 extraArgs（npm run 會吃掉 -- 分隔符）', () => {
  // 回歸：npm run skills:add -- foo org/repo --agent codex 到 sync.js 時 argv 已無 `--`，
  // --agent 曾被未知旗標白名單擋下，README 記載的用法整條不可用
  assert.deepEqual(
    withArgv(['skills:add', 'foo', 'org/repo', '--agent', 'codex'], () => parseArgs()).extraArgs,
    ['foo', 'org/repo', '--agent', 'codex'],
  );
  assert.deepEqual(
    withArgv(['sa', '--agent=claude-code', 'foo', 'org/repo'], () => parseArgs()).extraArgs,
    ['--agent=claude-code', 'foo', 'org/repo'],
  );
});

test('parseArgs：--agent 只對 skills:add 放行，其他指令仍拋 INVALID_ARGS', () => {
  for (const argv of [['to-local', '--agent', 'codex'], ['to-repo', '--agent=codex'], ['--agent', 'codex', 'skills:add']]) {
    assert.throws(
      () => withArgv(argv, () => parseArgs()),
      (e) => e instanceof SyncError && e.code === ERR.INVALID_ARGS,
      `應對 ${argv.join(' ')} 拋 INVALID_ARGS`,
    );
  }
});

test('parseArgs：--no-color 設定 noColor 旗標', () => {
  assert.equal(withArgv(['diff', '--no-color'], () => parseArgs()).noColor, true);
  assert.equal(withArgv(['diff'], () => parseArgs()).noColor, false);
});

test('parseArgs：-v 為 --version 別名', () => {
  assert.equal(withArgv(['-v'], () => parseArgs()).showVersion, true);
});

test('materializeSyncItem：非 fixedFlow 依方向交換 src/dest', () => {
  const entry = { area: 'codex', label: 'AGENTS.md', type: 'file' };
  const toRepo = materializeSyncItem(entry, 'to-repo');
  assert.equal(toRepo.label, 'AGENTS.md');
  assert.equal(toRepo.type, 'file');
  assert.equal(toRepo.prefix, 'codex/');
  // to-repo：home→repo
  assert.match(toRepo.src, /[\\/]\.codex[\\/]AGENTS\.md$/);
  assert.match(toRepo.dest, /[\\/]codex[\\/]AGENTS\.md$/);
  const toLocal = materializeSyncItem(entry, 'to-local');
  // to-local：repo→home（src/dest 對調）
  assert.equal(toLocal.src, toRepo.dest);
  assert.equal(toLocal.dest, toRepo.src);
});

test('materializeSyncItem：fixedFlow 項目 src/dest 不隨方向交換', () => {
  const entry = { area: 'claude', label: 'settings.json', type: 'settings', fixedFlow: true };
  const toRepo = materializeSyncItem(entry, 'to-repo');
  const toLocal = materializeSyncItem(entry, 'to-local');
  // fixedFlow：src 恆為本機端、dest 恆為 repo 端
  assert.equal(toLocal.src, toRepo.src);
  assert.equal(toLocal.dest, toRepo.dest);
  assert.match(toRepo.src, /[\\/]\.claude[\\/]settings\.json$/);
  assert.match(toRepo.dest, /[\\/]claude[\\/]settings\.json$/);
});

test('buildSyncItems：manifest 順序保留、fixedFlow 項目雙向 src/dest 一致', () => {
  const labels = SYNC_MANIFEST.map(e => e.label);
  const repoItems = buildSyncItems('to-repo');
  const localItems = buildSyncItems('to-local');
  // 順序與數量鎖定 manifest
  assert.deepEqual(repoItems.map(i => i.label), labels);
  assert.equal(repoItems.length, SYNC_MANIFEST.length);
  // 每列 materialize 出的 type 與 manifest 對齊；fixedFlow 項目雙向路徑相同、非 fixedFlow 對調
  SYNC_MANIFEST.forEach((entry, i) => {
    assert.equal(repoItems[i].type, entry.type);
    if (entry.fixedFlow) {
      assert.equal(localItems[i].src, repoItems[i].src);
      assert.equal(localItems[i].dest, repoItems[i].dest);
    } else {
      assert.equal(localItems[i].src, repoItems[i].dest);
      assert.equal(localItems[i].dest, repoItems[i].src);
    }
  });
});

// -----------------------------------------------------------------------------
// area 產出 drift-guard
// -----------------------------------------------------------------------------
// label 清單鎖：恢復 claude/skills 或 codex/agents 等同步層時須一併更新此處期望值
// （CLAUDE.md「日後若要恢復…」兩段點名本測試）。
test('drift-guard：claude／codex／gemini 各 area 的 label 清單與順序鎖定', () => {
  for (const direction of ['to-repo', 'to-local']) {
    const items = buildSyncItems(direction);
    const byArea = (prefix) => items.filter(i => i.prefix === prefix).map(i => i.label);
    assert.deepEqual(byArea('claude/'),
      ['CLAUDE.md', 'settings.json', 'statusline.sh']);
    assert.deepEqual(byArea('codex/'), ['AGENTS.md']);
    assert.deepEqual(byArea('gemini/'), ['GEMINI.md']);
  }
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

test('COMMAND_ALIASES：別名應對應回正式指令', () => {
  for (const [alias, cmd] of Object.entries(COMMAND_ALIASES)) {
    assert.ok(COMMANDS[cmd], `別名 ${alias} -> ${cmd} 應存在於 COMMANDS`);
    assert.equal(COMMANDS[cmd].alias, alias);
  }
});

test('COMMANDS：safety:check 指令存在且無別名', () => {
  assert.ok(COMMANDS['safety:check'], 'COMMANDS 應含 safety:check');
  assert.equal(COMMANDS['safety:check'].alias, null, 'safety:check 無別名');
  assert.ok(COMMANDS['safety:check'].desc, 'safety:check 應有 desc');
});

// -----------------------------------------------------------------------------
// README drift-guard：修改守則要求「改指令／黑名單須同步 README」，此鏈原本
// 只靠人工守則、零測試把關（git log 反覆出現事後補 docs 的 commit）。
// 此組測試把同步鏈變成紅燈：常數增減而 README／package.json 未跟上即 fail。
// 只斷言「有載明」（字面出現），不斷言周邊敘述——避免測試綁死文案措辭。
// -----------------------------------------------------------------------------
const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('README drift-guard：指令別名表涵蓋 COMMANDS 全部指令與別名', () => {
  for (const [cmd, def] of Object.entries(COMMANDS)) {
    if (cmd === 'help') continue; // help 為 CLI 自述指令，README 不列表
    const row = `| \`${cmd}\` | ${def.alias ? `\`${def.alias}\`` : '—'} |`;
    assert.ok(README.includes(row), `README 指令別名表缺列或別名不同步：${row}`);
  }
});

test('README drift-guard：package.json scripts 與 COMMANDS 雙向一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const cmd of Object.keys(COMMANDS)) {
    if (cmd === 'help') continue; // help 走 node sync.js help／--help，不設 npm script
    assert.equal(pkg.scripts[cmd], `node sync.js ${cmd}`,
      `package.json scripts 缺 "${cmd}" 或未指向 node sync.js ${cmd}`);
  }
  for (const [name, script] of Object.entries(pkg.scripts)) {
    const m = script.match(/^node sync\.js (\S+)$/);
    if (m) assert.ok(COMMANDS[m[1]], `npm script "${name}" 指向未登錄指令：${m[1]}`);
  }
});

test('README drift-guard：DEVICE_SETTINGS_KEYS 黑名單欄位皆載於 README', () => {
  for (const key of DEVICE_SETTINGS_KEYS) {
    assert.ok(README.includes(`\`${key}\``), `README 未載明 settings 黑名單欄位：${key}`);
  }
});

test('README drift-guard：KEYED_NOTICE_SETTINGS_KEYS 欄位皆載於 README', () => {
  for (const key of KEYED_NOTICE_SETTINGS_KEYS) {
    assert.ok(README.includes(`\`${key}\``), `README 未載明鍵級提示欄位：${key}`);
  }
  assert.ok(README.includes('KEYED_NOTICE_SETTINGS_KEYS'), 'README 未載明 KEYED_NOTICE_SETTINGS_KEYS 常數名');
});

test('README drift-guard：codex 機密／裝置狀態 section 清單皆載於 README', () => {
  for (const prefix of CODEX_CONFIG_HARD_BLOCK_SECTIONS) {
    assert.ok(README.includes(`\`${prefix}`), `README 未載明 codex 機密 section：${prefix}`);
  }
  for (const prefix of CODEX_CONFIG_DEVICE_WARN_SECTIONS) {
    assert.ok(README.includes(`\`${prefix}`), `README 未載明 codex 裝置狀態 warning section：${prefix}`);
  }
});

// CLAUDE.md 修改守則宣稱「增減排除目錄須改常數與 README（drift-guard 測試把關）」，
// 此測試讓該宣稱成真：SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES 增減未跟 README 即 fail。
test('README drift-guard：safety text 掃描排除目錄皆載於 README', () => {
  for (const prefix of SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES) {
    assert.ok(README.includes(`\`${prefix}\``), `README 未載明 text 掃描排除目錄：${prefix}`);
  }
});

// 5.5 drift-guard：safety 掃描來源目錄（SAFETY_SCAN_DIRS）增減須跟 README
test('README drift-guard：safety 掃描來源目錄皆載於 README', () => {
  for (const dir of SAFETY_SCAN_DIRS) {
    assert.ok(README.includes(`\`${dir}/\``), `README 未載明 safety 掃描來源目錄：${dir}/`);
  }
});

// -----------------------------------------------------------------------------
// 旗標 drift-guard：CLI 旗標清單目前手抄三處——`parseArgs` 白名單、`runHelp` 的
// 旗標輸出、README 旗標表——彼此無守門，新增旗標時漏改後兩者不會紅燈（指令別名
// 已有上方那組守門，旗標則否）。此組測試以 `parseArgs` 白名單為單一事實來源，
// 反向斷言另外兩處逐一涵蓋。`runHelp` 未匯出，故與 README 一樣走原始碼字面比對。
// 同一個 else if 分支內的旗標視為一組（首個為正名、其餘為別名，如 --yes/--force）。
// -----------------------------------------------------------------------------
const SYNC_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');

/** 取出 sync.js 中某個 top-level 函式的原始碼（以行首 `}` 為結尾） */
function sliceFunctionSource(name) {
  const start = SYNC_SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到 ${name} 函式原始碼`);
  const end = SYNC_SOURCE.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} 函式原始碼未正常結束`);
  return SYNC_SOURCE.slice(start, end);
}

/**
 * 掃 `parseArgs` **整個函式體**的旗標字面，以 `||` 相鄰者為同一組
 * （首個為正名、其餘為別名，如 `--yes`／`--force`）。
 *
 * 刻意不綁 `else if` 結構、也不綁單引號：舊版抽取器兩者皆綁，因而
 * (a) 漏報——雙引號寫的旗標、或寫在 else-if 鏈外（如迴圈開頭 `if (…) continue;`）
 *     的旗標一律抓不到，漏改 README 仍全綠；
 * (b) 誤報——把 `--yes || --force` 拆成兩個等價 else if（行為與 README 皆不變）
 *     會讓 README 條假紅燈。
 * 對應地，README／runHelp 的斷言只要求「每個旗標都被提及」，不要求正名各佔一列，
 * 否則同一個誤報會從抽取器搬到斷言。
 * @param {string} source - parseArgs 原始碼
 * @returns {string[][]} 旗標組，如 [['--dry-run'], ['--yes', '--force'], ...]
 */
function extractFlagGroups(source) {
  const groups = [];
  let prevEnd = -1;
  for (const m of source.matchAll(/arg\s*===\s*(['"])(-[^'"]+)\1/g)) {
    const gap = prevEnd === -1 ? null : source.slice(prevEnd, m.index);
    prevEnd = m.index + m[0].length;
    // `--` 是引數分隔符而非旗標，不列入（README 旗標表亦不收）
    if (m[2] === '--') continue;
    // 兩個比較之間只隔 `||`／空白／括號 → 同一個條件式，視為別名同組
    if (gap !== null && /\|\|/.test(gap) && /^[\s()|]*$/.test(gap)) {
      groups[groups.length - 1].push(m[2]);
    } else {
      groups.push([m[2]]);
    }
  }
  return groups;
}

/** parseArgs 白名單旗標組：[['--dry-run'], ['--yes', '--force'], ...] */
const FLAG_GROUPS = extractFlagGroups(sliceFunctionSource('parseArgs'));

/** 旗標字面比對：`-h` 不可被 `--help` 的尾段誤命中，故兩側須為非 [\w-] */
function mentionsFlag(text, flag) {
  return new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(text);
}

// 抽取器若因 parseArgs 重構而抓不到東西，上述兩條守門會靜默全過；此測試守住抽取器本身
test('旗標 drift-guard：parseArgs 白名單抽取結果合理（守住抽取器本身）', () => {
  assert.ok(FLAG_GROUPS.length >= 6, `parseArgs 白名單旗標組過少：${FLAG_GROUPS.length}`);
  for (const [canonical] of FLAG_GROUPS) {
    assert.match(canonical, /^--[a-z][a-z-]*$/, `旗標正名應為長格式：${canonical}`);
  }
  const all = FLAG_GROUPS.flat();
  for (const flag of ['--dry-run', '--yes', '--force', '--version', '--help']) {
    assert.ok(all.includes(flag), `parseArgs 白名單抽取遺漏已知旗標：${flag}`);
  }
});

test('旗標 drift-guard：--help 輸出涵蓋 parseArgs 白名單全部旗標（含別名）', () => {
  const helpSource = sliceFunctionSource('runHelp');
  for (const [canonical, ...aliases] of FLAG_GROUPS) {
    assert.ok(mentionsFlag(helpSource, canonical), `runHelp 未列出旗標：${canonical}`);
    for (const alias of aliases) {
      assert.ok(mentionsFlag(helpSource, alias),
        `runHelp 未載明 ${canonical} 的別名：${alias}`);
    }
  }
});

test('旗標 drift-guard：README 旗標表涵蓋 parseArgs 白名單全部旗標（含別名）', () => {
  const section = README.slice(README.indexOf('### 旗標'));
  const table = section.slice(0, section.indexOf('\n## '));
  assert.ok(table.includes('| 旗標 | 說明 |'), 'README 找不到旗標表');
  // 只要求「被旗標表提及」，不要求正名各佔一列：等價的 else-if 拆分（別名獨立成組）
  // 不改變行為也不該逼 README 改寫，硬性要求獨立列會製造假紅燈
  for (const [canonical, ...aliases] of FLAG_GROUPS) {
    assert.ok(mentionsFlag(table, canonical), `README 旗標表未載明旗標：${canonical}`);
    for (const alias of aliases) {
      assert.ok(mentionsFlag(table, alias),
        `README 旗標表未載明 ${canonical} 的別名：${alias}`);
    }
  }
});

test('SYNC_AREAS：gemini area 對應 ~/.gemini，repoDir/prefix 正確', () => {
  const g = SYNC_AREAS.gemini;
  assert.ok(g, 'gemini area 應存在');
  assert.match(g.homeBase, /[\\/]\.gemini$/);
  assert.equal(g.repoDir, 'gemini');
  assert.equal(g.prefix, 'gemini/');
});

test('SYNC_MANIFEST：gemini/GEMINI.md 為 file 型', () => {
  const idx = SYNC_MANIFEST.findIndex(e => e.area === 'gemini' && e.label === 'GEMINI.md');
  assert.ok(idx >= 0, 'SYNC_MANIFEST 應含 gemini/GEMINI.md 列');
  assert.equal(SYNC_MANIFEST[idx].type, 'file');
});

// 回歸鎖：目錄型同步（整目錄鏡射 + prune 多餘檔）已整個移除。它曾與 npx skills 在
// ~/.claude/skills 建的探索 symlink 競爭（prune 會刪它），commands 層則違反「一律使用
// skill、不再新增 command」政策。要恢復任何目錄層須先重新設計，不得只塞回一列 manifest。
test('SYNC_MANIFEST 回歸鎖：type 只能是 file／settings（目錄型已移除）', () => {
  for (const e of SYNC_MANIFEST) {
    assert.ok(['file', 'settings'].includes(e.type),
      `SYNC_MANIFEST 列 ${e.area}/${e.label} 的 type「${e.type}」不在 file／settings 之內`);
  }
});

test('SYNC_MANIFEST 回歸鎖：不得含 claude 區的 skills／commands 列', () => {
  for (const label of ['skills', 'commands']) {
    const found = SYNC_MANIFEST.find(e => e.area === 'claude' && e.label === label);
    assert.equal(found, undefined, `SYNC_MANIFEST 不應含 claude/${label} 列`);
  }
});

test('README drift-guard：全域 skill 落點 skills/ 與 npx skills 安裝方式載於 README', () => {
  assert.ok(README.includes('`skills/`'), 'README 未載明 repo 路徑 skills/');
  assert.ok(README.includes('npx skills add'), 'README 未載明全域 skill 以 npx skills add 安裝');
  assert.ok(!README.includes('`agents/skills/`'), 'README 不得再引用已移除的 agents/skills/');
});

// codex config.toml 已不再同步：SYNC_MANIFEST 不得再出現該列（回歸鎖）
test('drift-guard：SYNC_MANIFEST 不含 codex config.toml', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.label === 'config.toml'), false,
    'codex config.toml 已移除同步，不應重新出現在 SYNC_MANIFEST');
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'codex-config'), false,
    'codex-config 型別已移除');
});

// MCP 同步已整批移除，待重新設計。
// 回歸鎖：兩種 MCP 型別皆不得復活——`mcp` 會投影寫入 config.toml、`advisory` 會讀本機
// 設定產生建議指令；重新設計時應開新 change 明確決定形狀，而非讓舊型別悄悄回來。
test('drift-guard：MCP 型別（mcp／advisory）皆不得復活', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'mcp'), false,
    'type:\'mcp\'（TOML section 投影寫入）已移除，不得重新出現');
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'advisory'), false,
    'type:\'advisory\'（MCP 諮詢式比對）已移除，不得重新出現');
});

// 跨工具全域 skill 同步（xtool-dir 型）已整批移除：
// 自寫全域 skill 改放 repo 頂層 skills/、經 npx skills add -g 安裝，sync.js 不再寫入
// ~/.agents/skills／~/.claude/skills／~/.gemini/config/skills。回歸鎖：型別、agents 同步區、
// 模組 require 與 type switch 分支皆不得復活——共管同一目錄的守門成本正是撤除的理由。
test('drift-guard：xtool-dir 型別與 agents 同步區皆不得復活', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'xtool-dir'), false,
    'type:\'xtool-dir\'（跨工具全域 skill 共管同步）已移除，不得重新出現');
  assert.equal(SYNC_MANIFEST.some(e => e.area === 'agents'), false,
    'agents 同步區已移除，SYNC_MANIFEST 不得再有 area:\'agents\' 列');
  assert.equal(Object.prototype.hasOwnProperty.call(SYNC_AREAS, 'agents'), false,
    'SYNC_AREAS 不得再有 agents 區（~/.agents 不由 sync.js 寫入）');
  assert.equal(/require\(['"]\.\/xtool-dir(\.js)?['"]\)/.test(SYNC_SOURCE), false,
    'sync.js 不得 require xtool-dir.js（模組已刪除）');
  for (const fn of ['diffSyncItem', 'applySyncItem']) {
    assert.equal(sliceFunctionSource(fn).includes("case 'xtool-dir'"), false,
      `${fn} 不得保留 case 'xtool-dir'`);
  }
});

// 回歸鎖：MCP 的 repo 來源與本機目標皆已移除，manifest 不得再指向它們
test('drift-guard：SYNC_MANIFEST 不含 MCP 來源列', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.label === 'mcp.json'), false,
    'claude/mcp.json 與 codex/mcp.json 已刪除，不應出現在 SYNC_MANIFEST');
  // 以 materialize 後的實際路徑判斷（不綁特定欄位名），任何機制指向 ~/.claude.json 都會被擋
  const claudeJson = path.join(os.homedir(), '.claude.json');
  for (const entry of SYNC_MANIFEST) {
    const item = materializeSyncItem(entry, 'to-local');
    assert.ok(item.src !== claudeJson && item.dest !== claudeJson,
      '~/.claude.json 為高風險敏感活檔，不得再被任何 manifest 列指向');
  }
});

// -----------------------------------------------------------------------------
// diffFile：src 缺失 vs dest 缺失的對稱性
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

test('diffFileItem：repo 缺來源檔 → deleted', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo-missing.md');
    const dest = path.join(dir, 'local.md');
    fs.writeFileSync(dest, 'local content');
    const entry = diffFileItem({ src, dest, label: 'CLAUDE.md', prefix: 'claude/' });
    assert.equal(entry.status, 'deleted');
  });
});

test('printToLocalPreview：deleted 只提示本機保留、不計入統計', () => {
  const stats = printToLocalPreview([
    { status: 'deleted', label: 'codex/AGENTS.md' },
    { status: 'new', label: 'gemini/GEMINI.md' },
  ]);
  assert.deepEqual(stats, { added: 1, updated: 0 });
});

// --- diffFileItem：deleted 以外的分支 ---------------------------------------

test('diffFileItem：dest 缺檔 → new', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo.md');
    const dest = path.join(dir, 'local-missing.md');
    fs.writeFileSync(src, 'repo content');
    const entry = diffFileItem({ src, dest, label: 'CLAUDE.md', prefix: 'claude/' });
    assert.equal(entry.status, 'new');
    assert.equal(entry.itemType, 'file');
    assert.equal(entry.label, 'claude/CLAUDE.md');
  });
});

test('diffFileItem：兩端內容相同 → status 為 null（無差異）', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo.md');
    const dest = path.join(dir, 'local.md');
    fs.writeFileSync(src, 'same');
    fs.writeFileSync(dest, 'same');
    const entry = diffFileItem({ src, dest, label: 'CLAUDE.md', prefix: 'claude/' });
    assert.equal(entry.status, null);
  });
});

// --- diffSyncItems：依 type 分派（一項一筆、未知型別拋錯） ---------------------

test('diffSyncItems：file 型各產出 1 筆，順序為 manifest 順序', () => {
  withTmpDir((dir) => {
    const aSrc = path.join(dir, 'repo.md');
    const aDest = path.join(dir, 'local.md');
    fs.writeFileSync(aSrc, 'A');
    fs.writeFileSync(aDest, 'B'); // changed
    const bSrc = path.join(dir, 'repo-agents.md');
    fs.writeFileSync(bSrc, 'new file'); // new（dest 無）

    const items = [
      { type: 'file', src: aSrc, dest: aDest, label: 'CLAUDE.md', prefix: 'claude/' },
      { type: 'file', src: bSrc, dest: path.join(dir, 'local-agents.md'), label: 'AGENTS.md', prefix: 'codex/' },
    ];
    const result = diffSyncItems(items, 'to-repo');
    assert.deepEqual(
      result.map(d => ({ label: d.label, status: d.status })),
      [
        { label: 'claude/CLAUDE.md', status: 'changed' },
        { label: 'codex/AGENTS.md', status: 'new' },
      ],
    );
  });
});

test('diffSyncItems：未知 type 拋 SyncError，不靜默略過', () => {
  assert.throws(
    () => diffSyncItems([{ type: 'unknown', src: '/s', dest: '/d', label: 'x', prefix: 'claude/' }], 'to-repo'),
    /未知的同步項目型別：unknown/,
  );
});

// --- printToLocalPreview：changed / eol 皆映射為 updated -----------------------

test('printToLocalPreview：changed 與 eol 皆計入 updated', () => {
  const stats = printToLocalPreview([
    { status: 'changed', label: 'claude/CLAUDE.md' },
    { status: 'eol', label: 'claude/statusline.sh' },
    { status: 'new', label: 'gemini/GEMINI.md' },
  ]);
  assert.deepEqual(stats, { added: 1, updated: 2 });
});

// --- readJson：檔案不存在 vs 正常解析（解析失敗不洩漏密鑰見 boundary.test.js） ---

test('readJson：檔案不存在拋 FILE_NOT_FOUND（SyncError，非裸 Error）', () => {
  withTmpDir((dir) => {
    const missing = path.join(dir, 'nope.json');
    assert.throws(() => readJson(missing), (e) => {
      assert.ok(e instanceof SyncError, '應為 SyncError');
      assert.equal(e.code, ERR.FILE_NOT_FOUND);
      return true;
    });
  });
});

test('readJson：正常 JSON 解析為物件', () => {
  withTmpFile(JSON.stringify({ a: 1, nested: { b: 'x' } }), (fp) => {
    assert.deepEqual(readJson(fp), { a: 1, nested: { b: 'x' } });
  });
});

// -----------------------------------------------------------------------------
// getFiles：非 ENOENT IO 錯誤必須拋出（不得靜默降級為空集）
//
// 空集在下游被當作「來源沒有任何檔案」：safety:check 據此把整個目錄當成無可掃描。
// 若讀取失敗被吞成 []，一個暫時不可讀的 repo 目錄就會漏掃卻回報通過。
// root 會繞過檔案權限（chmod 000 仍可讀）、Windows 的 chmod 只切 read-only
// attribute 而非 POSIX 權限，兩者皆擋不住存取，故權限相關測試在該環境跳過
// （itPosixPerms，見 test/helpers.js）。
// -----------------------------------------------------------------------------

itPosixPerms('getFiles：目錄不可讀（EACCES）拋 SyncError，不得回空集', () => {
  withTmpDir((dir) => {
    const locked = path.join(dir, 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'a.md'), 'A');
    fs.chmodSync(locked, 0o000);
    try {
      assert.throws(() => getFiles(locked), (e) => {
        assert.ok(e instanceof SyncError, '應包成 SyncError 而非裸 fs 例外');
        return true;
      });
    } finally {
      fs.chmodSync(locked, 0o700); // 還原以便 withTmpDir 清理
    }
  });
});

itPosixPerms('getFiles：遞迴進入不可讀子目錄時同樣拋出（錯誤不因層級被吞）', () => {
  withTmpDir((dir) => {
    const root = path.join(dir, 'root');
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(root, 'top.md'), 'T');
    fs.writeFileSync(path.join(sub, 'deep.md'), 'D');
    fs.chmodSync(sub, 0o000);
    try {
      assert.throws(() => getFiles(root), (e) => e instanceof SyncError);
    } finally {
      fs.chmodSync(sub, 0o700);
    }
  });
});

// -----------------------------------------------------------------------------
// WSL 橋接（to-win-local）
// resolveWinHome 是唯一的守門：非 WSL、探測失敗、路徑不存在、目標等同 HOME 皆須擋下。
// 放行任一情形都會讓「以為寫到 Windows 端」變成靜默寫錯地方。
// -----------------------------------------------------------------------------
test('winPathToWslPath：Windows 路徑轉為 /mnt 掛載路徑', () => {
  assert.equal(winPathToWslPath('C:\\Users\\Joe'), '/mnt/c/Users/Joe');
  assert.equal(winPathToWslPath('D:/Users/Joe/'), '/mnt/d/Users/Joe');
  // cmd.exe 的輸出帶尾端換行，須先 trim
  assert.equal(winPathToWslPath('C:\\Users\\Joe\r\n'), '/mnt/c/Users/Joe');
});

test('winPathToWslPath：非 <drive>: 開頭回 null（不臆造路徑）', () => {
  for (const bad of ['', '   ', '\\\\server\\share', '/home/barney', 'Users\\Joe']) {
    assert.equal(winPathToWslPath(bad), null, `應無法解析：${JSON.stringify(bad)}`);
  }
});

test('detectWinHome：環境變數 AI_CONFIG_SYNC_WIN_HOME 優先，不問 cmd.exe', () => {
  // env 分支為早退路徑、零 IO，跨平台皆可測（不需 WSL、不 spawn cmd.exe）
  const key = 'AI_CONFIG_SYNC_WIN_HOME';
  const original = process.env[key];
  process.env[key] = '/mnt/c/Users/Test';
  try {
    assert.equal(detectWinHome(), '/mnt/c/Users/Test');
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

test('resolveWinHome：非 WSL 環境直接拋 INVALID_ARGS', { skip: isWsl() ? '目前在 WSL 內' : false }, () => {
  assert.throws(
    () => resolveWinHome(['/tmp']),
    (e) => e instanceof SyncError && e.code === ERR.INVALID_ARGS,
  );
});

test('resolveWinHome：位置引數指向不存在路徑時拋 FILE_NOT_FOUND', { skip: isWsl() ? false : '需在 WSL 內執行' }, () => {
  withTmpDir((dir) => {
    assert.throws(
      () => resolveWinHome([path.join(dir, 'nope')]),
      (e) => e instanceof SyncError && e.code === ERR.FILE_NOT_FOUND,
    );
  });
});

test('resolveWinHome：目標等同目前 HOME 時拒絕執行', { skip: isWsl() ? false : '需在 WSL 內執行' }, () => {
  assert.throws(
    () => resolveWinHome([os.homedir()]),
    (e) => e instanceof SyncError && e.code === ERR.INVALID_ARGS,
  );
});
