## Why

`DEVICE_ENV_KEYS` 機制是專門為 `OBSIDIAN_VAULT_ROOT` 建立的，讓這個裝置特定路徑不被跨裝置同步。現在要把 `OBSIDIAN_VAULT_ROOT` 整個移除，這個機制就成了沒有使用者的抽象，應一併清除。

## What Changes

- 從 `~/.claude/settings.json` 與 `~/.claude/settings.local.json` 移除 `env.OBSIDIAN_VAULT_ROOT` 值
- 從 `sync.js` 移除 `DEVICE_ENV_KEYS` 常數
- 從 `sync.js` 移除 `stripDeviceEnvKeys()` 函式
- 從 `sync.js` 的 `extractDeviceValues()` 移除 env 段落
- 從 `sync.js` 的 `loadStrippedSettings()` 移除對 `stripDeviceEnvKeys` 的呼叫
- 移除 `DEVICE_ENV_KEYS` export
- 更新測試：移除 `DEVICE_ENV_KEYS` 相關 test case 與測試資料
- 更新 README.md 與 CLAUDE.md 移除 `OBSIDIAN_VAULT_ROOT` 與 `DEVICE_ENV_KEYS` 說明

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `settings-sync`：移除 env 子欄位的裝置特定排除機制，`env` 所有 key 一律跨裝置同步

## Impact

- `sync.js`：移除 3 個函式/常數，`loadStrippedSettings` 簡化
- `test/settings.test.js`：移除針對 `DEVICE_ENV_KEYS` 的 test case
- `~/.claude/settings.json`、`~/.claude/settings.local.json`：實際設定值清除
- `README.md`、`CLAUDE.md`：文件更新
- **無 breaking change**：移除後 `env` 整個為空，不會有任何 key 意外同步
