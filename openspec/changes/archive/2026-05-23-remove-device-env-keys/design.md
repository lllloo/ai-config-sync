## Context

`sync.js` 的 `loadStrippedSettings()` 在比對 `settings.json` 前，會呼叫 `stripDeviceEnvKeys()` 把 `DEVICE_ENV_KEYS` 名單內的 env key 剝除，避免裝置特定值被當成差異報出。`extractDeviceValues()` 則在 `to-local` 時把本機的這些 key 保留下來（不被 repo 版本覆蓋）。整套機制只為 `OBSIDIAN_VAULT_ROOT` 一個 key 存在。

## Goals / Non-Goals

**Goals:**
- 移除 `DEVICE_ENV_KEYS` 常數與相關函式
- 清除 `~/.claude/settings.json` 與 `settings.local.json` 的實際值
- 讓測試與文件不再參考 `OBSIDIAN_VAULT_ROOT`

**Non-Goals:**
- 不修改 `DEVICE_FIELDS`（`model`、`effortLevel` 仍為裝置特定欄位，機制不同）
- 不改動 `env` 整體的同步行為（移除後 `env` 為空，無任何副作用）

## Decisions

**直接刪除，不留空陣列**

`DEVICE_ENV_KEYS = []` 是死程式碼，留著只增加認知負擔。直接移除常數與相關函式，`extractDeviceValues()` 只保留 `DEVICE_FIELDS` 段落。

**`stripDeviceEnvKeys` 整個刪，不改成 no-op**

函式若改成空殼，呼叫端讀程式碼時會困惑。直接刪函式、同步移除呼叫端那一行，更乾淨。

**`DEVICE_ENV_KEYS` 相關測試整個移除**

測試的存在是為了保護行為，行為消失就刪測試。測試資料裡的 `OBSIDIAN_VAULT_ROOT` 範例一併清掉，不留歷史殘跡。

## Risks / Trade-offs

**未來若需要裝置特定 env key** → 需要重新加機制。但現在沒有需求，YAGNI 原則適用。

**`settings.json` 的 `env` 若有其他 key** → 移除機制後這些 key 會跨裝置同步。目前 `env` 只有 `OBSIDIAN_VAULT_ROOT`，清掉後 `env` 整個消失，無風險。修改前應確認 `env` 裡沒有其他意外殘留的 key。
