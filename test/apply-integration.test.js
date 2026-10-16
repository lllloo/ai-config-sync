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

// sync.js require('./safety-check.js')，任何 `node sync.js` 指令缺任一檔即崩，故兩檔同抄。
const SYNC_RUNTIME_FILES = ['sync.js', 'safety-check.js'];

/**
 * 建立沙箱：repo（含 sync.js + safety-check.js 副本、git init）與 home。
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

test('to-local --yes：settings.json 套用輸出與預覽一致（完整標籤、新增記為 added）', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: ['x'] });

    const added = run(repo, home, ['to-local', '--yes']);
    assert.equal(added.status, 0, `to-local 應 exit 0\n${added.stdout}\n${added.stderr}`);
    assert.match(added.stdout, /\[\+\] claude\/settings\.json\n/, '套用行應用完整標籤與新增圖示');
    assert.match(added.stdout, /claude\/settings\.json \(added\)/, '本機缺檔 → changeLog 記為 added');

    writeJson(path.join(repo, 'claude', 'settings.json'), { permissions: ['y'] });
    const updated = run(repo, home, ['to-local', '--yes']);
    assert.match(updated.stdout, /claude\/settings\.json \(updated\)/, '本機已存在 → changeLog 記為 updated');
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

// 全域 skill 已改由 npx skills 安裝（global-skills-via-npx）：to-local 不得再寫入、刪除
// 或修復三個 skill 目錄下的任何項目——內容 + mtime 雙重斷言，避免「寫入相同內容」漏網。
test('to-local：~/.agents/skills、~/.claude/skills、~/.gemini/config/skills 內容與 mtime 均不被觸碰', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'claude', 'CLAUDE.md'), 'REPO-CONTENT');
    writeText(path.join(repo, 'skills', 'map', 'SKILL.md'), 'repo skill');
    const canon = path.join(home, '.agents', 'skills', 'map', 'SKILL.md');
    const bridges = [
      path.join(home, '.claude', 'skills', 'map', 'SKILL.md'),
      path.join(home, '.gemini', 'config', 'skills', 'map', 'SKILL.md'),
    ];
    for (const f of [canon, ...bridges]) writeText(f, 'local skill (older)');
    const before = [canon, ...bridges].map(f => fs.statSync(f).mtimeMs);

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

    [canon, ...bridges].forEach((f, i) => {
      assert.equal(fs.readFileSync(f, 'utf8'), 'local skill (older)', `${f} 內容不得改變`);
      assert.equal(fs.statSync(f).mtimeMs, before[i], `${f} 不得被寫入`);
      assert.equal(fs.lstatSync(path.dirname(f)).isSymbolicLink(), false, `${f} 所在目錄不得被換成 symlink`);
    });
    assert.doesNotMatch(r.stdout, /skills\/map/, 'to-local 輸出不得列出 skill 項目');
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

// repo 為最終版本：to-repo 後的下一步是「把關 → 複核 → commit」，push 公開 repo 另由使用者決定，
// 不得再串成一行 `git add -A && git commit && git push`；指令一律走 node sync.js。
test('to-repo：下一步提示先 safety:check 再 commit，不串 git push、不用 npm run', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'LOCAL');

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /下一步/);
    assert.match(r.stdout, /node sync\.js safety:check/);
    assert.match(r.stdout, /git commit -m "chore\(sync\): /, 'commit 訊息沿用專案格式');
    assert.doesNotMatch(r.stdout, /&& git push/, 'push 不得串在 commit 之後');
    assert.doesNotMatch(r.stdout, /npm run/);
    assert.doesNotMatch(r.stdout, /git add -A/, '只 add 同步來源目錄，不得夾帶無關檔案');
    assert.match(r.stdout, /git add claude codex gemini /);
    assert.ok(!r.stdout.includes(`from ${os.hostname()}`), 'commit 訊息不得帶主機名（repo 公開）');
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

test('to-repo：gemini/GEMINI.md 寫入 repo', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.gemini', 'GEMINI.md'), 'GEMINI-AGENTS');

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 0, `to-repo 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(repo, 'gemini', 'GEMINI.md'), 'utf8'),
      'GEMINI-AGENTS', 'gemini/GEMINI.md 應寫入 repo');
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

test('to-local --yes：gemini/GEMINI.md 套用到本機', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(repo, 'gemini', 'GEMINI.md'), 'GEMINI-B');

    const r = run(repo, home, ['to-local', '--yes']);
    assert.equal(r.status, 0, `to-local 應 exit 0\n${r.stdout}\n${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'utf8'),
      'GEMINI-B', 'gemini/GEMINI.md 應套用到本機');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// 部分失敗可見度：apply 中途拋錯時，已寫入變更須列出並警告中斷
// （訊號中斷不會造成部分寫入，只有例外路徑需要此可見度）
// -----------------------------------------------------------------------------
test('to-repo 中途失敗：已寫入項目照常列出、警告部分中斷', () => {
  const { repo, home, root } = setupSandbox();
  try {
    writeText(path.join(home, '.claude', 'CLAUDE.md'), 'GOOD-CONTENT');
    // 讓後段項目（codex/AGENTS.md）同步失敗：repo 端同名路徑是目錄，寫檔／比對必拋錯
    writeText(path.join(home, '.codex', 'AGENTS.md'), 'Z');
    fs.mkdirSync(path.join(repo, 'codex', 'AGENTS.md'), { recursive: true });

    const r = run(repo, home, ['to-repo']);
    assert.equal(r.status, 2, `中途失敗應 exit 2\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /claude\/CLAUDE\.md/, '失敗前已寫入的項目仍應列出');
    assert.equal(fs.readFileSync(path.join(repo, 'claude', 'CLAUDE.md'), 'utf8'),
      'GOOD-CONTENT', '已成功寫入的檔案應保留在磁碟上');
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
