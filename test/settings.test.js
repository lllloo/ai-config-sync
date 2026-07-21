'use strict';

// =============================================================================
// settings.json 純函式單元測試
// 鎖定 serializeSettings / loadStrippedSettings / partitionSettingsTopLevel
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
  loadRepoPortableSettings,
  mergeSettingsBetween,
  partitionSettingsTopLevel,
  findNewSettingsTopKeys,
  collectNewSettingsKeys,
  diffSyncItem,
  DEVICE_SETTINGS_KEYS,
} = require('../sync.js');
const { SENSITIVE_KEY_PATTERN } = require('../safety-check.js');
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
// loadStrippedSettings：讀檔 + top-level 黑名單收斂
// 僅 DEVICE_SETTINGS_KEYS 被剝除；敏感命名與 env key 改由 safety:check 人工審核。
// -----------------------------------------------------------------------------
test('loadStrippedSettings：檔案不存在回傳 null', () => {
  const result = loadStrippedSettings('/nonexistent/path/settings.json');
  assert.equal(result, null);
});

test('loadStrippedSettings：剝除黑名單 top-level key，但保留 env key', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      model: 'opus',
      tui: 'modern',
      autoUpdatesChannel: 'latest',
      env: { EDITOR: 'code --wait', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    });

    const result = loadStrippedSettings(fp);
    assert.ok(result, '應回傳 { clean, serialized }');
    assert.ok(!('model' in result.clean), 'model 應被移除');
    assert.ok(!('tui' in result.clean), 'tui 應被移除');
    assert.ok(!('autoUpdatesChannel' in result.clean), 'autoUpdatesChannel 應被移除');
    assert.equal(result.clean.env.CLAUDE_CODE_USE_POWERSHELL_TOOL, '1',
      'env key 不再由同步流程剝除');
    assert.deepEqual(result.clean, {
      permissions: ['a'],
      env: { EDITOR: 'code --wait', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    });
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
// env 欄位同步：所有 env key 依一般同步語意進 repo，值只在 diff 顯示層遮罩。
// -----------------------------------------------------------------------------
test('loadStrippedSettings：env key 不因黑名單／pattern 被剝除', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      env: {
        EDITOR: 'nvim',                     // 乾淨名 → 同步
        MY_PREF: 'value',                   // 乾淨名未知 key → 預設同步（黑名單制的核心行為）
        ANTHROPIC_API_KEY: 'sk-secret',     // 命中 pattern（key）但照常同步
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', // 裝置特定，但 env 無黑名單、照常同步
        HTTPS_PROXY: 'http://u:p@h',        // 裝置特定，但 env 無黑名單、照常同步
      },
      permissions: ['a'],
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, {
      env: {
        EDITOR: 'nvim',
        MY_PREF: 'value',
        ANTHROPIC_API_KEY: 'sk-secret',
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
        HTTPS_PROXY: 'http://u:p@h',
      },
      permissions: ['a'],
    });
  });
});

test('loadStrippedSettings：env 全為敏感命名 key 時仍保留 env', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { env: { ANTHROPIC_API_KEY: 'sk-secret' }, permissions: ['a'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { env: { ANTHROPIC_API_KEY: 'sk-secret' }, permissions: ['a'] });
  });
});

test('loadStrippedSettings：僅黑名單剝除，未知與敏感命名 key 預設同步', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
      tui: 'modern',                       // 黑名單：裝置偏好
      autoUpdatesChannel: 'latest',        // 黑名單：裝置偏好
      apiKeyHelper: '/x/get-key.sh',       // 曾列黑名單的憑證 helper → 照常同步，由 safety:check hard block 兜底
      someFuturePref: 'x',                 // 未知非敏感新欄位 → 預設同步
      sessionDefaults: { compact: true },  // 命中 pattern 但照常同步
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, {
      permissions: ['a'],
      statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
      apiKeyHelper: '/x/get-key.sh',
      someFuturePref: 'x',
      sessionDefaults: { compact: true },
    });
    // dropped 只列明確黑名單 key；敏感命名 key 改由 safety:check warning。
    assert.deepEqual(
      result.dropped.sort(),
      ['autoUpdatesChannel', 'tui'],
    );
  });
});

test('loadStrippedSettings：敏感命名未知欄位照常同步（含 keyboardLayout 回歸）', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      permissions: ['a'],
      newAuthTokenHelper: '/x.sh',
      fooCredentialPath: '/y',
      barRefresh: true,
      keyboardLayout: 'colemak',
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, {
      permissions: ['a'],
      newAuthTokenHelper: '/x.sh',
      fooCredentialPath: '/y',
      barRefresh: true,
      keyboardLayout: 'colemak',
    });
    assert.deepEqual(result.dropped, []);
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
    newAuthToken: 'x',           // pattern 命中但可攜
  };
  const { portable, device } = partitionSettingsTopLevel(data);
  const union = [...Object.keys(portable), ...Object.keys(device)].sort();
  assert.deepEqual(union, Object.keys(data).sort(), '分區聯集須涵蓋全部 key（無遺失）');
  for (const key of Object.keys(portable)) {
    assert.ok(!(key in device), `${key} 不得同時在兩桶（無雙寫）`);
  }
  assert.deepEqual(Object.keys(portable).sort(), ['newAuthToken', 'permissions', 'someFuturePref']);
  assert.deepEqual(Object.keys(device).sort(), ['model']);
});

test('loadStrippedSettings：全為可攜欄位時 dropped 為空陣列', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a'], language: 'zh-TW' });
    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.dropped, []);
  });
});

test('partitionSettingsTopLevel：device 分區保留所有黑名單 top-level key 供 to-local', () => {
  const local = {
    permissions: ['a'],                    // 可攜 → 不進 device（採 repo 值）
    tui: 'modern',
    autoUpdatesChannel: 'latest',
    model: 'opus',
  };
  const { device } = partitionSettingsTopLevel(local);
  assert.deepEqual(device, {
    tui: 'modern',
    autoUpdatesChannel: 'latest',
    model: 'opus',
  });
  assert.ok(!('permissions' in device), '可攜 key 不應進 device 分區');
});

test('partitionSettingsTopLevel：device 只含 top-level 裝置欄位，env 不在其中', () => {
  const local = {
    model: 'opus',
    tui: 'modern',
    autoUpdatesChannel: 'latest',
    env: { EDITOR: 'nvim', ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    permissions: ['a'],
  };
  const { device } = partitionSettingsTopLevel(local);
  assert.deepEqual(device, {
    model: 'opus',
    tui: 'modern',
    autoUpdatesChannel: 'latest',
  });
  assert.ok(!('permissions' in device), 'permissions 不應在 device 分區');
  assert.ok(!('env' in device), 'env 不應由同步流程特別保留');
});

test('partitionSettingsTopLevel：env key（含 proxy／token 命名）一律歸 portable', () => {
  const { device, portable } = partitionSettingsTopLevel({ env: { HTTP_PROXY: 'http://u:p@h', GITHUB_TOKEN: 'x' } });
  assert.deepEqual(device, {});
  assert.ok('env' in portable, 'env 整塊依一般同步語意走 portable');
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

test('mergeSettingsBetween(to-local)：本機 hooks 整鍵保留（不與 repo 部分合併）', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    const localHooks = { Stop: [{ hooks: [{ type: 'command', command: 'z', shell: 'powershell' }] }] };
    writeJson(localPath, { permissions: ['old'], hooks: localHooks });
    writeJson(repoPath, { permissions: ['new'] });

    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-local'), true);
    const merged = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    assert.deepEqual(merged.hooks, localHooks, '本機 hooks 應原樣保留');
    assert.deepEqual(merged.permissions, ['new'], '可攜欄位採 repo 值');
  });
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
      tui: 'modern',
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
// to-local 裝置欄位為整鍵覆蓋：repo 若被手改混入裝置欄位（如 tui），本機值整鍵勝出，
// 不與 repo 側同名物件 shallow merge（裝置偏好不應混入 repo 殘留 subkey）
// -----------------------------------------------------------------------------
test('mergeSettingsBetween(to-local)：repo 混入裝置欄位時本機整鍵覆蓋、不部分合併', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { permissions: ['old'], tui: { theme: 'dark' } });
    writeJson(repoPath, { permissions: ['new'], tui: { theme: 'light', stray: true } });

    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-local'), true);
    const merged = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    assert.deepEqual(merged.tui, { theme: 'dark' }, 'repo 側 tui 的 subkey 不得混進本機');
  });
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
// 同步與安全審核分離：env 與敏感命名照常同步，安全檢查改由 safety:check 執行
// -----------------------------------------------------------------------------
test('同步降責：to-repo stripped 含 env 金鑰，to-local 以 repo env 覆蓋', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    writeJson(localPath, {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_x' },
      permissions: ['a'],
      model: 'opus',
    });

    const stripped = loadStrippedSettings(localPath);
    assert.ok(stripped.serialized.includes('sk-secret'), 'API Key 由同步流程照常寫入 repo');
    assert.ok(stripped.serialized.includes('ghp_x'), 'token 由同步流程照常寫入 repo');
    assert.deepEqual(stripped.clean, {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_x' },
      permissions: ['a'],
    });
    // to-local 的 env 覆蓋語意由下方 mergeSettingsBetween(to-local) 測試直接驗證
  });
});

// -----------------------------------------------------------------------------
// mergeSettingsBetween：直接驗證同步心臟（不再以手刻模擬替代，避免實作漂移）
// 涵蓋 to-repo 僅剝除明確裝置欄位、to-local 保留裝置欄位、dry-run 不寫、無差異短路
// -----------------------------------------------------------------------------
test('mergeSettingsBetween(to-repo)：寫入 repo 為 stripped 內容且保留 env 金鑰，回傳 true', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_x' },
      permissions: ['a'],
      model: 'opus',          // 裝置欄位，須被剝除
      apiKeyHelper: '/x.sh',  // 憑證 helper 不再預防性列名 → 照常同步，交由 safety:check hard block
    });

    const changed = mergeSettingsBetween(localPath, repoPath, 'to-repo');
    assert.equal(changed, true);

    const written = fs.readFileSync(repoPath, 'utf8');
    assert.ok(written.includes('sk-secret'), 'repo 會包含 env API Key，交由 safety:check 回報');
    assert.ok(written.includes('ghp_x'), 'repo 會包含 env token，交由 safety:check 回報');
    assert.deepEqual(JSON.parse(written), {
      env: { EDITOR: 'vim', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_x' },
      permissions: ['a'],
      apiKeyHelper: '/x.sh',
    }, 'repo 僅剝除明確黑名單 top-level key');
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

test('mergeSettingsBetween(to-local)：以 repo 合回本機，僅保留裝置欄位', () => {
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
    assert.equal(merged.env.ANTHROPIC_API_KEY, undefined, 'to-local 不再特別保留本機金鑰');
    assert.equal(merged.env.EDITOR, 'code --wait', '可攜 env 採 repo 值');
    assert.equal(merged.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1', '可攜 env 從 repo 帶入');
    assert.equal(merged.model, 'opus', '裝置欄位須保留本機原值');
    assert.deepEqual(merged.permissions, ['new'], '可攜欄位採 repo 值');
  });
});
test('mergeSettingsBetween(to-repo)：敏感命名、known secret 與 HOME 路徑不再中止', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      permissions: ['a'],
      integrations: { apiToken: 'sk-' + 'a'.repeat(20) },
      statusLine: { command: 'bash /home/joe/x.sh' },
    });

    assert.doesNotThrow(() => mergeSettingsBetween(localPath, repoPath, 'to-repo'));
    const written = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
    assert.equal(written.integrations.apiToken, 'sk-' + 'a'.repeat(20));
    assert.equal(written.statusLine.command, 'bash /home/joe/x.sh');
  });
});
test('mergeSettingsBetween(to-local)：本機可攜欄位含家目錄路徑時不中止', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, {
      permissions: { additionalDirectories: ['/home/joe/proj'] },
    });
    writeJson(repoPath, { permissions: { allow: ['x'] } });

    // safety check 已與同步流程分離，to-local 不應因本機值內容中止。
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

// -----------------------------------------------------------------------------
// findNewSettingsTopKeys：首次出現 top-level key 的查驗提示（只比 key 集合、不看值）
// -----------------------------------------------------------------------------
test('findNewSettingsTopKeys：本機缺檔回傳空陣列', () => {
  withTmpDir((dir) => {
    const repoPath = path.join(dir, 'repo.json');
    writeJson(repoPath, { permissions: {} });
    assert.deepEqual(findNewSettingsTopKeys(path.join(dir, 'absent.json'), repoPath), []);
  });
});

test('findNewSettingsTopKeys：repo 缺檔時列出全部可攜 key（首次建 repo）', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    writeJson(localPath, { permissions: {}, language: 'zh-TW', model: 'opus' });
    // model 在黑名單，不屬可攜集合，不得列出
    assert.deepEqual(
      findNewSettingsTopKeys(localPath, path.join(dir, 'absent.json')),
      ['permissions', 'language'],
    );
  });
});

test('findNewSettingsTopKeys：只列 repo 尚無的 key，保持本機順序', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { newFlag: true, permissions: {}, anotherNew: 1 });
    writeJson(repoPath, { permissions: {} });
    assert.deepEqual(findNewSettingsTopKeys(localPath, repoPath), ['newFlag', 'anotherNew']);
  });
});

test('findNewSettingsTopKeys：黑名單 key 即使 repo 沒有也不列（已被剝除）', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { permissions: {}, model: 'opus', hooks: {}, tui: {} });
    writeJson(repoPath, { permissions: {} });
    assert.deepEqual(findNewSettingsTopKeys(localPath, repoPath), []);
  });
});

test('findNewSettingsTopKeys：兩端 key 一致（值不同）不觸發', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { language: 'zh-TW' });
    writeJson(repoPath, { language: 'en' });
    assert.deepEqual(findNewSettingsTopKeys(localPath, repoPath), []);
  });
});

// -----------------------------------------------------------------------------
// to-local 的 diff 與 apply 必須同基準（loadRepoPortableSettings）
// 回歸：diff 曾拿 repo 原始 bytes 比對、apply 卻先剝除 device key——repo 殘留
// 黑名單 key 時 diff 恆判 changed、apply 無動作，settings.json 永不收斂。
// -----------------------------------------------------------------------------
test('loadRepoPortableSettings：剝除 device key 與空 env，序列化與 stripped local 同源', () => {
  withTmpDir((dir) => {
    const repoPath = path.join(dir, 'repo.json');
    writeJson(repoPath, { permissions: ['a'], model: 'opus', env: {} });
    const { clean, serialized } = loadRepoPortableSettings(repoPath);
    assert.deepEqual(clean, { permissions: ['a'] }, 'device key 與空 env 應被剝除');
    assert.equal(serialized, serializeSettings({ permissions: ['a'] }), '須經 serializeSettings 同一入口');
  });
});

test('to-local diff：repo 殘留 device key 時不再恆判 changed（與 apply 同基準）', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    // repo 殘留黑名單 key（如某 key 剛被補列、repo 尚未經 to-repo 重寫）；
    // 可攜內容兩端一致，本機另有自己的 device key（應整鍵保留、不參與比對）
    writeJson(repoPath, { permissions: ['a'], model: 'opus' });
    writeJson(localPath, { permissions: ['a'], model: 'sonnet' });

    const item = { type: 'settings', label: 'settings.json', prefix: 'claude/', src: localPath, dest: repoPath };
    const [entry] = diffSyncItem(item, 'to-local');
    assert.equal(entry.status, null, 'repo 僅多 device key → diff 應判無差異');
    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-local', true), false,
      'apply 亦應判無變更（diff 與 apply 同基準，不得一邊 changed 一邊 no-op）');
  });
});

test('to-local diff：repo 可攜內容確實不同時仍判 changed（同基準不得誤吞真差異）', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(repoPath, { permissions: ['b'], model: 'opus' });
    writeJson(localPath, { permissions: ['a'] });

    const item = { type: 'settings', label: 'settings.json', prefix: 'claude/', src: localPath, dest: repoPath };
    const [entry] = diffSyncItem(item, 'to-local');
    assert.equal(entry.status, 'changed', '可攜內容不同應判 changed');
    assert.equal(mergeSettingsBetween(localPath, repoPath, 'to-local', true), true, 'apply 亦應判有變更');
  });
});

test('collectNewSettingsKeys：從項目清單取 settings 項目；無 settings 項目回傳空陣列', () => {
  withTmpDir((dir) => {
    const localPath = path.join(dir, 'local.json');
    const repoPath = path.join(dir, 'repo.json');
    writeJson(localPath, { newFlag: true });
    writeJson(repoPath, {});
    const items = [
      { type: 'file', src: localPath, dest: repoPath },
      { type: 'settings', src: localPath, dest: repoPath },
    ];
    assert.deepEqual(collectNewSettingsKeys(items), ['newFlag']);
    assert.deepEqual(collectNewSettingsKeys([{ type: 'file', src: localPath, dest: repoPath }]), []);
  });
});
