'use strict';

// =============================================================================
// settings.json 純函式單元測試
// 鎖定 serializeSettings / loadStrippedSettings / getStrippedSettings
// 三條路徑（to-repo / to-local / diff）的序列化結果必須一致，
// 防止結尾換行不對稱 bug 回歸（issue: to-local 比對誤判為 changed）
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  serializeSettings,
  loadStrippedSettings,
  getStrippedSettings,
  extractDeviceValues,
  mergeDeviceValues,
  PORTABLE_SETTINGS_KEYS,
} = require('../sync.js');
const { withTmpDir } = require('./helpers');

// -----------------------------------------------------------------------------
// 測試 fixture：每個測試在 withTmpDir 提供的 tmp 目錄內寫 JSON
// -----------------------------------------------------------------------------
function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

// -----------------------------------------------------------------------------
// serializeSettings：唯一序列化入口，必須含結尾換行
// -----------------------------------------------------------------------------
test('serializeSettings：輸出含結尾換行', () => {
  const out = serializeSettings({ a: 1 });
  assert.ok(out.endsWith('\n'), '必須以 \\n 結尾');
});

test('serializeSettings：使用 2 空格縮排', () => {
  const out = serializeSettings({ a: { b: 1 } });
  assert.equal(out, '{\n  "a": {\n    "b": 1\n  }\n}\n');
});

test('serializeSettings：空物件也含結尾換行', () => {
  assert.equal(serializeSettings({}), '{}\n');
});

// -----------------------------------------------------------------------------
// loadStrippedSettings：讀檔 + top-level 白名單收斂（PORTABLE_SETTINGS_KEYS）
// -----------------------------------------------------------------------------
test('loadStrippedSettings：檔案不存在回傳 null', () => {
  const result = loadStrippedSettings('/nonexistent/path/settings.json');
  assert.equal(result, null);
});

test('loadStrippedSettings：只保留白名單 top-level key 與白名單 env key', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      model: 'opus',
      effortLevel: 'high',
      defaultShell: 'powershell',
      env: { EDITOR: 'code --wait', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    });

    const result = loadStrippedSettings(fp);
    assert.ok(result, '應回傳 { clean, serialized }');
    assert.ok(!('model' in result.clean), 'model 應被移除');
    assert.ok(!('effortLevel' in result.clean), 'effortLevel 應被移除');
    assert.ok(!('defaultShell' in result.clean), 'defaultShell 應被移除');
    assert.ok(!('CLAUDE_CODE_USE_POWERSHELL_TOOL' in (result.clean.env ?? {})),
      'env.CLAUDE_CODE_USE_POWERSHELL_TOOL（非白名單）應被移除');
    assert.deepEqual(result.clean, { permissions: ['a'], env: { EDITOR: 'code --wait' } });
  });
});

test('loadStrippedSettings：serialized 欄位為 clean 的 serializeSettings 輸出', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { x: 1, model: 'opus' });

    const result = loadStrippedSettings(fp);
    assert.equal(result.serialized, serializeSettings(result.clean));
  });
});

test('loadStrippedSettings：全為白名單欄位時保持原樣', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a', 'b'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a', 'b'] });
  });
});

// -----------------------------------------------------------------------------
// env 欄位同步：白名單（PORTABLE_ENV_KEYS）內的 key 才跨裝置同步；
// 其餘 env key（含 API Key/token）一律剝除（不進 repo、不入 diff 輸出）
// -----------------------------------------------------------------------------
test('loadStrippedSettings：env 僅白名單 key 保留，非白名單（含金鑰）一律剝除', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      env: { EDITOR: 'nvim', ANTHROPIC_API_KEY: 'sk-secret', MY_KEY: 'value', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
      permissions: ['a'],
    });

    const result = loadStrippedSettings(fp);
    // EDITOR 在白名單 → 保留；ANTHROPIC_API_KEY / MY_KEY / CLAUDE_CODE_USE_POWERSHELL_TOOL 非白名單 → 剝除
    assert.deepEqual(result.clean, { env: { EDITOR: 'nvim' }, permissions: ['a'] });
  });
});

test('loadStrippedSettings：env 全為非白名單 key 時整個 env 鍵被移除', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { env: { ANTHROPIC_API_KEY: 'sk-secret' }, permissions: ['a'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a'] });
    assert.ok(!('env' in result.clean), '空的 env 應被移除');
  });
});

test('loadStrippedSettings：未知/裝置/憑證 top-level key 一律剝除（白名單結構性保證）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
      tui: 'modern',                       // 裝置偏好
      autoUpdatesChannel: 'latest',        // 裝置偏好
      apiKeyHelper: '/home/u/get-key.sh',  // 憑證 helper 路徑（敏感）
      someFutureKey: 'x',                  // 未知新欄位
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, {
      permissions: ['a'],
      statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
    });
    // dropped 應列出所有非白名單 key（供 verbose 診斷）
    assert.deepEqual(
      result.dropped.sort(),
      ['apiKeyHelper', 'autoUpdatesChannel', 'someFutureKey', 'tui'],
    );
  });
});

test('loadStrippedSettings：全白名單時 dropped 為空陣列', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a'], language: 'zh-TW' });
    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.dropped, []);
  });
});

test('extractDeviceValues：保留所有非白名單 top-level key（含憑證 helper）供 to-local', () => {
  const local = {
    permissions: ['a'],                    // 白名單 → 不萃取（採 repo 值）
    tui: 'modern',
    autoUpdatesChannel: 'latest',
    apiKeyHelper: '/home/u/get-key.sh',
  };
  const { deviceValues } = extractDeviceValues(local);
  assert.deepEqual(deviceValues, {
    tui: 'modern',
    autoUpdatesChannel: 'latest',
    apiKeyHelper: '/home/u/get-key.sh',
  });
  assert.ok(!('permissions' in deviceValues), '白名單 key 不應被萃取');
});

test('extractDeviceValues：回傳 top-level 裝置欄位及 env 非白名單 key', () => {
  const local = {
    model: 'opus',
    effortLevel: 'high',
    defaultShell: 'powershell',
    env: { EDITOR: 'nvim', ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    permissions: ['a'],
  };
  const { deviceValues } = extractDeviceValues(local);
  // EDITOR 在白名單不萃取（採 repo 值）；金鑰與裝置特定 env key 萃取供 to-local 保留
  assert.deepEqual(deviceValues, {
    model: 'opus',
    effortLevel: 'high',
    defaultShell: 'powershell',
    env: { ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
  });
  assert.ok(!('permissions' in deviceValues), 'permissions 不應在 deviceValues');
});

test('extractDeviceValues：local 無非白名單 top-level key 但有非白名單 env 時，萃取該 env 供 to-local 保留', () => {
  const { deviceValues } = extractDeviceValues({ env: { X: '1' } });
  assert.deepEqual(deviceValues, { env: { X: '1' } });
});

test('extractDeviceValues：env 僅白名單 key 時回傳空 deviceValues', () => {
  const { deviceValues } = extractDeviceValues({ env: { EDITOR: 'nvim' } });
  assert.deepEqual(deviceValues, {});
});

// -----------------------------------------------------------------------------
// hooks 為平台綁定欄位：to-repo 剝除、to-local 保留本機值，永不跨裝置同步
// -----------------------------------------------------------------------------
test('hooks 不在 PORTABLE_SETTINGS_KEYS 中（平台綁定、不同步）', () => {
  assert.ok(!PORTABLE_SETTINGS_KEYS.includes('hooks'), 'hooks 不應為可攜欄位');
});

test('loadStrippedSettings：剝除 hooks（to-repo 不帶平台綁定 hooks）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'x', shell: 'powershell' }] }] },
    });

    const result = loadStrippedSettings(fp);
    assert.ok(!('hooks' in result.clean), 'hooks 應被剝除');
    assert.deepEqual(result.clean, { permissions: ['a'] });
  });
});

test('extractDeviceValues：回傳本機 hooks 供 to-local 保留', () => {
  const hooks = { Stop: [{ hooks: [{ type: 'command', command: 'y', shell: 'powershell' }] }] };
  const { deviceValues } = extractDeviceValues({ hooks, permissions: ['a'] });
  assert.deepEqual(deviceValues, { hooks });
});

test('mergeDeviceValues：repo 無 hooks 時整批採用本機 hooks（不部分合併）', () => {
  const repo = { permissions: ['a'] };
  const localHooks = { Stop: [{ hooks: [{ type: 'command', command: 'z' }] }] };
  const merged = mergeDeviceValues(repo, { hooks: localHooks });
  assert.deepEqual(merged.hooks, localHooks, '本機 hooks 應原樣保留');
  assert.deepEqual(merged.permissions, ['a'], '非裝置欄位不受影響');
});

test('loadStrippedSettings：env 不存在時不報錯', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a'] });
  });
});

// -----------------------------------------------------------------------------
// getStrippedSettings：向後相容介面
// -----------------------------------------------------------------------------
test('getStrippedSettings：檔案不存在回傳 null', () => {
  assert.equal(getStrippedSettings('/nonexistent/x.json'), null);
});

test('getStrippedSettings：回傳值等同 serializeSettings(clean)', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { language: 'zh-TW', model: 'opus', effortLevel: 'high' });

    const stripped = getStrippedSettings(fp);
    assert.equal(stripped, serializeSettings({ language: 'zh-TW' }));
    assert.ok(stripped.endsWith('\n'));
  });
});

// -----------------------------------------------------------------------------
// 對稱性回歸測試：to-repo / to-local / diff 三條路徑序列化結果必須一致
// 這是 #3 bug 的鎖定測試 — 舊版 to-local 用 JSON.stringify 不加 \n，導致誤判
// -----------------------------------------------------------------------------
test('回歸：writeJsonSafe 與 serializeSettings 的輸出格式對稱', () => {
  // writeJsonSafe 內部使用 JSON.stringify(data, null, 2) + '\n'
  // serializeSettings 也必須輸出相同格式，否則 to-local 會誤判 changed
  const obj = { permissions: ['Bash(npm test)'], statusLine: { type: 'cmd' } };
  const writeOutput = JSON.stringify(obj, null, 2) + '\n';
  assert.equal(serializeSettings(obj), writeOutput);
});

test('回歸：to-local 比對 — 相同內容（僅 device fields 不同）應被視為一致', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');

    // local 含 device fields
    writeJson(localPath, {
      permissions: ['Bash(ls)'],
      model: 'opus',
      effortLevel: 'high',
    });
    // repo 不含 device fields，內容其餘相同
    writeJson(repoPath, { permissions: ['Bash(ls)'] });

    // 模擬 mergeSettingsJson(to-local) 的比對邏輯（top-level 白名單收斂）
    const repo = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const localClean = {};
    for (const key of Object.keys(local)) {
      if (PORTABLE_SETTINGS_KEYS.includes(key)) localClean[key] = local[key];
    }

    // 兩邊都用 serializeSettings，必須相等（這是 #3 fix 的核心）
    assert.equal(
      serializeSettings(repo),
      serializeSettings(localClean),
      'to-local 不應因結尾換行差異誤判為 changed',
    );
  });
});

// -----------------------------------------------------------------------------
// mergeDeviceValues：to-local 合併，巢狀 env 物件 shallow merge
// -----------------------------------------------------------------------------
test('mergeDeviceValues：env 巢狀 key 不覆蓋 repo 的其他 env key', () => {
  const repo = { env: { EDITOR: 'code --wait' }, permissions: ['a'] };
  const deviceValues = { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' } };
  const merged = mergeDeviceValues(repo, deviceValues);
  assert.deepEqual(merged, {
    env: { EDITOR: 'code --wait', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    permissions: ['a'],
  });
});

test('mergeDeviceValues：top-level deviceValues 覆蓋 repo 對應欄位', () => {
  const repo = { defaultShell: 'zsh', permissions: ['a'] };
  const deviceValues = { defaultShell: 'powershell' };
  const merged = mergeDeviceValues(repo, deviceValues);
  assert.equal(merged.defaultShell, 'powershell');
  assert.deepEqual(merged.permissions, ['a']);
});

test('mergeDeviceValues：deviceValues 為空時回傳 repo 副本', () => {
  const repo = { env: { EDITOR: 'vim' }, permissions: ['a'] };
  const merged = mergeDeviceValues(repo, {});
  assert.deepEqual(merged, repo);
  assert.ok(merged !== repo, '應為新物件，非原始 reference');
});

test('回歸：to-repo 寫入後再讀回，與 loadStrippedSettings.serialized 完全相符', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');

    writeJson(localPath, { x: 1, model: 'opus' });

    const stripped = loadStrippedSettings(localPath);
    // 模擬 writeJsonSafe(repoPath, stripped.clean)
    fs.writeFileSync(repoPath, JSON.stringify(stripped.clean, null, 2) + '\n');

    const repoContent = fs.readFileSync(repoPath, 'utf8');
    assert.equal(repoContent, stripped.serialized,
      'repo 寫入結果必須等於 stripped.serialized，否則下一次 diff 會誤判');
  });
});

// -----------------------------------------------------------------------------
// 安全回歸：env 金鑰絕不進 repo / diff，且 to-local 不會刪掉本機金鑰
// 鎖定核心安全不變式（CLAUDE.md：輸出/log/diff 不得出現 API Key、token）
// -----------------------------------------------------------------------------
test('安全回歸：to-repo stripped 不含金鑰，to-local 保留本機金鑰', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    writeJson(localPath, {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_x' },
      permissions: ['a'],
      model: 'opus',
    });

    // to-repo：stripped 內容（會寫進 repo、印進 diff）絕不含金鑰
    const stripped = loadStrippedSettings(localPath);
    assert.ok(!stripped.serialized.includes('sk-secret'), 'API Key 不得進 repo/diff');
    assert.ok(!stripped.serialized.includes('ghp_x'), 'token 不得進 repo/diff');
    assert.deepEqual(stripped.clean, { env: { EDITOR: 'vim' }, permissions: ['a'] });

    // to-local：以 repo（無金鑰）合回本機，本機金鑰須保留、白名單 env 採 repo 值
    const repo = { env: { EDITOR: 'code --wait', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, permissions: ['a'] };
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const { deviceValues } = extractDeviceValues(local);
    const merged = mergeDeviceValues(repo, deviceValues);
    assert.equal(merged.env.ANTHROPIC_API_KEY, 'sk-secret', 'to-local 須保留本機金鑰');
    assert.equal(merged.env.GITHUB_TOKEN, 'ghp_x', 'to-local 須保留本機 token');
    assert.equal(merged.env.EDITOR, 'code --wait', '白名單 env 採 repo 值');
    assert.equal(merged.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1', '白名單 env 從 repo 帶入');
  });
});
