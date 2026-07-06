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
  mergeSettingsBetween,
  partitionSettingsTopLevel,
  assertPortableSettingsSafe,
  DEVICE_SETTINGS_KEYS,
  SENSITIVE_KEY_PATTERN,
  SyncError,
  ERR,
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
// loadStrippedSettings：讀檔 + top-level 黑名單混合制收斂
// （DEVICE_SETTINGS_KEYS 黑名單 + SENSITIVE_KEY_PATTERN 護欄；env 亦走黑名單混合制
//  DEVICE_ENV_KEYS + SENSITIVE_KEY_PATTERN，乾淨名 env key 預設同步）
// -----------------------------------------------------------------------------
test('loadStrippedSettings：檔案不存在回傳 null', () => {
  const result = loadStrippedSettings('/nonexistent/path/settings.json');
  assert.equal(result, null);
});

test('loadStrippedSettings：剝除黑名單 top-level key 與黑名單 env key', () => {
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
      'env.CLAUDE_CODE_USE_POWERSHELL_TOOL（列於 DEVICE_ENV_KEYS 黑名單）應被移除');
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

test('loadStrippedSettings：全為可攜欄位時保持原樣', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a', 'b'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a', 'b'] });
  });
});

// -----------------------------------------------------------------------------
// env 欄位同步（黑名單混合制）：預設同步，僅排除 DEVICE_ENV_KEYS 黑名單與命中
// SENSITIVE_KEY_PATTERN 的 key；乾淨名 env key（如 EDITOR、未知新 key）預設進 repo。
// -----------------------------------------------------------------------------
test('loadStrippedSettings：env 剝除黑名單／pattern 命中 key，乾淨名 key 預設同步', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      env: {
        EDITOR: 'nvim',                     // 乾淨名 → 同步
        MY_PREF: 'value',                   // 乾淨名未知 key → 預設同步（黑名單制的核心行為）
        ANTHROPIC_API_KEY: 'sk-secret',     // 命中 pattern（key）→ 剝除
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', // 列於 DEVICE_ENV_KEYS → 剝除
        HTTPS_PROXY: 'http://u:p@h',        // 列於 DEVICE_ENV_KEYS → 剝除
      },
      permissions: ['a'],
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { env: { EDITOR: 'nvim', MY_PREF: 'value' }, permissions: ['a'] });
  });
});

test('loadStrippedSettings：env 全為黑名單／pattern 命中 key 時整個 env 鍵被移除', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { env: { ANTHROPIC_API_KEY: 'sk-secret' }, permissions: ['a'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a'] });
    assert.ok(!('env' in result.clean), '空的 env 應被移除');
  });
});

test('loadStrippedSettings：黑名單／pattern 命中剝除，未知非敏感 key 預設同步（黑名單混合制）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
      tui: 'modern',                       // 黑名單：裝置偏好
      autoUpdatesChannel: 'latest',        // 黑名單：裝置偏好
      apiKeyHelper: '/x/get-key.sh',       // 黑名單：憑證 helper（同時命中 pattern）
      someFuturePref: 'x',                 // 未知非敏感新欄位 → 預設同步
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, {
      permissions: ['a'],
      statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
      someFuturePref: 'x',
    });
    // dropped 只列被排除的 key（黑名單／pattern 命中），預設輸出於 diff 可見
    assert.deepEqual(
      result.dropped.sort(),
      ['apiKeyHelper', 'autoUpdatesChannel', 'tui'],
    );
  });
});

test('loadStrippedSettings：pattern 護欄剝除命名含敏感字的未知欄位（含 keyboardLayout 已知誤傷取捨）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      newAuthTokenHelper: '/x.sh',   // 假想未來憑證欄位：auth/token/helper 三重命中
      fooCredentialPath: '/y',       // credential 命中
      barRefresh: true,              // refresh 命中
      // 已知取捨（design D3 寧緊勿鬆）：keyboardLayout 因含 "key" 被誤傷——
      // 誤傷方向是「該同步的沒同步」（沉默無害、dropped 可見），刻意接受
      keyboardLayout: 'colemak',
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a'] });
    assert.deepEqual(
      result.dropped.sort(),
      ['barRefresh', 'fooCredentialPath', 'keyboardLayout', 'newAuthTokenHelper'],
    );
  });
});

test('回歸：原白名單 10 欄位翻轉後全數仍可攜（不被黑名單或 pattern 誤傷）', () => {
  const formerAllowlist = [
    'env', 'permissions', 'statusLine', 'enabledPlugins', 'extraKnownMarketplaces',
    'language', 'spinnerTipsEnabled', 'theme',
    'skipDangerousModePermissionPrompt', 'skipAutoPermissionPrompt',
  ];
  for (const key of formerAllowlist) {
    assert.ok(!DEVICE_SETTINGS_KEYS.includes(key), `${key} 不應在黑名單`);
    assert.ok(!SENSITIVE_KEY_PATTERN.test(key), `${key} 不應命中敏感 pattern`);
  }
});

test('partitionSettingsTopLevel：portable/device 為不重疊聯集（strip/preserve 互補同源）', () => {
  const data = {
    permissions: ['a'],          // 可攜
    someFuturePref: 1,           // 未知非敏感 → 可攜
    model: 'opus',               // 黑名單
    newAuthToken: 'x',           // pattern 命中
  };
  const { portable, device } = partitionSettingsTopLevel(data);
  const union = [...Object.keys(portable), ...Object.keys(device)].sort();
  assert.deepEqual(union, Object.keys(data).sort(), '分區聯集須涵蓋全部 key（無遺失）');
  for (const key of Object.keys(portable)) {
    assert.ok(!(key in device), `${key} 不得同時在兩桶（無雙寫）`);
  }
  assert.deepEqual(Object.keys(portable).sort(), ['permissions', 'someFuturePref']);
  assert.deepEqual(Object.keys(device).sort(), ['model', 'newAuthToken']);
});

test('loadStrippedSettings：全為可攜欄位時 dropped 為空陣列', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a'], language: 'zh-TW' });
    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.dropped, []);
  });
});

test('extractDeviceValues：保留所有被排除 top-level key（黑名單／pattern 命中）供 to-local', () => {
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
  assert.ok(!('permissions' in deviceValues), '可攜 key 不應被萃取');
});

test('extractDeviceValues：回傳 top-level 裝置欄位及 env 黑名單/pattern 命中 key', () => {
  const local = {
    model: 'opus',
    effortLevel: 'high',
    defaultShell: 'powershell',
    env: { EDITOR: 'nvim', ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    permissions: ['a'],
  };
  const { deviceValues } = extractDeviceValues(local);
  // EDITOR 為乾淨名可攜 → 不萃取（採 repo 值）；金鑰（pattern）與 DEVICE_ENV_KEYS 命中者萃取供 to-local 保留
  assert.deepEqual(deviceValues, {
    model: 'opus',
    effortLevel: 'high',
    defaultShell: 'powershell',
    env: { ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
  });
  assert.ok(!('permissions' in deviceValues), 'permissions 不應在 deviceValues');
});

test('extractDeviceValues：黑名單命中的 env key 萃取供 to-local 保留', () => {
  const { deviceValues } = extractDeviceValues({ env: { HTTP_PROXY: 'http://u:p@h', GITHUB_TOKEN: 'x' } });
  assert.deepEqual(deviceValues, { env: { HTTP_PROXY: 'http://u:p@h', GITHUB_TOKEN: 'x' } });
});

test('extractDeviceValues：乾淨名可攜 env key 不萃取（採 repo 值）', () => {
  // 黑名單制核心：乾淨名 env key 為可攜、由 repo 值勝出，故不進 deviceValues
  const { deviceValues } = extractDeviceValues({ env: { EDITOR: 'nvim', X: '1' } });
  assert.deepEqual(deviceValues, {});
});

// -----------------------------------------------------------------------------
// hooks 為平台綁定欄位：to-repo 剝除、to-local 保留本機值，永不跨裝置同步
// -----------------------------------------------------------------------------
test('hooks 列於 DEVICE_SETTINGS_KEYS 黑名單（平台綁定、不同步）', () => {
  assert.ok(DEVICE_SETTINGS_KEYS.includes('hooks'), 'hooks 應在黑名單');
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

    // 模擬 mergeSettingsJson(to-local) 的比對邏輯（top-level 黑名單混合制收斂）
    const repo = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const localClean = partitionSettingsTopLevel(local).portable;

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

    // to-local：以 repo（無金鑰）合回本機，本機金鑰須保留、可攜 env 採 repo 值
    const repo = { env: { EDITOR: 'code --wait', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, permissions: ['a'] };
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const { deviceValues } = extractDeviceValues(local);
    const merged = mergeDeviceValues(repo, deviceValues);
    assert.equal(merged.env.ANTHROPIC_API_KEY, 'sk-secret', 'to-local 須保留本機金鑰');
    assert.equal(merged.env.GITHUB_TOKEN, 'ghp_x', 'to-local 須保留本機 token');
    assert.equal(merged.env.EDITOR, 'code --wait', '可攜 env 採 repo 值');
    assert.equal(merged.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1', '可攜 env 從 repo 帶入');
  });
});

// -----------------------------------------------------------------------------
// mergeSettingsBetween：直接驗證同步心臟（不再以手刻模擬替代，避免實作漂移）
// 涵蓋 to-repo 剝除金鑰、to-local 保留本機金鑰/裝置欄位、dry-run 不寫、無差異短路
// -----------------------------------------------------------------------------
test('mergeSettingsBetween(to-repo)：寫入 repo 為 stripped 內容且不含金鑰，回傳 true', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_x' },
      permissions: ['a'],
      model: 'opus',          // 裝置欄位，須被剝除
      apiKeyHelper: '/x.sh',  // 憑證 helper，須被剝除
    });

    const changed = mergeSettingsBetween(localPath, repoPath, 'to-repo');
    assert.equal(changed, true);

    const written = fs.readFileSync(repoPath, 'utf8');
    assert.ok(!written.includes('sk-secret'), 'repo 不得含 API Key');
    assert.ok(!written.includes('ghp_x'), 'repo 不得含 token');
    assert.deepEqual(JSON.parse(written), { env: { EDITOR: 'vim' }, permissions: ['a'] },
      'repo 剝除黑名單 top-level key 與命中黑名單/pattern 的 env key');
  });
});

test('mergeSettingsBetween(to-repo)：repo 已是 stripped 內容時回傳 false 且不重寫', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { permissions: ['a'], model: 'opus' });
    fs.writeFileSync(repoPath, serializeSettings({ permissions: ['a'] }));
    const mtimeBefore = fs.statSync(repoPath).mtimeMs;

    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-repo'), false);
    assert.equal(fs.statSync(repoPath).mtimeMs, mtimeBefore, '無差異時不得重寫 repo');
  });
});

test('mergeSettingsBetween(to-repo)：dry-run 回傳 true 但不寫檔', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { permissions: ['a'], model: 'opus' });

    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-repo', true), true);
    assert.equal(fs.existsSync(repoPath), false, 'dry-run 不得寫入 repo');
  });
});

test('mergeSettingsBetween(to-repo)：本機缺檔回傳 false', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'nope.json');
    const repoPath = path.join(dir, 'repo.json');
    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-repo'), false);
    assert.equal(fs.existsSync(repoPath), false);
  });
});

test('mergeSettingsBetween(to-local)：以 repo 合回本機，保留本機金鑰與裝置欄位', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret' },
      permissions: ['old'],
      model: 'opus',
    });
    writeJson(repoPath, {
      env: { EDITOR: 'code --wait', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' },
      permissions: ['new'],
    });

    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-local'), true);
    const merged = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    assert.equal(merged.env.ANTHROPIC_API_KEY, 'sk-secret', 'to-local 須保留本機金鑰');
    assert.equal(merged.env.EDITOR, 'code --wait', '可攜 env 採 repo 值');
    assert.equal(merged.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1', '可攜 env 從 repo 帶入');
    assert.equal(merged.model, 'opus', '裝置欄位須保留本機原值');
    assert.deepEqual(merged.permissions, ['new'], '可攜欄位採 repo 值');
  });
});

// -----------------------------------------------------------------------------
// D7 值層防線（assertPortableSettingsSafe）：黑名單只查 top-level key 名，
// 巢狀內容由此層把關——命中即拋 SyncError 中止（fail-loud），不靜默剝除、不寫入
// -----------------------------------------------------------------------------
test('值層防線：巢狀敏感 key 名中止（如 integrations.apiToken）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      integrations: { apiToken: 'ZZ_DISTINCT_VALUE_ZZ' }, // 未知 top-level 放行，但巢狀 key 命中 token
    });

    let caught = null;
    try { loadStrippedSettings(fp); } catch (e) { caught = e; }
    assert.ok(caught instanceof SyncError, '應拋 SyncError');
    assert.equal(caught.code, ERR.SENSITIVE_CONTENT);
    assert.ok(caught.message.includes('integrations.apiToken'), '訊息應含欄位路徑');
    assert.ok(!caught.message.includes('ZZ_DISTINCT_VALUE_ZZ'), '訊息不得含值本身');
  });
});

test('值層防線：機密樣式值中止（已知 token 前綴）', () => {
  const cases = [
    { statusLine: { command: 'curl -H "Bearer sk-ant-api03-abcdef123456"' } },
    { permissions: ['ghp_' + 'a'.repeat(24)] },
    { extraKnownMarketplaces: { m: { source: 'AKIA' + 'A1B2C3D4E5F6G7H8' } } },
  ];
  for (const clean of cases) {
    assert.throws(() => assertPortableSettingsSafe(clean),
      (e) => e instanceof SyncError && e.code === ERR.SENSITIVE_CONTENT,
      `應攔截：${Object.keys(clean)[0]}`);
  }
});

test('值層防線：絕對家目錄路徑中止（Windows 與 Unix 形式）', () => {
  assert.throws(() => assertPortableSettingsSafe({ statusLine: { command: 'bash C:\\Users\\joe\\x.sh' } }));
  assert.throws(() => assertPortableSettingsSafe({ statusLine: { command: 'bash /home/joe/x.sh' } }));
  assert.throws(() => assertPortableSettingsSafe({ statusLine: { command: 'bash /Users/joe/x.sh' } }));
  // ~/ 形式為可攜寫法，不得誤攔
  assert.doesNotThrow(() => assertPortableSettingsSafe({ statusLine: { command: 'bash ~/.claude/statusline.sh' } }));
});

test('值層防線：env 子樹豁免 key 掃描（strip 已處理 key 名），值掃描仍適用', () => {
  // env 的 key 名已由 stripDeviceEnv 用同一 pattern 處理過，值層再掃 key 名是死碼；故不因 key 名中止
  assert.doesNotThrow(() => assertPortableSettingsSafe({ env: { SOME_TOKEN_NAME: 'plain' } }));
  // 但 env 的值仍受機密樣式掃描
  assert.throws(() => assertPortableSettingsSafe({ env: { X: 'ghp_' + 'b'.repeat(24) } }));
});

test('值層防線：現行 repo 收斂版 settings.json 不誤觸（回歸）', () => {
  const repoSettings = path.join(__dirname, '..', 'claude', 'settings.json');
  assert.doesNotThrow(() => loadStrippedSettings(repoSettings));
});

test('mergeSettingsBetween(to-repo)：值層防線命中時中止且不寫入 repo', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      permissions: ['a'],
      integrations: { apiToken: 'x' },
    });

    assert.throws(() => mergeSettingsBetween(localPath, repoPath, 'to-repo'),
      (e) => e instanceof SyncError && e.code === ERR.SENSITIVE_CONTENT);
    assert.equal(fs.existsSync(repoPath), false, '中止時不得寫入 repo');
  });
});

test('值層防線：擴充機密前綴（Stripe／Google／SendGrid／npm／Slack app）', () => {
  const cases = [
    { a: 'sk_live_' + 'a1b2c3d4e5' },
    { a: 'sk_test_' + 'a1b2c3d4e5' },
    { a: 'AIza' + 'SyD1234567890abcdef' },
    { a: 'SG.' + 'abcdefghijklmnop.qrst' },
    { a: 'npm_' + 'a'.repeat(24) },
    { a: 'token: xapp-1-A123' },
  ];
  for (const clean of cases) {
    assert.throws(() => assertPortableSettingsSafe(clean),
      (e) => e instanceof SyncError && e.code === ERR.SENSITIVE_CONTENT,
      `應攔截：${clean.a}`);
  }
  // 一般值不得誤攔（sk_ 僅限 live/test 具名前綴）
  assert.doesNotThrow(() => assertPortableSettingsSafe({ a: 'task_list sk_custom npmXYZ' }));
});

test('loadStrippedSettings（onSensitive: skip）：命中時不拋錯，回傳 sensitiveField 欄位路徑', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: { additionalDirectories: ['/home/joe/proj'] },
    });

    // 預設（throw）維持 fail-loud 不變
    assert.throws(() => loadStrippedSettings(fp),
      (e) => e instanceof SyncError && e.code === ERR.SENSITIVE_CONTENT);

    // skip 模式：不中止，加註命中欄位（供 diff／to-local 標記跳過）
    const result = loadStrippedSettings(fp, { onSensitive: 'skip' });
    assert.ok(result, 'skip 模式應回傳結果');
    assert.equal(result.sensitiveField, 'permissions.additionalDirectories.0');
    assert.ok(!result.sensitiveField.includes('joe'), 'sensitiveField 只含欄位路徑不含值');
  });
});

test('mergeSettingsBetween(to-local)：本機可攜欄位含家目錄路徑時不中止（僅比對、不寫回 repo）', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      permissions: { additionalDirectories: ['/home/joe/proj'] },
    });
    writeJson(repoPath, { permissions: { allow: ['x'] } });

    // 修正前：loadStrippedSettings 在 to-local 分支拋 SENSITIVE_CONTENT，整個指令陣亡
    let changed = null;
    assert.doesNotThrow(() => { changed = mergeSettingsBetween(localPath, repoPath, 'to-local', true); });
    assert.equal(changed, true, '本機與 repo 相異，應回報有變更');
  });
});

test('mergeSettingsBetween(to-local)：dry-run 不寫檔；repo 缺檔回傳 false', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { permissions: ['old'] });
    writeJson(repoPath, { permissions: ['new'] });

    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-local', true), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(localPath, 'utf8')), { permissions: ['old'] },
      'dry-run 不得改寫本機');

    const repoMissing = path.join(dir, 'absent.json');
    assert.equal(mergeSettingsBetween(localPath, repoMissing, 'to-local'), false);
  });
});
