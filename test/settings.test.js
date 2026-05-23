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

test('loadStrippedSettings：移除所有 DEVICE_FIELDS', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    const original = { permissions: ['a'], model: 'opus', effortLevel: 'high' };
    writeJson(fp, original);

    const result = loadStrippedSettings(fp);
    assert.ok(result, '應回傳 { clean, serialized }');
    for (const field of DEVICE_FIELDS) {
      assert.ok(!(field in result.clean), `${field} 應被移除`);
    }
    assert.deepEqual(result.clean, { permissions: ['a'] });
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
// env 欄位同步：env 內所有 key 皆跨裝置同步，不再有裝置特定排除
// -----------------------------------------------------------------------------
test('loadStrippedSettings：env 內所有 key 保留不被剝除', () => {
  withTmpDir((dir) => {
    const fp = path.join(dir, 'settings.json');
    writeJson(fp, {
      env: { EDITOR: 'nvim', MY_KEY: 'value' },
      permissions: ['a'],
    });

    const result = loadStrippedSettings(fp);
    assert.deepEqual(result.clean, { env: { EDITOR: 'nvim', MY_KEY: 'value' }, permissions: ['a'] });
  });
});

test('extractDeviceValues：只回傳 DEVICE_FIELDS 值，不含 env 欄位', () => {
  const local = {
    model: 'opus',
    effortLevel: 'high',
    env: { EDITOR: 'nvim' },
    permissions: ['a'],
  };
  const { deviceValues } = extractDeviceValues(local);
  assert.deepEqual(deviceValues, { model: 'opus', effortLevel: 'high' });
  assert.ok(!('env' in deviceValues), 'deviceValues 不應含 env');
  assert.ok(!('envPreserve' in extractDeviceValues(local)), '回傳值不應含 envPreserve');
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

    // 模擬 mergeSettingsJson(to-local) 的比對邏輯
    const repo = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const localClean = { ...local };
    for (const field of DEVICE_FIELDS) delete localClean[field];

    // 兩邊都用 serializeSettings，必須相等（這是 #3 fix 的核心）
    assert.equal(
      serializeSettings(repo),
      serializeSettings(localClean),
      'to-local 不應因結尾換行差異誤判為 changed',
    );
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
