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
  collectSkillDiffSummary,
  buildFullDiffList,
  diffFile,
  diffDir,
  diffDirItems,
  diffFileItem,
  diffSyncItems,
  printToLocalPreview,
  readJson,
  matchExclude,
  statusToStatsKey,
  parseSkillSource,
  parseArgs,
  toRelativePath,
  loadSkillsFromLock,
  computeSkillsDiff,
  sanitizeForTerminal,
  buildSyncItems,
  materializeSyncItem,
  getFiles,
  mirrorDir,
  SYNC_MANIFEST,
  SYNC_AREAS,
  actionToIcon,
  SyncError,
  ERR,
  COMMANDS,
  COMMAND_ALIASES,
  DEVICE_SETTINGS_KEYS,
} = require('../sync.js');
const {
  CODEX_CONFIG_HARD_BLOCK_SECTIONS,
  CODEX_CONFIG_DEVICE_WARN_SECTIONS,
  SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES,
  SAFETY_SCAN_DIRS,
} = require('../safety-check.js');
const { withArgv, withTmpDir, withTmpFile } = require('./helpers');

// -----------------------------------------------------------------------------
// matchExclude
// -----------------------------------------------------------------------------
test('matchExclude：精確字串比對', () => {
  assert.equal(matchExclude('foo.json', 'foo.json'), true);
  assert.equal(matchExclude('foo.json', 'bar.json'), false);
});

test('matchExclude：尾部萬用字元比對', () => {
  assert.equal(matchExclude('logs/a.log', 'logs/*'), true);
  assert.equal(matchExclude('logs/nested/a.log', 'logs/*'), true);
  assert.equal(matchExclude('src/foo.ts', 'logs/*'), false);
});

test('matchExclude：* 只支援尾部萬用', () => {
  // 中間的 * 不被特別處理，會當作字面字元
  assert.equal(matchExclude('foo', 'f*o'), false);
});

// -----------------------------------------------------------------------------
// statusToStatsKey
// -----------------------------------------------------------------------------
test('statusToStatsKey：三種狀態對應正確', () => {
  assert.equal(statusToStatsKey('new'), 'added');
  assert.equal(statusToStatsKey('changed'), 'updated');
  assert.equal(statusToStatsKey('deleted'), 'deleted');
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
// parseSkillSource
// -----------------------------------------------------------------------------
test('parseSkillSource：skills.sh URL 解析', () => {
  const result = parseSkillSource({
    extraArgs: ['https://skills.sh/anthropics/skills/web-search'],
  });
  assert.equal(result.name, 'web-search');
  assert.equal(result.source, 'anthropics/skills');
});

test('parseSkillSource：name + source 雙引數', () => {
  const result = parseSkillSource({ extraArgs: ['my-skill', 'org/repo'] });
  assert.equal(result.name, 'my-skill');
  assert.equal(result.source, 'org/repo');
});

test('parseSkillSource：缺少引數應丟 SyncError', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: [] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：skills.sh URL 格式錯誤應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['https://skills.sh/onlyone'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：單一非 URL 引數應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my-skill'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：name 含換行應丟錯（log injection 防護）', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['evil\nname', 'org/repo'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：source 含換行應丟錯（log injection 防護）', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my-skill', 'org/repo\nrm -rf'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：source 含 ANSI escape 應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my-skill', 'org/repo\x1b[31m'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
});

test('parseSkillSource：name 含特殊字元應丟錯', () => {
  assert.throws(
    () => parseSkillSource({ extraArgs: ['my skill', 'org/repo'] }),
    (err) => err instanceof SyncError && err.code === ERR.INVALID_ARGS,
  );
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

test('parseArgs：--no-color 設定 noColor 旗標', () => {
  assert.equal(withArgv(['diff', '--no-color'], () => parseArgs()).noColor, true);
  assert.equal(withArgv(['diff'], () => parseArgs()).noColor, false);
});

test('parseArgs：-v 為 --version 別名', () => {
  assert.equal(withArgv(['-v'], () => parseArgs()).showVersion, true);
});

test('actionToIcon：added/deleted 直映，其餘（updated）→ changed', () => {
  assert.equal(actionToIcon('added'), 'added');
  assert.equal(actionToIcon('deleted'), 'deleted');
  assert.equal(actionToIcon('updated'), 'changed');
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

// homeLabel 目前無 manifest 使用者（隨 MCP 同步移除），但它是 materializer 的通用能力，
// 以合成 entry 保留覆蓋，避免下次有人需要「repo 與本機檔名不同」時才發現壞掉
test('materializeSyncItem：homeLabel 允許 repo 與本機使用不同檔名', () => {
  const entry = { area: 'codex', label: 'repo-name.json', homeLabel: 'local-name.toml', type: 'file', fixedFlow: true };
  const item = materializeSyncItem(entry, 'to-local');
  assert.equal(item.label, 'repo-name.json');
  assert.match(item.src, /[\/]\.codex[\/]local-name\.toml$/);
  assert.match(item.dest, /[\/]codex[\/]repo-name\.json$/);
});

// homeRootFile 同樣無 manifest 使用者，以合成 entry 保留覆蓋。
// 語意為「本機端落在 $HOME 下、不套用 area 的 homeBase」，故本例的 codex area
// 不應出現 .codex 中繼目錄——這正是它與 homeLabel 的差別所在
test('materializeSyncItem：homeRootFile 讓本機端直接落在 $HOME 下、略過 homeBase', () => {
  const entry = { area: 'codex', label: 'repo-name.json', homeRootFile: '.root-level.json', type: 'file', fixedFlow: true };
  const item = materializeSyncItem(entry, 'to-local');
  assert.equal(item.label, 'repo-name.json');
  assert.equal(item.src, path.join(os.homedir(), '.root-level.json'));
  assert.doesNotMatch(item.src, /\.codex/);
  assert.match(item.dest, /[\/]codex[\/]repo-name\.json$/);
});

// homeRootFile 優先於 homeLabel：兩者同時存在時走 $HOME 分支，homeLabel 不生效
test('materializeSyncItem：homeRootFile 與 homeLabel 並存時以 homeRootFile 為準', () => {
  const entry = {
    area: 'codex', label: 'repo-name.json', homeLabel: 'ignored.json',
    homeRootFile: '.root-level.json', type: 'file', fixedFlow: true,
  };
  const item = materializeSyncItem(entry, 'to-local');
  assert.equal(item.src, path.join(os.homedir(), '.root-level.json'));
  assert.doesNotMatch(item.src, /ignored/);
});

test('materializeSyncItem：dir 型 exclude 欄位 propagate 為 excludePatterns', () => {
  const withExclude = materializeSyncItem(
    { area: 'claude', label: 'rules', type: 'dir', exclude: ['*.tmp', 'draft/**'] }, 'to-repo');
  assert.deepEqual(withExclude.excludePatterns, ['*.tmp', 'draft/**']);
  // 無 exclude 的項目不帶該欄位（保持 item 精簡、下游 `|| []` fallback）
  const noExclude = materializeSyncItem({ area: 'claude', label: 'rules', type: 'dir' }, 'to-repo');
  assert.equal(Object.prototype.hasOwnProperty.call(noExclude, 'excludePatterns'), false);
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
test('drift-guard：claude／codex 各 area 的 label 清單與順序鎖定', () => {
  for (const direction of ['to-repo', 'to-local']) {
    const items = buildSyncItems(direction);
    const byArea = (prefix) => items.filter(i => i.prefix === prefix).map(i => i.label);
    assert.deepEqual(byArea('claude/'),
      ['CLAUDE.md', 'settings.json', 'statusline.sh', 'rules']);
    assert.deepEqual(byArea('codex/'), ['AGENTS.md']);
  }
});

// -----------------------------------------------------------------------------
// computeSkillsDiff：三向集合差
// -----------------------------------------------------------------------------
test('computeSkillsDiff：正確分出 onlyInRepo / onlyInLocal / inBoth', () => {
  const repo = { a: {}, b: {}, shared: {} };
  const local = { c: {}, shared: {} };
  const r = computeSkillsDiff(repo, local);
  assert.deepEqual(r.onlyInRepo.sort(), ['a', 'b']);
  assert.deepEqual(r.onlyInLocal, ['c']);
  assert.deepEqual(r.inBoth, ['shared']);
});

test('computeSkillsDiff：兩邊皆空時三類皆空', () => {
  const r = computeSkillsDiff({}, {});
  assert.deepEqual(r, { onlyInRepo: [], onlyInLocal: [], inBoth: [] });
});

// -----------------------------------------------------------------------------
// sanitizeForTerminal：移除控制字元（log-injection 防護）
// -----------------------------------------------------------------------------
test('sanitizeForTerminal：剝除 ANSI escape、換行與控制字元', () => {
  assert.equal(sanitizeForTerminal('a\x1b[31mb\nc\r\x07'), 'a[31mbc');
  assert.equal(sanitizeForTerminal('https://ok/x'), 'https://ok/x', '正常字串不受影響');
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

// 5.4 drift-guard：新增 agents 同步區（SYNC_AREAS + SYNC_MANIFEST 的 xtool-skills 列）
// 須與 README 同步項目表一致；且 xtool 列必須排在 claude skills dir 列之前（順序即安全）
test('SYNC_AREAS：agents area 對應 ~/.agents，repoDir/prefix 正確', () => {
  const a = SYNC_AREAS.agents;
  assert.ok(a, 'agents area 應存在');
  assert.match(a.homeBase, /[\\/]\.agents$/);
  assert.equal(a.repoDir, 'agents');
  assert.equal(a.prefix, 'agents/');
});

test('SYNC_MANIFEST：agents/skills 為 xtool-skills 型（全域 skill 的唯一落點）', () => {
  const xtoolIdx = SYNC_MANIFEST.findIndex(e => e.area === 'agents' && e.label === 'skills');
  assert.ok(xtoolIdx >= 0, 'SYNC_MANIFEST 應含 agents/skills 列');
  assert.equal(SYNC_MANIFEST[xtoolIdx].type, 'xtool-skills');
});

// 回歸鎖（對稱於「不得含 config.toml」）：claude/skills 與 claude/commands 兩層已因
// 無住戶移除（remove-tenantless-sync-layers）。claude/skills 若被加回，會連帶復活
// 「xtool-skills 列須排在其之前」的順序不變式；claude/commands 則違反「一律使用
// skill、不再新增 command」政策，且會讓他機殘留的舊 command 經 to-repo 復活。
// 要恢復任一層須先重新評估上述後果，不得只塞回一列 manifest。
test('SYNC_MANIFEST 回歸鎖：不得含 claude 區的 skills／commands dir 列', () => {
  for (const label of ['skills', 'commands']) {
    const found = SYNC_MANIFEST.find(e => e.area === 'claude' && e.label === label && e.type === 'dir');
    assert.equal(found, undefined,
      `SYNC_MANIFEST 不應含 { area: 'claude', label: '${label}', type: 'dir' } 列`);
  }
});

test('README drift-guard：agents 同步區載於 README 同步項目表', () => {
  assert.ok(README.includes('`agents/skills/`'), 'README 未載明 repo 路徑 agents/skills/');
  assert.ok(README.includes('`~/.agents/skills/`'), 'README 未載明本機路徑 ~/.agents/skills/');
});

// codex config.toml 已不再同步：SYNC_MANIFEST 不得再出現該列（回歸鎖）
test('drift-guard：SYNC_MANIFEST 不含 codex config.toml', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.label === 'config.toml'), false,
    'codex config.toml 已移除同步，不應重新出現在 SYNC_MANIFEST');
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'codex-config'), false,
    'codex-config 型別已移除');
});

// MCP 同步已整批移除（openspec/changes/archive/*-remove-mcp-sync），待重新設計。
// 回歸鎖：兩種 MCP 型別皆不得復活——`mcp` 會投影寫入 config.toml、`advisory` 會讀本機
// 設定產生建議指令；重新設計時應開新 change 明確決定形狀，而非讓舊型別悄悄回來。
test('drift-guard：MCP 型別（mcp／advisory）皆不得復活', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'mcp'), false,
    'type:\'mcp\'（TOML section 投影寫入）已移除，不得重新出現');
  assert.equal(SYNC_MANIFEST.some(e => e.type === 'advisory'), false,
    'type:\'advisory\'（MCP 諮詢式比對）已移除，不得重新出現');
});

// 回歸鎖：MCP 的 repo 來源與本機目標皆已移除，manifest 不得再指向它們
test('drift-guard：SYNC_MANIFEST 不含 MCP 來源列', () => {
  assert.equal(SYNC_MANIFEST.some(e => e.label === 'mcp.json'), false,
    'claude/mcp.json 與 codex/mcp.json 已刪除，不應出現在 SYNC_MANIFEST');
  assert.equal(SYNC_MANIFEST.some(e => e.homeRootFile === '.claude.json'), false,
    '~/.claude.json 為高風險敏感活檔，不得再被任何 manifest 列指向');
});

// -----------------------------------------------------------------------------
// loadSkillsFromLock：skills-lock.json 讀取與格式驗證
// 避免格式異常時靜默回退成空物件，誤判為「無差異」
// -----------------------------------------------------------------------------
test('loadSkillsFromLock：檔案不存在回傳空物件', () => {
  const result = loadSkillsFromLock('/nonexistent/path/skills-lock.json');
  assert.deepEqual(result, {});
});

test('loadSkillsFromLock：正常格式回傳 skills 物件', () => {
  withTmpFile(JSON.stringify({ skills: { foo: { source: 'x/y' } } }), (fp) => {
    const result = loadSkillsFromLock(fp);
    assert.deepEqual(result, { foo: { source: 'x/y' } });
  });
});

test('loadSkillsFromLock：skills 欄位缺失應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ version: 1 }), (fp) => {
    assert.throws(() => loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

test('loadSkillsFromLock：skills 為 null 應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ skills: null }), (fp) => {
    assert.throws(() => loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

test('loadSkillsFromLock：skills 為陣列（非物件）應丟 JSON_PARSE 錯誤', () => {
  withTmpFile(JSON.stringify({ skills: [] }), (fp) => {
    assert.throws(() => loadSkillsFromLock(fp), (e) => e instanceof SyncError && e.code === ERR.JSON_PARSE);
  });
});

// -----------------------------------------------------------------------------
// diffFile / diffDir：src 缺失 vs dest 缺失的對稱性
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

test('diffDir：src 不存在但 dest 有檔 → 全部標 deleted', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'missing');
    const dest = path.join(dir, 'present');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'a.txt'), 'a');
    fs.writeFileSync(path.join(dest, 'b.txt'), 'b');
    const diffs = diffDir(src, dest);
    assert.deepEqual(
      diffs.map(d => ({ rel: d.rel, status: d.status })).sort((x, y) => x.rel.localeCompare(y.rel)),
      [{ rel: 'a.txt', status: 'deleted' }, { rel: 'b.txt', status: 'deleted' }]
    );
  });
});

test('diffDir：src 與 dest 都不存在 → 空陣列', () => {
  withTmpDir((dir) => {
    assert.deepEqual(
      diffDir(path.join(dir, 'a'), path.join(dir, 'b')),
      []
    );
  });
});

// -----------------------------------------------------------------------------
// diffDirItems / printToLocalPreview：dry-run 預覽須與 mirrorDir 實際刪除行為對齊
// mirrorDir 在「src 目錄整個不存在」時提早返回、不刪本機檔（保守安全設計），
// 故此情境的 deleted 應標記 preserved，讓 to-local 預覽不誤報「將刪除」。
// 對稱地，「src 目錄存在但缺該檔」時 mirrorDir 會刪，deleted 不得標 preserved。
// -----------------------------------------------------------------------------
test('diffDirItems：repo 源目錄不存在 → deleted 標 preserved（mirrorDir 不會刪）', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo-missing');
    const dest = path.join(dir, 'local');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'a.toml'), 'a');
    const entries = diffDirItems({ src, dest, label: 'agents', prefix: 'codex/' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, 'deleted');
    assert.equal(entries[0].preserved, true, 'repo 無此目錄時 mirrorDir 不刪，應標 preserved');
  });
});

test('diffDirItems：源目錄存在但缺該檔 → deleted 不標 preserved（mirrorDir 會刪）', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo');
    const dest = path.join(dir, 'local');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'keep.toml'), 'k');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'keep.toml'), 'k');
    fs.writeFileSync(path.join(dest, 'extra.toml'), 'x');
    const entries = diffDirItems({ src, dest, label: 'agents', prefix: 'codex/' });
    const del = entries.find(e => e.status === 'deleted');
    assert.ok(del, '應有一筆 deleted');
    assert.notEqual(del.preserved, true, '源目錄存在時該檔會被刪，不得標 preserved');
  });
});

test('diffFileItem：repo 缺來源檔 → deleted 標 preserved（copyFile 永不刪 dest）', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo-missing.md');
    const dest = path.join(dir, 'local.md');
    fs.writeFileSync(dest, 'local content');
    const entry = diffFileItem({ src, dest, label: 'CLAUDE.md', prefix: 'claude/' });
    assert.equal(entry.status, 'deleted');
    assert.equal(entry.preserved, true, 'file 型 apply 不刪 dest，deleted 應標 preserved');
  });
});

test('printToLocalPreview：preserved 的 deleted 不計入 previewStats.deleted', () => {
  const stats = printToLocalPreview([
    { status: 'deleted', label: 'codex/agents/a.toml', preserved: true },
    { status: 'deleted', label: 'claude/rules/b.md' },
    { status: 'new', label: 'claude/rules/c.md' },
  ]);
  assert.deepEqual(stats, { added: 1, updated: 0, deleted: 1 });
});

// --- collectSkillDiffSummary -----------------------------------------------

test('collectSkillDiffSummary：非 skills 路徑回 false、不計入', () => {
  const summary = {};
  assert.equal(collectSkillDiffSummary({ label: 'claude/CLAUDE.md', status: 'changed' }, summary), false);
  assert.deepEqual(summary, {});
});

test('collectSkillDiffSummary：status 為 null（無差異）回 false', () => {
  const summary = {};
  assert.equal(collectSkillDiffSummary({ label: 'agents/skills/ob/SKILL.md', status: null }, summary), false);
  assert.deepEqual(summary, {});
});

test('collectSkillDiffSummary：eol 狀態計入 changed（回歸：先前漏計顯示「共 0 個檔案」）', () => {
  const summary = {};
  assert.equal(collectSkillDiffSummary({ label: 'agents/skills/ob/SKILL.md', status: 'eol' }, summary), true);
  // key 為完整前綴（agents/skills/<name>）
  assert.deepEqual(summary['agents/skills/ob'], { added: 0, changed: 1, deleted: 0 });
});

test('collectSkillDiffSummary：new/changed/deleted 各自累加且依 skill 分組', () => {
  const summary = {};
  collectSkillDiffSummary({ label: 'agents/skills/ob/a.md', status: 'new' }, summary);
  collectSkillDiffSummary({ label: 'agents/skills/ob/b.md', status: 'changed' }, summary);
  collectSkillDiffSummary({ label: 'agents/skills/ob/c.md', status: 'deleted' }, summary);
  collectSkillDiffSummary({ label: 'agents/skills/pen/d.md', status: 'changed' }, summary);
  assert.deepEqual(summary['agents/skills/ob'], { added: 1, changed: 1, deleted: 1 });
  assert.deepEqual(summary['agents/skills/pen'], { added: 0, changed: 1, deleted: 0 });
});

test('collectSkillDiffSummary：agents/skills（xtool）逐檔亦歸摘要，key 前綴為 agents/skills', () => {
  const summary = {};
  assert.equal(collectSkillDiffSummary({ label: 'agents/skills/mini-research/SKILL.md', status: 'new' }, summary), true);
  assert.deepEqual(summary['agents/skills/mini-research'], { added: 1, changed: 0, deleted: 0 });
});

test('collectSkillDiffSummary：conflict 與 whole-skill 層級 entry 不歸摘要（交回逐行）', () => {
  const summary = {};
  // conflict 狀態（整個 skill、無檔名尾段）
  assert.equal(collectSkillDiffSummary({ label: 'agents/skills/mini-research', status: 'conflict' }, summary), false);
  // 摘要行（label 以 / 結尾、無檔名尾段）
  assert.equal(collectSkillDiffSummary({ label: 'agents/skills/', status: 'new' }, summary), false);
  assert.deepEqual(summary, {});
});

// --- buildFullDiffList ------------------------------------------------------

test('buildFullDiffList：補上無差異的 file 項目（status: null）且不 mutate 輸入', () => {
  const items = [{ label: 'CLAUDE.md', type: 'file', src: '/s', dest: '/d', verboseSrc: '/s', verboseDest: '/d' }];
  const diffItems = [];
  const result = buildFullDiffList(items, diffItems);
  assert.equal(diffItems.length, 0, '不得 mutate 傳入的 diffItems');
  assert.deepEqual(result.map(d => ({ label: d.label, status: d.status })), [
    { label: 'claude/CLAUDE.md', status: null },
  ]);
});

test('buildFullDiffList：已有差異的 file 不重複補列', () => {
  const items = [{ label: 'CLAUDE.md', type: 'file', src: '/s', dest: '/d' }];
  const diffItems = [{ label: 'claude/CLAUDE.md', status: 'changed', itemType: 'file' }];
  const result = buildFullDiffList(items, diffItems);
  assert.equal(result.filter(d => d.label === 'claude/CLAUDE.md').length, 1);
  assert.equal(result[0].status, 'changed');
});

test('buildFullDiffList：dir 排在 file/settings 之後', () => {
  const items = [
    { label: 'skills', type: 'dir', src: '/s', dest: '/d' },
    { label: 'CLAUDE.md', type: 'file', src: '/s2', dest: '/d2' },
  ];
  const result = buildFullDiffList(items, []);
  const dirIdx = result.findIndex(d => d.label === 'claude/skills/');
  const fileIdx = result.findIndex(d => d.label === 'claude/CLAUDE.md');
  assert.ok(fileIdx < dirIdx, 'file 應排在 dir 之前');
});

test('buildFullDiffList：dir 已有細項差異時不補摘要行', () => {
  const items = [{ label: 'skills', type: 'dir', src: '/s', dest: '/d' }];
  const diffItems = [{ label: 'claude/skills/ob/a.md', status: 'changed', itemType: 'dir' }];
  const result = buildFullDiffList(items, diffItems);
  assert.equal(result.some(d => d.label === 'claude/skills/'), false);
});

// --- diffFileItem：deleted 以外的分支（deleted+preserved 已於上方涵蓋） -------

test('diffFileItem：dest 缺檔 → new，不標 preserved', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'repo.md');
    const dest = path.join(dir, 'local-missing.md');
    fs.writeFileSync(src, 'repo content');
    const entry = diffFileItem({ src, dest, label: 'CLAUDE.md', prefix: 'claude/' });
    assert.equal(entry.status, 'new');
    assert.notEqual(entry.preserved, true, 'new 不得標 preserved');
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

// --- diffSyncItems：依 type 分派並攤平（file→1 筆、dir→N 筆、未知→略過） -------

test('diffSyncItems：file 型產出 1 筆、dir 型產出各檔差異，順序為 manifest 順序', () => {
  withTmpDir((dir) => {
    const fileSrc = path.join(dir, 'repo.md');
    const fileDest = path.join(dir, 'local.md');
    fs.writeFileSync(fileSrc, 'A');
    fs.writeFileSync(fileDest, 'B'); // changed
    const dirSrc = path.join(dir, 'repo-dir');
    const dirDest = path.join(dir, 'local-dir');
    fs.mkdirSync(dirSrc);
    fs.mkdirSync(dirDest);
    fs.writeFileSync(path.join(dirSrc, 'x.md'), 'new file'); // new（dest 無）

    const items = [
      { type: 'file', src: fileSrc, dest: fileDest, label: 'CLAUDE.md', prefix: 'claude/' },
      { type: 'dir', src: dirSrc, dest: dirDest, label: 'skills', prefix: 'claude/', excludePatterns: [] },
    ];
    const result = diffSyncItems(items, 'to-repo');
    assert.deepEqual(
      result.map(d => ({ label: d.label, status: d.status })),
      [
        { label: 'claude/CLAUDE.md', status: 'changed' },
        { label: 'claude/skills/x.md', status: 'new' },
      ],
    );
  });
});

test('diffSyncItems：未知 type 走 default 分支 → 不產出任何 entry', () => {
  const result = diffSyncItems(
    [{ type: 'unknown', src: '/s', dest: '/d', label: 'x', prefix: 'claude/' }],
    'to-repo',
  );
  assert.deepEqual(result, []);
});

// --- printToLocalPreview：changed / eol 皆映射為 updated -----------------------

test('printToLocalPreview：changed 與 eol 皆計入 updated', () => {
  const stats = printToLocalPreview([
    { status: 'changed', label: 'claude/CLAUDE.md' },
    { status: 'eol', label: 'claude/statusline.sh' },
    { status: 'new', label: 'claude/rules/a.md' },
  ]);
  assert.deepEqual(stats, { added: 1, updated: 2, deleted: 0 });
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
// 空集在下游被當作「來源沒有任何檔案」，mirrorDir 據此把 dest 全體視為多餘檔刪除。
// 若讀取失敗被吞成 []，一個暫時不可讀的 repo 目錄就會讓 to-local 清空本機對應目錄。
// root 會繞過檔案權限（chmod 000 仍可讀），故權限相關測試在 root 下跳過。
// -----------------------------------------------------------------------------
const itNonRoot = (process.getuid && process.getuid() === 0) ? test.skip : test;

itNonRoot('getFiles：目錄不可讀（EACCES）拋 SyncError，不得回空集', () => {
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

itNonRoot('getFiles：遞迴進入不可讀子目錄時同樣拋出（錯誤不因層級被吞）', () => {
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

// 後果層回歸鎖：來源不可讀時 mirrorDir 必須中止，而非把 dest 當多餘檔清空
itNonRoot('mirrorDir：src 不可讀時拋錯中止，dest 既有檔案不得被當多餘檔刪除', () => {
  withTmpDir((dir) => {
    const src = path.join(dir, 'src');
    const dest = path.join(dir, 'dest');
    fs.mkdirSync(src);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(src, 'a.md'), 'A');
    fs.writeFileSync(path.join(dest, 'a.md'), 'A');
    fs.writeFileSync(path.join(dest, 'b.md'), 'B');
    fs.chmodSync(src, 0o000);
    try {
      assert.throws(() => mirrorDir(src, dest, [], false), (e) => e instanceof SyncError);
      assert.equal(fs.existsSync(path.join(dest, 'a.md')), true, 'dest 檔案不得被刪');
      assert.equal(fs.existsSync(path.join(dest, 'b.md')), true, 'dest 檔案不得被刪');
    } finally {
      fs.chmodSync(src, 0o700);
    }
  });
});
