## Why

`settings.json` 的 `env` 區塊目前採**巢狀白名單**（`PORTABLE_ENV_KEYS`，只放行列舉 key）：每新增一個合法可攜 env key，都要改 `sync.js` 常數並手抄進 README／CLAUDE.md 多處，摩擦高且易 drift。本 change 將 `env` 過濾翻轉為**黑名單混合制**（與 top-level 對齊），使合法 env key 預設自動同步。

翻轉會弱化安全邊界（白名單的「不在名單就不同步、無漏網格」消失）。經多視角審查，殘餘風險比初版評估**更廣**，故本 change 納入兩項補強：

- **修 diff 洩漏**：`npm run diff`／`status`（純讀取）目前會透過非 verbose-gated 的明細輸出把 env 值明文印到 stdout。白名單制下 env 只含審核過的安全 key、此路徑無害；翻黑名單後同一段程式會把未過濾機密印出。必須讓 settings.json 明細 diff **不顯示 env 值**。
- **策展黑名單**：`DEVICE_ENV_KEYS` 須涵蓋名字乾淨但值即憑證的已知 env（`ANTHROPIC_CUSTOM_HEADERS`、`HTTP_PROXY`／`HTTPS_PROXY` 等）。

> **明文承擔的殘餘風險**：黑名單無法枚舉機密 key 名。key 名未命中 `SENSITIVE_KEY_PATTERN`、值未命中 `SECRET_VALUE_PATTERN`、且未列入 `DEVICE_ENV_KEYS` 的機密（如 `DB_PASS=hunter2`、`postgres://u:pw@host`）仍會被 to-repo 寫入 repo 與 git history（永久）。補強後 diff 不再外洩此類值，但 to-repo 寫入無法阻擋。此為使用者在完整說明後接受的代價，非疏漏。緩解：機密改由 `apiKeyHelper`／本機憑證檔提供、to-repo 後養成檢視習慣。

## What Changes

- **BREAKING**：`env` 由白名單改為黑名單混合制——預設同步，僅排除列於新常數 `DEVICE_ENV_KEYS` 的 key 與命中 `SENSITIVE_KEY_PATTERN` 的 key。移除 `PORTABLE_ENV_KEYS`，新增 `DEVICE_ENV_KEYS`。命中 pattern 的 env key（如 `ANTHROPIC_API_KEY`）**靜默剝除、to-repo 照常成功**（沿用現行白名單制的 UX，不引入 fail-loud）。
- **NEW（補強）**：settings.json 明細 diff 對 env 只顯示 key 層級差異、**不顯示 env 值**，關閉純讀取 diff 的 stdout 洩漏。
- **NEW（補強）**：`DEVICE_ENV_KEYS` 初始清單納入 `CLAUDE_CODE_USE_POWERSHELL_TOOL`、`ANTHROPIC_CUSTOM_HEADERS`、`HTTP_PROXY`／`HTTPS_PROXY`／`ALL_PROXY`（含大小寫變體處理）。
- 值層防線 `assertPortableSettingsSafe` **維持不變**：env 子樹續跳過 key 名掃描（strip 已用同一 pattern 處理 key 名，再掃是死碼），但 env **值**掃描（`SECRET_VALUE_PATTERN`）本就恆常適用、續作為擋「乾淨名+已知前綴值」的既有控制。
- 文件（README、CLAUDE.md、sync.js JSDoc/banner）改寫：env 由白名單敘述改為黑名單混合制，明文標註殘餘風險與現存控制。

## Capabilities

### New Capabilities
（無）

### Modified Capabilities
- `claude-settings-sync`：`env` 過濾由白名單改黑名單混合制；新增「settings.json diff 不顯示 env 值」需求；「敏感值不外洩」需求改以黑名單控制表述並修正殘餘風險描述。

## Impact

- **程式碼**：`sync.js` — 移除 `PORTABLE_ENV_KEYS`（含 L3120 export）、新增 `DEVICE_ENV_KEYS`；`stripNonPortableEnv` 反轉＋改名；`extractDeviceValues` env 迴圈反轉；settings 明細 diff 路徑（`diffSettingsItem` L1850 / `printFileDiff`）對 env 值遮罩；5 處 JSDoc/banner 改寫。**不動** `assertPortableSettingsSafe` 的 skipKeyScan。
- **測試**：`test/settings.test.js`、`test/apply-integration.test.js` 白名單前提案例改寫；新增 diff 不顯示 env 值、env 值命中前綴 fail-loud、已知漏網 characterization 測試（落點 `test/boundary.test.js`）。`settings.test.js:570-575`（env 跳過 key 掃描）行為不變、僅更新註解理由。
- **文件**：README.md、CLAUDE.md（表格列、修改守則、`env` 段落、L87 判準例外）。
- **安全姿態**：env 失去白名單結構保證，改依黑名單＋key-name strip＋值掃描＋diff 遮罩；殘餘的「repo/git 寫入」洩漏為已承擔風險。

## 關聯 change

- dropped 顯示降噪（只印意料之外的排除）已拆為獨立 change `quiet-expected-drops`——與 env 過濾機制無交集，可獨立評審與 archive。
