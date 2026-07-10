'use strict';

// =============================================================================
// sync.js 純函式單元測試（使用 Node.js 內建 node:test，零外部相依）
// 執行方式：node --test 或 npm test
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  collectSkillDiffSummary,
  buildFullDiffList,
  diffFile,
  diffDir,
  diffDirItems,
  diffFileItem,
  printToLocalPreview,
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
  resolveVariantLabel,
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
  CODEX_CONFIG_TOP_KEYS,
  CODEX_CONFIG_DEVICE_SECTION_PREFIXES,
} = require('../codex-config.js');
const { CODEX_CONFIG_DEVICE_WARN_SECTIONS } = require('../safety-check.js');
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

test('materializeSyncItem：dir 型 exclude 欄位 propagate 為 excludePatterns', () => {
  const withExclude = materializeSyncItem(
    { area: 'claude', label: 'skills', type: 'dir', exclude: ['*.tmp', 'draft/**'] }, 'to-repo');
  assert.deepEqual(withExclude.excludePatterns, ['*.tmp', 'draft/**']);
  // 無 exclude 的項目不帶該欄位（保持 item 精簡、下游 `|| []` fallback）
  const noExclude = materializeSyncItem({ area: 'claude', label: 'skills', type: 'dir' }, 'to-repo');
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
// opencode area：materialize 產出、檔名變體解析、drift-guard
// -----------------------------------------------------------------------------
test('SYNC_AREAS：opencode area 為 XDG 佈局（~/.config/opencode）且 repoDir/prefix 正確', () => {
  const oc = SYNC_AREAS.opencode;
  assert.ok(oc, 'opencode area 應存在');
  assert.match(oc.homeBase, /[\\/]\.config[\\/]opencode$/);
  assert.equal(oc.repoDir, 'opencode');
  assert.equal(oc.prefix, 'opencode/');
});

test('materializeSyncItem：opencode AGENTS.md 依方向交換且 prefix 為 opencode/', () => {
  const entry = { area: 'opencode', label: 'AGENTS.md', type: 'file' };
  const toRepo = materializeSyncItem(entry, 'to-repo');
  assert.equal(toRepo.label, 'AGENTS.md');
  assert.equal(toRepo.type, 'file');
  assert.equal(toRepo.prefix, 'opencode/');
  // to-repo：home（~/.config/opencode）→ repo（opencode/）
  assert.match(toRepo.src, /[\\/]\.config[\\/]opencode[\\/]AGENTS\.md$/);
  assert.match(toRepo.dest, /[\\/]opencode[\\/]AGENTS\.md$/);
  const toLocal = materializeSyncItem(entry, 'to-local');
  assert.equal(toLocal.src, toRepo.dest);
  assert.equal(toLocal.dest, toRepo.src);
});

test('resolveVariantLabel：僅 .json 存在時採 .json', () => {
  withTmpDir((home) => withTmpDir((repo) => {
    fs.writeFileSync(path.join(home, 'opencode.json'), '{}');
    const label = resolveVariantLabel(['opencode.jsonc', 'opencode.json'], home, repo);
    assert.equal(label, 'opencode.json');
  }));
});

test('resolveVariantLabel：僅 .jsonc 存在時採 .jsonc', () => {
  withTmpDir((home) => withTmpDir((repo) => {
    fs.writeFileSync(path.join(repo, 'opencode.jsonc'), '{}');
    const label = resolveVariantLabel(['opencode.jsonc', 'opencode.json'], home, repo);
    assert.equal(label, 'opencode.jsonc');
  }));
});

test('resolveVariantLabel：兩變體同時存在時 .jsonc 優先', () => {
  withTmpDir((home) => withTmpDir((repo) => {
    // 本機端有 .json、repo 端有 .jsonc → 優先序（.jsonc 在前）勝出
    fs.writeFileSync(path.join(home, 'opencode.json'), '{}');
    fs.writeFileSync(path.join(repo, 'opencode.jsonc'), '{}');
    const label = resolveVariantLabel(['opencode.jsonc', 'opencode.json'], home, repo);
    assert.equal(label, 'opencode.jsonc');
  }));
});

test('resolveVariantLabel：兩變體皆不存在時採預設 variants[0]', () => {
  withTmpDir((home) => withTmpDir((repo) => {
    const label = resolveVariantLabel(['opencode.jsonc', 'opencode.json'], home, repo);
    assert.equal(label, 'opencode.jsonc');
  }));
});

test('materializeSyncItem：opencode 主設定 variants 解析後兩端同名（canonical 單一 label）', () => {
  const entry = { area: 'opencode', label: 'opencode.jsonc', type: 'file', variants: ['opencode.jsonc', 'opencode.json'] };
  const item = materializeSyncItem(entry, 'to-repo');
  // 解析結果依真實環境而定，但 src/dest basename 必一致（杜絕 .json/.jsonc 重複檔）
  assert.equal(path.basename(item.src), path.basename(item.dest));
  assert.equal(item.label, path.basename(item.src));
  assert.match(item.label, /^opencode\.jsonc?$/);
});

test('drift-guard：新增 opencode area 後 claude／codex 既有項目 materialize 產出不變', () => {
  for (const direction of ['to-repo', 'to-local']) {
    const items = buildSyncItems(direction);
    const byArea = (prefix) => items.filter(i => i.prefix === prefix);
    // claude/codex 項目數與既有 manifest 對齊，且 label 未受 opencode 加入影響
    const claudeLabels = byArea('claude/').map(i => i.label);
    const codexLabels = byArea('codex/').map(i => i.label);
    assert.deepEqual(claudeLabels,
      ['CLAUDE.md', 'settings.json', 'statusline.sh', 'agents', 'commands', 'skills', 'rules']);
    assert.deepEqual(codexLabels, ['AGENTS.md', 'config.toml']);
    // 每個非 opencode 項目的 src/dest 皆不含 .config/opencode 路徑
    for (const it of [...byArea('claude/'), ...byArea('codex/')]) {
      assert.doesNotMatch(it.src, /[\\/]\.config[\\/]opencode[\\/]/);
      assert.doesNotMatch(it.dest, /[\\/]opencode[\\/]/);
    }
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

test('README drift-guard：codex section 黑名單與 top-level 允許清單皆載於 README', () => {
  for (const prefix of CODEX_CONFIG_DEVICE_SECTION_PREFIXES) {
    assert.ok(README.includes(`\`${prefix}`), `README 未載明 codex 黑名單 section：${prefix}`);
  }
  for (const key of CODEX_CONFIG_TOP_KEYS) {
    assert.ok(README.includes(`\`${key}\``), `README 未載明 codex top-level 允許 key：${key}`);
  }
});

test('README drift-guard：codex 裝置狀態 warning section 清單皆載於 README', () => {
  for (const prefix of CODEX_CONFIG_DEVICE_WARN_SECTIONS) {
    assert.ok(README.includes(`\`${prefix}`), `README 未載明 codex 裝置狀態 warning section：${prefix}`);
  }
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
  assert.equal(collectSkillDiffSummary({ label: 'claude/skills/ob/SKILL.md', status: null }, summary), false);
  assert.deepEqual(summary, {});
});

test('collectSkillDiffSummary：eol 狀態計入 changed（回歸：先前漏計顯示「共 0 個檔案」）', () => {
  const summary = {};
  assert.equal(collectSkillDiffSummary({ label: 'claude/skills/ob/SKILL.md', status: 'eol' }, summary), true);
  assert.deepEqual(summary.ob, { added: 0, changed: 1, deleted: 0 });
});

test('collectSkillDiffSummary：new/changed/deleted 各自累加且依 skill 分組', () => {
  const summary = {};
  collectSkillDiffSummary({ label: 'claude/skills/ob/a.md', status: 'new' }, summary);
  collectSkillDiffSummary({ label: 'claude/skills/ob/b.md', status: 'changed' }, summary);
  collectSkillDiffSummary({ label: 'claude/skills/ob/c.md', status: 'deleted' }, summary);
  collectSkillDiffSummary({ label: 'claude/skills/pen/d.md', status: 'changed' }, summary);
  assert.deepEqual(summary.ob, { added: 1, changed: 1, deleted: 1 });
  assert.deepEqual(summary.pen, { added: 0, changed: 1, deleted: 0 });
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
