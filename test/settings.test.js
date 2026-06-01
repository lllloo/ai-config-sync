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
  DEVICE_FIELDS,
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
// loadStrippedSettings：讀檔 + 移除 DEVICE_FIELDS
// -----------------------------------------------------------------------------
test('loadStrippedSettings：檔案不存在回傳 null', () => {
  const result = loadStrippedSettings('/nonexistent/path/settings.json');
  assert.equal(result, null);
});

test('loadStrippedSettings：移除所有 DEVICE_FIELDS（含 dot-notation 巢狀 key）', () => {
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
      'env.CLAUDE_CODE_USE_POWERSHELL_TOOL 應被移除');
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

test('loadStrippedSettings：無 DEVICE_FIELDS 時保持原樣', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, { permissions: ['a', 'b'] });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { permissions: ['a', 'b'] });
  });
});

// -----------------------------------------------------------------------------
// env 欄位同步：非裝置特定 env key 跨裝置同步；裝置特定 env key（dot-notation）排除
// -----------------------------------------------------------------------------
test('loadStrippedSettings：env 非裝置特定 key 保留，裝置特定 key 剝除', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      env: { EDITOR: 'nvim', MY_KEY: 'value', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
      permissions: ['a'],
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { env: { EDITOR: 'nvim', MY_KEY: 'value' }, permissions: ['a'] });
  });
});

test('extractDeviceValues：回傳 top-level 及 dot-notation DEVICE_FIELDS 值', () => {
  const local = {
    model: 'opus',
    effortLevel: 'high',
    defaultShell: 'powershell',
    env: { EDITOR: 'nvim', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    permissions: ['a'],
  };
  const { deviceValues } = extractDeviceValues(local);
  assert.deepEqual(deviceValues, {
    model: 'opus',
    effortLevel: 'high',
    defaultShell: 'powershell',
    env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
  });
  assert.ok(!('permissions' in deviceValues), 'permissions 不應在 deviceValues');
});

test('extractDeviceValues：local 無 DEVICE_FIELDS 時回傳空 deviceValues', () => {
  const { deviceValues } = extractDeviceValues({ env: { X: '1' } });
  assert.deepEqual(deviceValues, {});
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
    writeJson(fp, { a: 1, model: 'opus', effortLevel: 'high' });

    const stripped = getStrippedSettings(fp);
    assert.equal(stripped, serializeSettings({ a: 1 }));
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

    // 模擬 mergeSettingsJson(to-local) 的比對邏輯（需處理 dot-notation DEVICE_FIELDS）
    const repo = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const localClean = { ...local };
    for (const field of DEVICE_FIELDS) {
      if (field.includes('.')) {
        const [obj, key] = field.split('.');
        if (localClean[obj]) delete localClean[obj][key];
      } else {
        delete localClean[field];
      }
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
