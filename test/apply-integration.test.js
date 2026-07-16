'use strict';

// =============================================================================
// 整合測試：沙箱化 repo + HOME，透過 spawn 子程序真實跑 to-local / to-repo
// 把 sync.js 複製進 tmp 目錄當「repo」（讓 __dirname/REPO_ROOT 落在 tmp），
// 再以 HOME=另一個 tmp 沙箱化本機，雙向皆不觸碰真實 ~/.claude 或真實 repo。
//
// 覆蓋：
//   #5 direction-aware 的 to-local diff 分支（settings 'new'/'changed'、檔案新增）
//   #6 破壞性 apply 路徑（to-local 寫本機、to-repo 寫 repo 並剝除金鑰）
// 這些路徑此前僅靠人工 smoke test，無自動回歸防護。
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { noColorEnv } = require('./helpers.js');
const { COMMANDS } = require('../sync.js');

// sync.js require('./safety-check.js')（後者 require('./toml-reader.js')）與
// require('./skills.js')，任何 `node sync.js` 指令缺任一檔即崩，故四檔同抄。
const SYNC_RUNTIME_FILES = ['sync.js', 'safety-check.js', 'toml-reader.js', 'skills.js'];

/**
 * 建立沙箱：repo（含 sync.js + safety-check.js + toml-reader.js + skills.js 副本、git init）與 home。
 * @returns {{repo: string, home: string}}
 */
function setupSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-apply-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  for (const name of SYNC_RUNTIME_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', name), path.join(repo, name));
  }
  // to-repo 非 dry-run 需在 git repo 內；init 即可（不需 commit）
  spawnSync('git', ['init', '-q'], { cwd: repo });
  return { repo, home, root };
}

function run(repo, home, args) {
  return spawnSync(process.execPath, [path.join(repo, 'sync.js'), ...args], {
    cwd: repo,
    env: noColorEnv({ HOME: home, USERPROFILE: home }),
    encoding: 'utf8',
  });
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

// -----------------------------------------------------------------------------
// to-local：direction-aware diff（本機缺檔 → 將新增）+ 實際寫入本機
// -----------------------------------------------------------------------------
test('to-local：本機缺檔時預覽為「將新增」，--dry-run 不寫入', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-CLAUDE');
    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: ['x'] });

    const r = run(repo, home, ['to-local', '--dry-run']);
    assert.equal(r.status, 0, `dry-run 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /CLAUDE\.md.*將新增/, '本機缺 CLAUDE.md → 將新增');
    assert.match(r.stdout, /settings\.json.*將新增/, '本機缺 settings.json → 將新增');
    assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false,
      'dry-run 不得寫入本機');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-local --yes：實際把 repo 內容寫入本機', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-CLAUDE');
    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: ['x'] });

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `to-local 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'),
      'REPO-CLAUDE', 'CLAUDE.md 應被寫入本機');
    const written = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(written.permissions, ['x'], 'settings.json 應被寫入本機');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-local：本機已存在且內容相同時宣告一致、不寫入', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'SAME');
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'SAME');

    const r = run(repo, home, ['to-local', '--dry-run']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /完全一致|無需套用/, '內容相同應宣告一致');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// to-repo：破壞性寫入 repo；安全審核改由 safety:check 負責
// -----------------------------------------------------------------------------
test('to-repo：把本機內容寫進 repo，且 env 金鑰照常同步', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'LOCAL-CONTENT');
    const token = 'sk-' + 'A'.repeat(12);
    writeJson(path.join(home, '.claude', 'settings.json'), {
      permissions: ['p'],
      env: { ANTHROPIC_API_KEY: token, EDITOR: 'vim' },
      model: 'opus',
    });

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);

    assert.equal(fs.readFileSync(path.join(repo, 'claude', 'CLAUDE.md'), 'utf8'),
      'LOCAL-CONTENT', 'CLAUDE.md 應被寫入 repo');

    const repoSettings = fs.readFileSync(path.join(repo, 'claude', 'settings.json'), 'utf8');
    assert.ok(repoSettings.includes(token), 'repo settings 會包含 env API Key，交由 safety:check 回報');
    assert.ok(!r.stdout.includes(token), 'to-repo 狀態輸出不應印出 env 值');
    const parsed = JSON.parse(repoSettings);
    assert.equal(parsed.model, undefined, '裝置欄位 model 應被剝除');
    assert.equal(parsed.env.ANTHROPIC_API_KEY, token, 'env 金鑰照常同步');
    assert.equal(parsed.env.EDITOR, 'vim', '可攜 env（乾淨名）應保留');
    assert.deepEqual(parsed.permissions, ['p'], '可攜欄位應保留');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-repo --dry-run：不寫入 repo', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'LOCAL');

    const r = run(repo, home, ['to-repo', '--dry-run']);
    assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(repo, 'claude', 'CLAUDE.md')), false,
      'dry-run 不得寫入 repo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 非互動安全：to-local 無 --yes 在非 TTY 下應報錯而非卡死（呼應 askConfirm 守衛）
// -----------------------------------------------------------------------------
test('to-local（非 TTY、無 --yes）：有差異時報錯退出而非 hang', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO');

    const r = run(repo, home, ['to-local']);  // spawn 的 stdin 非 TTY
    assert.equal(r.status, 2, `應以 EXIT_ERROR 退出\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /非互動環境/, '應提示非互動環境');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// skills:diff：三向集合差 + 退出碼語義（供 CI）+ 建議指令
// -----------------------------------------------------------------------------
test('skills:diff：兩邊皆空 → 完全一致、exit 0', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const r = run(repo, home, ['skills:diff']);
    assert.equal(r.status, 0, `應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /完全一致/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:diff：repo 有、本機未裝 → exit 1 並建議 npx skills add', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'skills-lock.json'),
      { skills: { foo: { source: 'https://skills.sh/x/foo' } } });

    const r = run(repo, home, ['skills:diff']);
    assert.equal(r.status, 1, `差異應 exit EXIT_DIFF=1\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /repo 有、本機未安裝/);
    assert.match(r.stdout, /npx skills add https:\/\/skills\.sh\/x\/foo .*--skill foo/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:diff：本機有、repo 未記錄 → exit 1 並列出加入/移除兩選項', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(home, '.agents', '.skill-lock.json'),
      { skills: { bar: { source: 'org/bar' } } });

    const r = run(repo, home, ['skills:diff']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /本機有、repo 未記錄/);
    assert.match(r.stdout, /npm run skills:add -- bar org\/bar/);
    assert.match(r.stdout, /npx skills remove bar/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 同步流程降責：敏感命名、known secret value 與 HOME 路徑不再讓同步中止
// -----------------------------------------------------------------------------
test('to-repo：敏感命名、known secret 與 HOME 路徑不再中止', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const token = 'sk-' + 'b'.repeat(20);
    writeJson(path.join(home, '.claude', 'settings.json'),
      {
        permissions: { additionalDirectories: ['/home/leaky/proj'] },
        integrations: { apiToken: token },
      });

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 不應因安全訊號中止\n${r.stdout}\n${r.stderr}`);
    const written = JSON.parse(fs.readFileSync(path.join(repo, 'claude', 'settings.json'), 'utf8'));
    assert.equal(written.integrations.apiToken, token);
    assert.deepEqual(written.permissions.additionalDirectories, ['/home/leaky/proj']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('diff：本機 settings 含家目錄路徑 → 一般 settings 差異，不標記 blocked', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(home, '.claude', 'settings.json'),
      { permissions: { additionalDirectories: ['/home/leaky/proj'] } });
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'SAME');
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'SAME');

    const r = run(repo, home, ['diff']);
    assert.equal(r.status, 1, `diff 應回 EXIT_DIFF=1 而非中止 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /claude\/settings\.json/, 'settings.json 應列為一般差異');
    assert.doesNotMatch(r.stdout, /值層防線命中|blocked/, '不應再標記 blocked');
    assert.match(r.stdout, /claude\/CLAUDE\.md/, '其他項目仍應照常列出');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-local --dry-run：本機 settings 含家目錄路徑 → 不中止、正常預覽', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: { allow: ['x'] } });
    writeJson(path.join(home, '.claude', 'settings.json'),
      { permissions: { additionalDirectories: ['/home/leaky/proj'] } });

    const r = run(repo, home, ['to-local', '--dry-run']);
    assert.equal(r.status, 0, `to-local dry-run 不涉及寫回 repo，不應中止\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /settings\.json.*將更新/, '應照常預覽 settings 更新');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// exit code 對照組：diff 完全一致 → EXIT_OK=0（僅 EXIT_DIFF=1 有測不足以鎖住語義）
// -----------------------------------------------------------------------------
test('diff：本機與 repo 完全一致 → exit 0', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'SAME');
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'SAME');

    const r = run(repo, home, ['diff']);
    assert.equal(r.status, 0, `無差異應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /本機與 repo 完全一致/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Codex 項目端到端：AGENTS.md direction-aware swap
// config.toml 已不同步（改由 README 列建議設定、使用者手動套用），下方兩個
// 回歸測試把「不碰 config.toml」鎖住：本機檔不得被讀進 repo、repo 檔不得被套回本機。
// -----------------------------------------------------------------------------
test('to-repo：codex/AGENTS.md 寫入 repo；本機 config.toml 不被同步', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.codex', 'AGENTS.md'), 'CODEX-AGENTS');
    writeText(path.join(home, '.codex', 'config.toml'),
      'personality = "friendly"\nmodel = "o3"\n\n[tui]\nstatus_line = "on"\n');

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(repo, 'codex', 'AGENTS.md'), 'utf8'),
      'CODEX-AGENTS', 'codex/AGENTS.md 應寫入 repo');
    assert.equal(fs.existsSync(path.join(repo, 'codex', 'config.toml')), false,
      '本機 config.toml 不得被同步進 repo');
    assert.doesNotMatch(r.stdout, /config\.toml/, '輸出不應再提及 config.toml');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-local --yes：codex/AGENTS.md 套用到本機；本機 config.toml 原封不動', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'codex', 'AGENTS.md'), 'CODEX-B');
    // repo 若殘留 config.toml（人工放置），不得被套用到本機
    writeText(path.join(repo, 'codex', 'config.toml'), 'personality = "bold"\n');
    writeText(path.join(home, '.codex', 'config.toml'), 'model = "o3"\n');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `to-local 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8'),
      'CODEX-B', 'codex/AGENTS.md 應套用到本機');
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'),
      'model = "o3"\n', '本機 config.toml 須原封不動（不被 repo 內容覆寫或合併）');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 部分失敗可見度：apply 中途拋錯時，已寫入變更須列出並警告中斷
// （與 handleSignal 的訊號中斷警告互補；此前例外中斷路徑零可見度）
// -----------------------------------------------------------------------------
test('to-repo 中途失敗：已寫入項目照常列出、警告部分中斷', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'GOOD-CONTENT');
    // 讓 commands 目錄同步失敗：repo 端同名路徑是目錄，寫檔／比對必拋錯
    writeText(path.join(home, '.claude', 'commands', 'pkg', 'zzz.md'), 'Z');
    fs.mkdirSync(path.join(repo, 'claude', 'commands', 'pkg', 'zzz.md'), { recursive: true });

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 2, `中途失敗應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /claude\/CLAUDE\.md/, '失敗前已寫入的項目仍應列出');
    assert.equal(fs.readFileSync(path.join(repo, 'claude', 'CLAUDE.md'), 'utf8'),
      'GOOD-CONTENT', 'CLAUDE.md 確實已寫入');
    assert.match(r.stderr, /同步因錯誤中斷：已寫入 \d+ 筆變更/, '應警告部分中斷與已寫入筆數');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 路徑遮罩：二進位檔 diff（外部 diff 的「Binary files X and Y differ」）不得洩漏絕對路徑
// -----------------------------------------------------------------------------
test('diff：二進位檔差異輸出不得含沙箱絕對路徑', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const localBin = path.join(home, '.claude', 'CLAUDE.md');
    const repoBin = path.join(repo, 'claude', 'CLAUDE.md');
    fs.mkdirSync(path.dirname(localBin), { recursive: true });
    fs.mkdirSync(path.dirname(repoBin), { recursive: true });
    fs.writeFileSync(localBin, Buffer.from([0x42, 0x49, 0x4e, 0x31, 0x00, 0x01]));
    fs.writeFileSync(repoBin, Buffer.from([0x42, 0x49, 0x4e, 0x32, 0x00, 0x02]));

    const r = run(repo, home, ['diff']);
    assert.equal(r.status, 1, `有差異應 exit 1\n${r.stdout}\n${r.stderr}`);
    const output = r.stdout + r.stderr;
    assert.ok(!output.includes(root), `輸出不得含沙箱絕對路徑（外部 diff 的 Binary files 訊息須遮罩）\n${output}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// dispatch drift-guard：每個 COMMANDS 登錄指令都須能被 runCommand 分派，
// 不落入「未知指令」default——鎖住「新增指令漏改 runCommand switch」的漂移。
// 以 --dry-run --yes 讓破壞性指令安全非互動執行；缺參數的 skills:* 會回其自身
// 參數錯誤（非「未知指令」），故 guard 只斷言「未落 default 分支」。
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// xtool-skills：跨工具全域 skill 雙向 apply、共管安全、碰撞守門、幂等、D5 遷移
// managedSkillNames 以 sandbox repo/agents/skills 為準（REPO_ROOT = sandbox repo）
// -----------------------------------------------------------------------------
const AGENTS_SKILL = (home, name, rel) => path.join(home, '.agents', 'skills', name, rel);
const CLAUDE_SKILL_LINK = (home, name) => path.join(home, '.claude', 'skills', name);

test('xtool to-local：repo agents/skills → ~/.agents 真實目錄 + ~/.claude symlink 橋', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'FOO');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `to-local 應 exit 0\n${r.stdout}\n${r.stderr}`);
    // ~/.agents/skills/foo 為真實目錄、內容正確
    assert.equal(fs.lstatSync(AGENTS_SKILL(home, 'foo', 'SKILL.md')).isFile(), true);
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'utf8'), 'FOO');
    // ~/.claude/skills/foo 為指向正典的 symlink，內容經 symlink 可達
    const link = CLAUDE_SKILL_LINK(home, 'foo');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'claude 探索點應為 symlink');
    assert.equal(fs.readlinkSync(link), path.join(home, '.agents', 'skills', 'foo'));
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'FOO');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool to-repo：只從 ~/.agents/skills/<受管名字> 讀回 repo，不吸入非受管住戶', () => {
  const { repo, home, root } = setupSandbox();
  try {
    // repo 受管：foo；本機 ~/.agents 有 foo（更新）與 npxresident（非受管）
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'OLD');
    writeText(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'NEW');
    writeText(AGENTS_SKILL(home, 'npxresident', 'SKILL.md'), 'RESIDENT');

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'utf8'),
      'NEW', '受管 foo 應讀回 repo');
    assert.equal(fs.existsSync(path.join(repo, 'agents', 'skills', 'npxresident')), false,
      '非受管住戶不得被吸入 repo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool 共管不誤刪：~/.agents 內非受管 skill 於 to-local 後原封不動（回歸鎖 D3）', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'FOO');
    writeText(AGENTS_SKILL(home, 'other', 'SKILL.md'), 'OTHER'); // npx 住戶，不在 repo

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'other', 'SKILL.md'), 'utf8'),
      'OTHER', '非受管 skill 不得被 prune');
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'utf8'), 'FOO');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool 碰撞守門：撞名（lock 已登記）→ 拒絕覆寫、印 warning，apply 續行', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'REPO');
    writeJson(path.join(home, '.agents', '.skill-lock.json'),
      { skills: { foo: { source: 'org/foo' } } });
    writeText(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'NPX-INSTALLED');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `碰撞為 warning、apply 應續行 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'utf8'),
      'NPX-INSTALLED', '撞名 skill 不得被覆寫');
    assert.match(r.stderr + r.stdout, /拒絕覆寫|撞名/, '應印出碰撞 warning');
    // 不應建立 claude 探索點（跳過該 skill）
    assert.equal(fs.existsSync(CLAUDE_SKILL_LINK(home, 'foo')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool diff：撞名以 conflict 狀態標示、計入 EXIT_DIFF=1', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'REPO');
    writeJson(path.join(home, '.agents', '.skill-lock.json'),
      { skills: { foo: { source: 'org/foo' } } });

    const r = run(repo, home, ['diff']);
    assert.equal(r.status, 1, `碰撞應計入 EXIT_DIFF=1\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /agents\/skills\/foo/, '應列出撞名 skill');
    assert.match(r.stdout, /撞名|拒絕覆寫/, '應以 conflict 語意標示');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool 幂等：受管 skill apply 成功後再 apply 不判碰撞、宣告一致', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'FOO');

    const r1 = run(repo, home, ['to-local', '--yes']);
    assert.equal(r1.status, 0, `首次 apply\n${r1.stdout}\n${r1.stderr}`);
    // 第二次：~/.agents/skills/foo 存在、~/.claude symlink 為本機制所建、foo 未登記 lock
    const r2 = run(repo, home, ['to-local', '--yes']);
    assert.equal(r2.status, 0, `再次 apply\n${r2.stdout}\n${r2.stderr}`);
    assert.match(r2.stdout, /完全一致|無需套用/, '幂等：第二次應無變更、不判碰撞');
    assert.doesNotMatch(r2.stdout + r2.stderr, /拒絕覆寫|撞名/, '本機制自身產物不得被判為碰撞');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool D5 遷移：~/.claude/skills/foo 舊真實目錄 → to-local 轉為 symlink，內容從 ~/.agents 可達', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'V2');
    // 舊機制：~/.claude/skills/foo 為真實目錄
    writeText(path.join(home, '.claude', 'skills', 'foo', 'SKILL.md'), 'OLD');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    // 正典寫入 ~/.agents
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'utf8'), 'V2');
    // 真實目錄轉為 symlink
    const link = CLAUDE_SKILL_LINK(home, 'foo');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, '真實目錄應轉為 symlink');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'V2', '內容從正典可達');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// root 會繞過檔案權限，唯讀目錄擋不住寫入，故此測試在 root 下跳過
const itNonRoot = (process.getuid && process.getuid() === 0) ? test.skip : test;
itNonRoot('xtool D5 遷移中途失敗：正典已先落 ~/.agents，partialChanges 可見、警告部分中斷', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'CANON');
    // 讓 symlink 橋建立失敗：~/.claude 設唯讀，apply 期建 ~/.claude/skills 目錄必拋
    // （diff 期只 lstat 尚不存在的路徑，不受阻，確保失敗落在 apply 而非 diff）
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.chmodSync(path.join(home, '.claude'), 0o500);

    const r = run(repo, home, ['to-local', '--yes']);
    fs.chmodSync(path.join(home, '.claude'), 0o700); // 還原以便 rmSync 清理
    assert.equal(r.status, 2, `中途失敗應 exit 2\n${r.stdout}\n${r.stderr}`);
    // 正典內容已安全落在 ~/.agents（不因 symlink 失敗而遺失）
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'utf8'), 'CANON',
      '正典內容須已先安全落在 ~/.agents');
    assert.match(r.stdout, /agents\/skills\/foo/, '已寫入的正典變更須列出');
    assert.match(r.stderr, /同步因錯誤中斷|已寫入 \d+ 筆變更/, '應警告部分中斷');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool + claude mirror 共存：claude 區 mirror 不誤刪 agents 探索點 symlink（P4 回歸）', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'FOO');       // 跨工具
    writeText(path.join(repo, 'claude', 'skills', 'conly', 'SKILL.md'), 'CONLY');   // Claude-only

    const r1 = run(repo, home, ['to-local', '--yes']);
    assert.equal(r1.status, 0, `${r1.stdout}\n${r1.stderr}`);
    assert.equal(fs.lstatSync(CLAUDE_SKILL_LINK(home, 'foo')).isSymbolicLink(), true, 'foo 為探索點 symlink');
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'skills', 'conly', 'SKILL.md'), 'utf8'),
      'CONLY', 'Claude-only skill 為真實檔');

    // 再跑一次：claude mirror（getFiles 跳過逃逸 symlink）不得刪掉 agents 探索點
    const r2 = run(repo, home, ['to-local', '--yes']);
    assert.equal(r2.status, 0, `${r2.stdout}\n${r2.stderr}`);
    assert.equal(fs.lstatSync(CLAUDE_SKILL_LINK(home, 'foo')).isSymbolicLink(), true, '探索點 symlink 應存活');
    assert.equal(fs.readFileSync(path.join(CLAUDE_SKILL_LINK(home, 'foo'), 'SKILL.md'), 'utf8'), 'FOO');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool 空 claude/skills 情境：agents 端先轉 symlink，空 src claude mirror 不刪探索點', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'FOO');
    fs.mkdirSync(path.join(repo, 'claude', 'skills'), { recursive: true }); // 存在但為空
    // 舊機制：~/.claude/skills/foo 為真實目錄
    writeText(path.join(home, '.claude', 'skills', 'foo', 'SKILL.md'), 'OLD');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    // xtool 列在前：先轉 symlink；空 src 的 claude mirror 不得刪除（getFiles 跳過逃逸 symlink）
    const link = CLAUDE_SKILL_LINK(home, 'foo');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'foo 應被轉為並保留為 symlink');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'FOO', '內容來自正典');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool to-repo：~/.claude 探索點 symlink 不被吸回 repo claude/skills', () => {
  const { repo, home, root } = setupSandbox();
  try {
    // 先建立正典 + 探索點
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'FOO');
    run(repo, home, ['to-local', '--yes']);
    // to-repo：getFiles(~/.claude/skills) 應跳過 foo 探索點（逃逸 symlink），不寫進 repo claude/skills
    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.existsSync(path.join(repo, 'claude', 'skills', 'foo')), false,
      '探索點 symlink 不得被吸回 repo claude/skills');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dispatch guard：COMMANDS 每個指令皆可被 runCommand 分派（不落未知指令）', () => {
  const { repo, home, root } = setupSandbox();
  try {
    for (const cmd of Object.keys(COMMANDS)) {
      const r = run(repo, home, [cmd, '--dry-run', '--yes']);
      const output = `${r.stdout}\n${r.stderr}`;
      assert.ok(!output.includes('未知指令'),
        `指令 "${cmd}" 應被 runCommand 分派，卻落入「未知指令」default\n${output}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

