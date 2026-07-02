## 1. sync.js 核心翻轉

- [x] 1.1 新增 `DEVICE_SETTINGS_KEYS` 與 `SENSITIVE_KEY_PATTERN` 常數（含 doc comment 說明混合制依據與 D6 慣例表），移除 `PORTABLE_SETTINGS_KEYS`；`PORTABLE_ENV_KEYS` 與 `stripNonPortableEnv` 零改動
- [x] 1.2 新增 partition 函式 `partitionSettingsTopLevel(data)` → `{ portable, device }`（一次分區產出兩桶），`loadStrippedSettings`（取 portable、device key 名為 dropped）與 `extractDeviceValues`（取 device）皆消費同一次分區，確保 strip／preserve 雙向互補與 dropped 同源
- [x] 1.3 新增 D7 值層防線 `assertPortableSettingsSafe(clean)`：遞迴掃描巢狀 key 名（env 子樹跳過 key 掃描）與字串值（機密前綴、絕對家目錄路徑），命中即拋 `SyncError`（訊息含欄位路徑、不含值），掛在 `loadStrippedSettings` 回傳前
- [x] 1.4 更新 `sync.js` 檔內相關註解（`loadStrippedSettings`、`extractDeviceValues`、`mergeSettingsBetween` 等處的「白名單」措辭），並更新 module.exports 匯出的常數與函式名

## 2. diff 可見性

- [x] 2.1 `diff`／`status` 預設輸出被排除 top-level key 名的一行摘要（只列 key 名、不印值），`--verbose` 維持較詳細輸出；確認 `dropped` 路徑不觸碰值內容

## 3. 測試

- [x] 3.1 反轉 `test/settings.test.js` 中 top-level 白名單語義的測試：未知非敏感 key 進 repo、黑名單 key 剝除、pattern 命中 key 剝除；env 白名單測試維持不動並確認通過
- [x] 3.2 新增互補性測試：任一 key 集合經 to-repo strip 與 to-local preserve 後無遺失、無雙寫（直接測 `isPortableTopLevelKey` 與 `mergeSettingsBetween` 雙向）
- [x] 3.3 新增 pattern 護欄測試：`newAuthTokenHelper`、`fooCredentialPath`、`barRefresh` 等假想欄位被排除；`keyboardLayout` 類誤傷案例明文標記為已知取捨（測試斷言其被排除，附註解）；回歸測試「原白名單 10 欄位翻轉後全數仍可攜」
- [x] 3.4 新增 D7 值層防線測試：巢狀敏感 key（如 `integrations.apiToken`）中止、機密前綴值中止、絕對家目錄路徑值中止、錯誤訊息不含值本身、`env` 子樹 key 掃描豁免、現行 repo 收斂版內容不誤觸
- [x] 3.5 修正 `boundary.test.js`、`diff-integration.test.js`、`apply-integration.test.js` 受影響斷言，`npm test` 全數通過

## 4. repo 來源檔收斂

- [x] 4.1 以新規則對本機 settings.json 執行 to-repo（先 `--dry-run` 預覽），逐一人工確認新進 repo 的欄位皆非敏感、非裝置特定，更新 repo `claude/settings.json`（注意：確認過程若發現該排除的欄位，回饋修改 1.1 的 `DEVICE_SETTINGS_KEYS` 後重跑 3.x）

## 5. 文件

- [x] 5.1 改寫 `CLAUDE.md`：settings.json 同步策略段落（白名單 → 黑名單混合制）、修改守則中的不變式措辭（「repo settings.json 永遠為黑名單＋pattern 收斂版」）、新增 D6 跨工具過濾慣例表（含 opencode／pi 擴充方向與 codex open question）、記載 spec 佈局慣例（一工具一 capability：`claude-settings-sync`／`codex-config-sync`／`opencode-config-sync`／`pi-config-sync`，引擎級不變式歸 `sync-engine`）
- [x] 5.2 改寫 `README.md` 同步項目表與同步策略說明，明文記錄黑名單制的風險承擔（裝置型新欄位互踩）與兩種訊號的分工（互踩靠 value-diff、pattern 誤傷靠 dropped 清單）

## 6. 收尾驗證

- [x] 6.1 repo 收斂與文件改寫完成後，全套件重跑 `npm test` 確認全綠（4.1 改動受版控檔案，整合測試斷言可能受影響）
