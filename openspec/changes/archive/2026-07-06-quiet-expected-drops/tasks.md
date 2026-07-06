# Tasks

## 1. 顯示過濾

- [x] 1.1 `sync.js:2318-2319`：印出前過濾 `const surprising = item.droppedKeys.filter(k => !DEVICE_SETTINGS_KEYS.includes(k))`，`surprising.length` 為 0 則不印該行
- [x] 1.2 確認判斷用 `DEVICE_SETTINGS_KEYS.includes(k)`（明列＝預期），不用 pattern 反查

## 2. 測試

- [x] 2.1 新增測試：僅 `DEVICE_SETTINGS_KEYS` 明列鍵被排除時，不印「未同步」行
- [x] 2.2 新增測試：命中 `SENSITIVE_KEY_PATTERN` 但不在明列的 key 仍印出
- [x] 2.3 `npm test` 全綠

## 3. 驗證

- [x] 3.1 `openspec validate quiet-expected-drops --strict` 通過
- [x] 3.2 手動 `npm run status`：確認 `model, hooks, autoUpdatesChannel, tui` 噪音消失
