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

const SYNC_JS = path.join(__dirname, '..', 'sync.js');

/**
 * 建立沙箱：repo（含 sync.js 副本、git init）與 home。
 * @returns {{repo: string, home: string}}
 */
function setupSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-apply-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  fs.copyFileSync(SYNC_JS, path.join(repo, 'sync.js'));
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
// Codex 項目端到端：direction-aware swap + config.toml 白名單過濾（此前僅有純函式測試）
// -----------------------------------------------------------------------------
test('to-repo：codex/AGENTS.md 寫入 repo，config.toml 僅可攜欄位進 repo', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.codex', 'AGENTS.md'), 'CODEX-AGENTS');
    writeText(path.join(home, '.codex', 'config.toml'),
      'personality = "friendly"\nmodel = "o3"\n\n[tui]\nstatus_line = "on"\n');

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(repo, 'codex', 'AGENTS.md'), 'utf8'),
      'CODEX-AGENTS', 'codex/AGENTS.md 應寫入 repo');
    const toml = fs.readFileSync(path.join(repo, 'codex', 'config.toml'), 'utf8');
    assert.match(toml, /personality = "friendly"/, '可攜 top-level 欄位應進 repo');
    assert.match(toml, /status_line = "on"/, '可攜 section 欄位應進 repo');
    assert.ok(!toml.includes('model'), '非白名單欄位（裝置特定）不得進 repo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-local --yes：codex 內容套用到本機，config.toml 保留本機未受管理欄位', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'codex', 'AGENTS.md'), 'CODEX-B');
    writeText(path.join(repo, 'codex', 'config.toml'), 'personality = "bold"\n');
    writeText(path.join(home, '.codex', 'config.toml'), 'model = "o3"\n');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `to-local 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8'),
      'CODEX-B', 'codex/AGENTS.md 應套用到本機');
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(toml, /personality = "bold"/, '可攜欄位應從 repo 帶入');
    assert.match(toml, /model = "o3"/, '本機未受管理欄位（model）須保留');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 部分失敗可見度：apply 中途拋錯時，已寫入變更須列出並記入 .sync-history.log
// （與 handleSignal 的訊號中斷警告互補；此前例外中斷路徑零可見度、audit trail 全失）
// -----------------------------------------------------------------------------
test('to-repo 中途失敗：已寫入項目照常列出、警告部分中斷、audit log 留有紀錄', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'GOOD-CONTENT');
    // 讓 agents 目錄同步失敗：repo 端同名路徑是目錄，寫檔／比對必拋錯
    writeText(path.join(home, '.claude', 'agents', 'pkg', 'zzz.md'), 'Z');
    fs.mkdirSync(path.join(repo, 'claude', 'agents', 'pkg', 'zzz.md'), { recursive: true });

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 2, `中途失敗應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /claude\/CLAUDE\.md/, '失敗前已寫入的項目仍應列出');
    assert.equal(fs.readFileSync(path.join(repo, 'claude', 'CLAUDE.md'), 'utf8'),
      'GOOD-CONTENT', 'CLAUDE.md 確實已寫入');
    assert.match(r.stderr, /同步因錯誤中斷：已寫入 \d+ 筆變更/, '應警告部分中斷與已寫入筆數');
    const logPath = path.join(repo, '.sync-history.log');
    assert.ok(fs.existsSync(logPath), '.sync-history.log 應留有部分結果紀錄');
    const log = fs.readFileSync(logPath, 'utf8');
    assert.match(log, /claude\/CLAUDE\.md \(added\)/, 'log 應含已寫入變更');
    assert.match(log, /因錯誤中斷/, 'log 應標記中斷');
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
