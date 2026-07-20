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

// 回歸（remove-mcp-sync）：MCP 同步移除後，~/.claude.json 與 ~/.codex/config.toml 連
// 唯讀讀取的程式路徑都不存在。這兩個檔案是高風險敏感活檔（OAuth token、專案歷史、
// API key），任何寫入都不可接受——以內容 + mtime 雙重斷言鎖住（只驗內容會漏掉
// 「寫入相同內容」）。日後重新設計 MCP 同步時，此測試應為第一道要面對的閘門。
test('to-local：~/.claude.json 與 ~/.codex/config.toml 內容與 mtime 均不被觸碰', () => {
  const { repo, home, root } = setupSandbox();
  try {
    // 讓 to-local 確實有東西要寫，確保走的是完整 apply 路徑而非 early return
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-CONTENT');

    const claudeJson = path.join(home, '.claude.json');
    const codexToml = path.join(home, '.codex', 'config.toml');
    const claudeJsonBody = JSON.stringify({ mcpServers: { existing: { type: 'http' } } }, null, 2) + '\n';
    const codexTomlBody = 'personality = "friendly"\n\n[mcp_servers.local_tool]\ncommand = "node"\n';
    writeText(claudeJson, claudeJsonBody);
    writeText(codexToml, codexTomlBody);
    const beforeClaude = fs.statSync(claudeJson).mtimeMs;
    const beforeCodex = fs.statSync(codexToml).mtimeMs;

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

    assert.equal(fs.readFileSync(claudeJson, 'utf8'), claudeJsonBody, '~/.claude.json 內容不得改變');
    assert.equal(fs.readFileSync(codexToml, 'utf8'), codexTomlBody, 'config.toml 內容不得改變');
    assert.equal(fs.statSync(claudeJson).mtimeMs, beforeClaude, '~/.claude.json 不得被寫入');
    assert.equal(fs.statSync(codexToml).mtimeMs, beforeCodex, 'config.toml 不得被寫入');
    // 舊版投影同步的受管 state 檔亦不得復活
    assert.equal(fs.existsSync(path.join(home, '.codex', '.ai-config-sync-mcp-state.json')), false);
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
// 互動確認閘門：askConfirm 回 false 時 confirmAndApply 必須取消、一個檔案都不寫
//
// 這是使用者與「覆寫真實 ~/.claude」之間唯一的閘門，但真實 TTY 無法在 spawn 中取得
// （零相依、不引入 pty）。改以 `node -r <preload>` 於子程序啟動前偽裝互動環境：
// 設 stdin.isTTY 並替換 readline.createInterface，讓 askConfirm 走完整互動分支。
// sync.js 於載入時 require('readline') 取得同一個 builtin 模組物件，且在呼叫時才
// 讀 createInterface，故 preload 的覆寫生效。
//   FAKE_CONFIRM=<answer> → question callback 以該答案回覆（模擬使用者輸入）
//   FAKE_CONFIRM=__eof__  → 不作答、直接觸發 close 事件（模擬 Ctrl+D）
// -----------------------------------------------------------------------------
const FAKE_TTY_PRELOAD = `
'use strict';
process.stdin.isTTY = true;
const readline = require('readline');
readline.createInterface = () => ({
  question(q, cb) {
    process.stdout.write(q);
    if (process.env.FAKE_CONFIRM !== '__eof__') setImmediate(() => cb(process.env.FAKE_CONFIRM));
  },
  close() {},
  on(event, cb) {
    if (event === 'close' && process.env.FAKE_CONFIRM === '__eof__') setImmediate(cb);
  },
});
`;

/** 以偽裝 TTY 執行 sync.js，answer 為使用者輸入（或 '__eof__' 模擬 Ctrl+D） */
function runInteractive(repo, home, args, answer) {
  const preload = path.join(repo, 'fake-tty-preload.js');
  fs.writeFileSync(preload, FAKE_TTY_PRELOAD);
  return spawnSync(process.execPath, ['-r', preload, path.join(repo, 'sync.js'), ...args], {
    cwd: repo,
    env: noColorEnv({ HOME: home, USERPROFILE: home, FAKE_CONFIRM: answer }),
    encoding: 'utf8',
  });
}

// 對照組：偽裝 TTY 下輸入 y 確實會套用（確保下方「拒絕」測試不是因 harness 失效而綠）
test('to-local 互動：輸入 y → 實際套用', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-YES');

    const r = runInteractive(repo, home, ['to-local'], 'y');
    assert.equal(r.status, 0, `應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'),
      'REPO-YES', '輸入 y 應套用到本機');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const answer of ['n', '', 'nope']) {
  test(`to-local 互動：輸入 ${JSON.stringify(answer)} → 取消、本機不得被寫入`, () => {
    const { repo, home, root } = setupSandbox();
    try {
      writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-ONLY');
      writeText(path.join(home, '.claude', 'CLAUDE.md'), 'LOCAL-KEEP');

      const r = runInteractive(repo, home, ['to-local'], answer);
      assert.equal(r.status, 0, `取消為正常結束\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /已取消/, '應宣告已取消');
      assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'),
        'LOCAL-KEEP', '拒絕確認後本機檔案不得被覆寫');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

// Ctrl+D（EOF）：未作答就關閉 readline，須視為未確認而非預設同意
test('to-local 互動：EOF（未作答即 close）→ 取消、本機不得被寫入', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-ONLY');
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'LOCAL-KEEP');

    const r = runInteractive(repo, home, ['to-local'], '__eof__');
    assert.equal(r.status, 0, `取消為正常結束\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /已取消/, 'EOF 應視為未確認');
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'),
      'LOCAL-KEEP', 'EOF 後本機檔案不得被覆寫');
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
// skills:add / skills:remove：實際寫入 skills-lock.json 的端到端行為
// 此前只有 parseSkillSource 純函式與 skills:diff 被覆蓋，寫入路徑（撞名不覆寫、
// lock 初始化、remove happy path、缺檔/缺引數錯誤）無任何回歸防護。
// -----------------------------------------------------------------------------
function readLock(repo) {
  return JSON.parse(fs.readFileSync(path.join(repo, 'skills-lock.json'), 'utf8'));
}

test('skills:add：name+source 形式 → 寫入 lock、exit 0、印安裝指令', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const r = run(repo, home, ['skills:add', 'foo', 'org/foo']);
    assert.equal(r.status, 0, `應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(readLock(repo).skills.foo, { source: 'org/foo', sourceType: 'github' });
    assert.match(r.stdout, /已加入/);
    assert.match(r.stdout, /npx skills add org\/foo .*--skill foo/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:add：lock 不存在時初始化 version:1 並寫入', () => {
  const { repo, home, root } = setupSandbox();
  try {
    assert.equal(fs.existsSync(path.join(repo, 'skills-lock.json')), false, '前提：無 lock');
    const r = run(repo, home, ['skills:add', 'foo', 'org/foo']);
    assert.equal(r.status, 0, `應 exit 0\n${r.stdout}\n${r.stderr}`);
    const lock = readLock(repo);
    assert.equal(lock.version, 1);
    assert.equal(lock.skills.foo.source, 'org/foo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:add：URL 形式解析 name/source', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const r = run(repo, home, ['skills:add', 'https://skills.sh/acme/repo/myskill']);
    assert.equal(r.status, 0, `應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(readLock(repo).skills.myskill, { source: 'acme/repo', sourceType: 'github' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:add：撞名不覆寫既有 source、exit 0 並警告', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'skills-lock.json'),
      { version: 1, skills: { foo: { source: 'orig/foo', sourceType: 'github' } } });
    const r = run(repo, home, ['skills:add', 'foo', 'other/foo']);
    assert.equal(r.status, 0, `撞名應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /已存在/);
    assert.equal(readLock(repo).skills.foo.source, 'orig/foo', '不得覆寫既有 source');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:add：缺來源引數 → INVALID_ARGS exit 2', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const r = run(repo, home, ['skills:add']);
    assert.equal(r.status, 2, `缺引數應 exit 2\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:remove：移除既有 skill、exit 0、印 npx remove 指令', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'skills-lock.json'), {
      version: 1,
      skills: {
        foo: { source: 'org/foo', sourceType: 'github' },
        bar: { source: 'org/bar', sourceType: 'github' },
      },
    });
    const r = run(repo, home, ['skills:remove', 'foo']);
    assert.equal(r.status, 0, `應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /已移除/);
    assert.match(r.stdout, /npx skills remove foo/);
    const lock = readLock(repo);
    assert.equal(lock.skills.foo, undefined, 'foo 應被移除');
    assert.ok(lock.skills.bar, 'bar 應保留');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:remove：不在 lock → no-op、exit 0 並提示', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'skills-lock.json'),
      { version: 1, skills: { bar: { source: 'org/bar', sourceType: 'github' } } });
    const r = run(repo, home, ['skills:remove', 'foo']);
    assert.equal(r.status, 0, `不存在應 no-op exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /不在 skills-lock\.json/);
    assert.ok(readLock(repo).skills.bar, '既有項不受影響');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('skills:remove：lock 檔不存在 → FILE_NOT_FOUND exit 2', () => {
  const { repo, home, root } = setupSandbox();
  try {
    const r = run(repo, home, ['skills:remove', 'foo']);
    assert.equal(r.status, 2, `缺 lock 應 exit 2\n${r.stdout}\n${r.stderr}`);
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
    // 讓 dir 型項目（rules）同步失敗：repo 端同名路徑是目錄，寫檔／比對必拋錯
    writeText(path.join(home, '.claude', 'rules', 'pkg', 'zzz.md'), 'Z');
    fs.mkdirSync(path.join(repo, 'claude', 'rules', 'pkg', 'zzz.md'), { recursive: true });

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

// -----------------------------------------------------------------------------
// Claude 探索點的 D5 轉換守門（bridgeUnsafeReason／findUnmirroredFiles）
// ensureSymlink 對真實目錄是遞迴 rm，其安全前提「正典內容已落在 target」只由
// upsertOneSkill 保證到「repo 有的檔案」；使用者自寫、repo 從未有過的檔案曾因此
// 被靜默永久刪除（且預覽只印「將更新」）。以下三條同時鎖住「該擋的要擋」與
// 「不該擋的別擋」——只測前者會讓過度保護的實作矇混過關（正常 D5 遷移全被跳過）。
// -----------------------------------------------------------------------------

test('xtool D5 守門：claude 探索點含 repo 沒有的檔案 → 拒絕刪除、使用者檔案保留', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'V2');
    // 使用者自寫的同名 Claude-only skill：SKILL.md 撞名，notes.md 是 repo 從未有過的檔
    writeText(path.join(home, '.claude', 'skills', 'foo', 'SKILL.md'), 'MINE');
    writeText(path.join(home, '.claude', 'skills', 'foo', 'notes.md'), 'PRECIOUS');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'skills', 'foo', 'notes.md'), 'utf8'),
      'PRECIOUS', 'repo 沒有的使用者檔案不得被刪除');
    assert.equal(fs.lstatSync(CLAUDE_SKILL_LINK(home, 'foo')).isSymbolicLink(), false,
      '含未鏡射內容時不得轉成 symlink');
    assert.match(r.stderr, /拒絕刪除、跳過/, '應印出拒絕刪除的 warning');
    // 正典仍照常寫入（守門只跳過 claude 側橋接，不影響 ~/.agents 同步）
    assert.equal(fs.readFileSync(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'utf8'), 'V2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool D5 守門：diff 以 conflict 標示，不得把遞迴刪除說成「將更新」', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'V2');
    writeText(path.join(home, '.claude', 'skills', 'foo', 'notes.md'), 'PRECIOUS');

    const r = run(repo, home, ['to-local', '--dry-run', '--yes']);
    const bridgeLine = r.stdout.split('\n').find(l => l.includes('claude 探索點'));
    assert.ok(bridgeLine, `預覽應有探索點狀態行\n${r.stdout}`);
    assert.match(bridgeLine, /拒絕刪除、將跳過/, '應標示拒絕刪除');
    assert.doesNotMatch(bridgeLine, /將更新/, '不得把遞迴刪除呈現為「將更新」');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('xtool D5 守門：舊機制產物（repo 有對應來源、內容較舊）仍正常轉 symlink', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'V2');
    // 舊機制產物：路徑都來自 repo，只是內容過時——覆蓋它是 to-local 的正常語意
    writeText(path.join(home, '.claude', 'skills', 'foo', 'SKILL.md'), 'OLD');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const link = CLAUDE_SKILL_LINK(home, 'foo');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true,
      '內容過時不等於使用者資料，不得被守門擋下');
    assert.equal(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8'), 'V2');
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

// -----------------------------------------------------------------------------
// xtool 碰撞守門的方向對稱性：to-repo 與 to-local 同樣拒絕覆寫 npx 住戶
// （守門若被綁死在 to-local，to-repo 會把 npx 安裝的內容吸進 repo、覆蓋受管版本）
// -----------------------------------------------------------------------------
test('xtool 碰撞守門（to-repo）：撞名 → 拒絕覆寫 repo、印 warning、repo 內容不變', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'REPO-KEEP');
    writeJson(path.join(home, '.agents', '.skill-lock.json'),
      { skills: { foo: { source: 'org/foo' } } });
    writeText(AGENTS_SKILL(home, 'foo', 'SKILL.md'), 'NPX-INSTALLED');

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `碰撞為 warning、apply 應續行 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(repo, 'agents', 'skills', 'foo', 'SKILL.md'), 'utf8'),
      'REPO-KEEP', 'to-repo 方向亦不得被 npx 住戶覆寫');
    assert.match(r.stderr + r.stdout, /拒絕覆寫|撞名/, '應印出碰撞 warning');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// status：exit code 為 diff 與 skills:diff 的聯集（任一有差異即 EXIT_DIFF）
// -----------------------------------------------------------------------------
test('status：設定一致但 skills 有差異 → exit 1（聚合 skills:diff 的退出碼）', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'SAME');
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'SAME');
    writeJson(path.join(repo, 'skills-lock.json'),
      { version: 1, skills: { foo: { source: 'org/foo', sourceType: 'github' } } });

    const r = run(repo, home, ['status']);
    assert.match(r.stdout, /本機與 repo 完全一致/, '前提：設定端無差異（diff 回 EXIT_OK）');
    assert.match(r.stdout, /repo 有、本機未安裝/, '前提：skills 端有差異');
    assert.equal(r.status, 1, `skills 有差異即應 exit 1\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('status：設定與 skills 皆一致 → exit 0', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'SAME');
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'SAME');

    const r = run(repo, home, ['status']);
    assert.equal(r.status, 0, `兩端皆一致應 exit 0\n${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 首次出現 top-level key 提示的接線：findNewSettingsTopKeys 有單元測試，但
// 「diff／to-repo 真的呼叫它並印出」需端到端鎖住（漏接線時單元測試仍全綠）
// -----------------------------------------------------------------------------
test('diff：本機 settings 出現 repo 沒有的 top-level key → 印出該 key 名', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: { allow: ['Bash'] } });
    writeJson(path.join(home, '.claude', 'settings.json'),
      { permissions: { allow: ['Bash'] }, statusLine: { type: 'command' } });

    const r = run(repo, home, ['diff']);
    assert.match(r.stdout, /首次出現 top-level key/, 'diff 應印出首次出現 key 提示');
    assert.match(r.stdout, /statusLine/, '提示應點名該 key');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('to-repo：本機 settings 出現 repo 沒有的 top-level key → 印出該 key 名', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: { allow: ['Bash'] } });
    writeJson(path.join(home, '.claude', 'settings.json'),
      { permissions: { allow: ['Bash'] }, statusLine: { type: 'command' } });

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /首次出現 top-level key/, 'to-repo 應印出首次出現 key 提示');
    assert.match(r.stdout, /statusLine/, '提示應點名該 key');
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
