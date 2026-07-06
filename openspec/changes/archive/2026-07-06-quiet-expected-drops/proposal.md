## Why

`diff`／`status` 的「未同步（黑名單／敏感護欄排除）」行目前無條件列出所有被排除的 top-level key（`sync.js:2318`），其中 `model`、`hooks`、`autoUpdatesChannel`、`tui` 這類**明列於 `DEVICE_SETTINGS_KEYS`、永遠刻意不同步**的裝置鍵每次都印，成為永久噪音，稀釋了此行真正的用途——發現「`SENSITIVE_KEY_PATTERN` 誤傷官方新欄位」的安全訊號。

本 change 讓該行只印**意料之外**的排除，保留救命訊號、清掉噪音。與 `env-blacklist` 為獨立 change（此處只動 top-level dropped 顯示，與 env 過濾機制無交集）。

## What Changes

- dropped 顯示改為只列命中 `SENSITIVE_KEY_PATTERN` 而被排除、但**未明列於 `DEVICE_SETTINGS_KEYS`** 的 key；明列的預期裝置鍵不印。過濾後為空則整行不印。
- 不改任何過濾／同步行為，純顯示層調整。

## Capabilities

### New Capabilities
（無）

### Modified Capabilities
- `claude-settings-sync`：「被排除欄位於 diff 預設可見」需求由「全列」改為「只列意料之外」。

## Impact

- **程式碼**：`sync.js:2318-2319` 印出前加 `droppedKeys.filter(k => !DEVICE_SETTINGS_KEYS.includes(k))`，空則不印。
- **測試**：新增「預期裝置鍵不印、pattern 誤傷仍印」測試（`test/diff-integration.test.js` 或 `test/boundary.test.js`）。
- **文件**：CLAUDE.md／README 若描述該行行為則同步微調。
- **風險**：極低，純降噪；pattern 誤傷訊號保留。
