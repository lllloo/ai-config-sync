# Tasks

## 1. 常數與 env 過濾反轉

- [x] 1.1 `sync.js`：移除 `PORTABLE_ENV_KEYS`（含 `sync.js:3120` 的 `module.exports`），新增 `DEVICE_ENV_KEYS`。初值：`CLAUDE_CODE_USE_POWERSHELL_TOOL`、`ANTHROPIC_CUSTOM_HEADERS`、`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`（proxy 類採大小寫不敏感比對或列大小寫變體）
- [x] 1.2 `stripNonPortableEnv` 判斷反轉為黑名單（`DEVICE_ENV_KEYS.includes(key) || SENSITIVE_KEY_PATTERN.test(key)` → delete），改名 `stripDeviceEnv` 並更新所有呼叫點；**保住既有「env 收斂後為空則刪除 env 物件」行為**（`sync.js:1170`）
- [x] 1.3 `extractDeviceValues` 的 env 迴圈同步反轉（`sync.js:1261`），保留本機值條件由「不在白名單」改為「命中黑名單或 pattern」，維持 strip↔preserve 互補
- [x] 1.4 將 `DEVICE_ENV_KEYS` 加入 `sync.js:3120` 的 `module.exports`（供測試斷言）
- [x] 1.5 **不動** `assertPortableSettingsSafe` 的 `skipKeyScan`（env key 掃描在黑名單下為死碼；env 值掃描本就恆常適用）

## 2. 補強：settings.json 明細 diff 不顯示 env 值

- [x] 2.1 `diffSettingsItem`（`sync.js:1850`）→ settings 明細 diff 路徑：對 env 做 key 層級呈現、值遮罩為 `***`（Decision 2 方案 A），或等效手段確保 env 值不進 `printFileDiff` 輸出
- [x] 2.2 確認差異狀態（changed/same）仍以未遮罩內容計算，僅顯示層遮罩
- [x] 2.3 確認 `--verbose` 亦不顯示 env 值

## 3. 文件與註解同步（含審查點名的失準處）

- [x] 3.1 `sync.js` 5 處 JSDoc/banner 改寫：`L35-41`（設計判準 banner）、`L1177`（跨函式指名舊函式）、`L1194-1196`（skipKeyScan 理由：改為「strip 已處理 key 名」而非「白名單放行」）、`L1224-1225`、`L1250-1252`
- [x] 3.2 README.md：`L151` env 段落由白名單改為黑名單混合制，明文標註殘餘風險與四層控制
- [x] 3.3 CLAUDE.md：表格列（`L52`）、`env` 安全底線段落（`L88`，「不可退讓的安全底線」措辭改為「已承擔風險的黑名單混合制」）、修改守則判準句（`L87`「開放 key 空間→白名單」補例外註記）、敏感資訊守則段
- [x] 3.4 `settings.test.js:570-575` 的說明註解（「白名單權威」）改為「strip 已處理 key 名」；**斷言本身不變**（env 仍跳過 key 掃描 → 仍 `doesNotThrow`）

## 4. 測試

- [x] 4.1 改寫 `test/settings.test.js` 白名單前提的 env 案例為黑名單語意（`:80-82`、`:107-132`、`:237-264`、`:433-441`、`:504-526`）：預設同步、黑名單/pattern 靜默剝除、to-local 保留
- [x] 4.2 改寫 `test/apply-integration.test.js` 相關 env 案例（`:118`、`:134`）
- [x] 4.3 新增測試（落點 `test/boundary.test.js`）：env 值命中 `SECRET_VALUE_PATTERN`（乾淨名 key、值 `sk-…`）→ to-repo fail-loud / diff 標記
- [x] 4.4 新增 characterization 測試（落點 `test/boundary.test.js`）：`DB_PASS=hunter2` 這類乾淨名+乾淨值 → 同步進 repo，但**斷言其值不出現在 diff 輸出**（對應「不顯示 env 值」需求），不斷言「必須洩漏」
- [x] 4.5 新增測試：settings 明細 diff 對 env 值遮罩（值不出現、key 差異可見）
- [x] 4.6 `npm test` 全綠
- [x] 註：`test/boundary.test.js` 現況**無** env 白名單案例（4.3/4.4 為新增，非改寫）

## 5. 驗證

- [x] 5.1 `openspec validate env-blacklist --strict` 通過
- [x] 5.2 手動 `npm run diff`：塞一個乾淨名+乾淨值的假機密到本機 env，確認 to-repo 會寫入但 diff 輸出不含其值
