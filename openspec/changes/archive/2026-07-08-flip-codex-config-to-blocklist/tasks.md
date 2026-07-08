## 1. codex-config.js 過濾反轉

- [x] 1.1 `isPortableCodexConfigKey(section, key)` 反轉為黑名單混合判斷：section 命中 `CODEX_CONFIG_DEVICE_SECTION_PREFIXES`（等於項或以 `<項>.` 為前綴）→ 排除；`plugins.*` → 只放行 `enabled`（D2 carve-out）；top-level → 只放行 `CODEX_CONFIG_TOP_KEYS` 允許清單（D3 carve-out）；其餘 → 放行。三分支以清楚註解表達，避免漂移
- [x] 1.2 `CODEX_CONFIG_DEVICE_SECTION_PREFIXES` 升格為權威排除清單並補齊 `tui.model_availability_nux`；doc comment 從「僅供未分類提示降噪」改寫為「section 黑名單權威清單」；移除 `CODEX_CONFIG_SECTION_KEYS`（section 內挑 key 的白名單）
- [x] 1.3 `parsePortableCodexConfig`／`getCodexConfigKeys`／`serializePortableCodexConfig`／`mergePortableCodexConfig` 由「只認白名單 key」改為「複製非黑名單 section 全部 key、plugins/top-level 套 carve-out」；確認 to-local merge 仍保留本機被排除 section（D1 to-local scenario）
- [x] 1.4 移除 `collectUnclassifiedCodexKeys`、`isKnownDeviceCodexSection` 及 module.exports 對應匯出（D5）
- [x] 1.5 更新 `codex-config.js` 檔頭與函式註解中「白名單／allowlist／fail-safe」措辭為「section 黑名單 + carve-out」

## 2. sync.js 轉接與提示移除

- [x] 2.1 移除 `warnUnclassifiedCodexConfig` 及其在 `diff`／`status`／`to-repo` 的呼叫（D5）；確認新同步的 section／key 由一般 value-diff 顯示
- [x] 2.2 調整 `sync.js` re-export 的 codex-config 常數清單（移除已刪常數／函式）；驗證 `diffCodexConfigItem`／`diffCodexConfigToLocal` 在新 merge 語義下正確

## 3. safety-check.js 機密 section hard block

- [x] 3.1 `safety-check.js` 對 repo `codex/config.toml` 出現 `model_providers.*`／`mcp_servers.*` section 回報 hard block（比照 `SETTINGS_HARD_BLOCK_KEYS`）；只印 section 路徑、不印值（D4）；敏感命名 key 維持 warning 不變

## 4. 測試

- [x] 4.1 反轉 `test/codex-config.test.js` 白名單語義：未列黑名單 section 進 repo、黑名單 section 整段排除、未知新 section 預設同步
- [x] 4.2 新增 carve-out 測試：`plugins.*` 只同步 `enabled`（其他 key 被排除）、top-level 只同步 `personality`/`web_search`（裝置 key 被排除）
- [x] 4.3 新增 to-local 測試：黑名單 section 的本機內容套用 repo 後不受影響
- [x] 4.4 `boundary.test.js` 新增 config.toml 機密 section hard-block 案例（repo config.toml 含 `model_providers.*` → exit 2、只印 section 路徑）
- [x] 4.5 修正 `diff-integration.test.js`、`apply-integration.test.js` 受影響斷言；移除 `warnUnclassifiedCodexConfig` 相關斷言；`npm test` 全數通過

## 5. repo 來源檔收斂

- [x] 5.1 以新規則對本機 config.toml 執行 to-repo（先 `--dry-run` 預覽），逐一人工確認新進 repo 的 section／key 皆非機密、非裝置特定，更新 repo `codex/config.toml`（若發現該排除者，回饋修改 1.2 黑名單後重跑 4.x）

## 6. 文件

- [x] 6.1 改寫 `CLAUDE.md`：同步項目表 `codex/config.toml` 列（白名單→section 黑名單混合制 + carve-out）、架構重點 `codex-config.js` 段、修改守則；移除 `warnUnclassifiedCodexConfig` 描述；記載新 capability `codex-config-sync` 與 D6 慣例的落實
- [x] 6.2 改寫 `README.md` 同步項目表與同步策略說明，明文記錄黑名單制的風險承擔（保留 section 新 key 互踩）、top-level/plugins carve-out 的理由與 top-level 翻轉的前置條件

## 7. 收尾驗證

- [x] 7.1 repo 收斂與文件改寫完成後，全套件重跑 `npm test` 確認全綠；`npm run safety:check` 對收斂後 repo 為 clean（exit 0）
