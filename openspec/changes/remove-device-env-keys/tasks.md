## 1. 清除實際設定值

- [x] 1.1 確認 `~/.claude/settings.json` 的 `env` 內容（確保只有 `OBSIDIAN_VAULT_ROOT`，無其他 key）
- [x] 1.2 從 `~/.claude/settings.json` 移除 `env.OBSIDIAN_VAULT_ROOT`（若 `env` 因此為空物件，一併移除 `env` key）
- [x] 1.3 從 `~/.claude/settings.local.json` 移除 `env.OBSIDIAN_VAULT_ROOT`（若檔案因此只剩 `{}`，清空為 `{}`）

## 2. 移除 sync.js 程式碼

- [x] 2.1 移除 `DEVICE_ENV_KEYS` 常數（`sync.js` line 38）
- [x] 2.2 移除 `stripDeviceEnvKeys()` 函式（`sync.js` line ~1050-1055）
- [x] 2.3 移除 `loadStrippedSettings()` 內對 `stripDeviceEnvKeys()` 的呼叫
- [x] 2.4 從 `extractDeviceValues()` 移除 env 段落（保留 `DEVICE_FIELDS` 段落），確認回傳值不含 `envPreserve` 或 `envPreserve` 永遠為 `{}`
- [x] 2.5 確認 `extractDeviceValues()` 的呼叫端正確處理空的 `envPreserve`（不得有 undefined 或 Object.assign 錯誤）
- [x] 2.6 移除 `DEVICE_ENV_KEYS` 從 `main()` 的 export 清單（`sync.js` line ~2680）

## 3. 更新測試

- [x] 3.1 從 `test/settings.test.js` 移除 `DEVICE_ENV_KEYS` import
- [x] 3.2 刪除 `test('DEVICE_ENV_KEYS 含 OBSIDIAN_VAULT_ROOT', ...)` 整個 test case
- [x] 3.3 將 `test('loadStrippedSettings：移除 env 下所有 DEVICE_ENV_KEYS...')` 改寫為：輸入含 `env` 的 settings，確認 `loadStrippedSettings` 輸出仍保留該 `env` key（不再被剝除）
- [x] 3.4 新增 test：`extractDeviceValues()` 只回傳 `DEVICE_FIELDS` 值，不含任何 env 相關欄位
- [x] 3.5 移除測試資料中的 `OBSIDIAN_VAULT_ROOT` 範例值
- [x] 3.6 執行 `npm test` 確認全數通過

## 4. 驗證工具行為

- [x] 4.1 執行 `npm run diff` 確認不報錯、輸出正常
- [x] 4.2 執行 `npm run diff` 確認 `settings.json` 段不誤報差異（env 已清空）

## 5. 更新文件

- [x] 5.1 從 `README.md` 移除 `env.OBSIDIAN_VAULT_ROOT` 說明（line 147）
- [x] 5.2 從 `CLAUDE.md` 移除 `DEVICE_ENV_KEYS` 守則與 `OBSIDIAN_VAULT_ROOT` 舉例（line 84）
