## 1. MCP 資料模型與模組骨架

- [x] 1.1 新增 `codex/mcp.json` version 1 來源，寫入預設啟用、無 `x-sm-project` 的 Supermemory Streamable HTTP 定義。
- [x] 1.2 新增 `mcp.js` 與 `createMcpHandler(deps)` DI 骨架，維持不反向 require `sync.js`、零外部相依及函式 ≤ 60 行。
- [x] 1.3 實作 MCP manifest 載入、Server 名稱驗證與最小白名單 schema（`transport`／`url`／`enabled`），未知／敏感欄位與非 HTTPS URL fail closed。
- [x] 1.4 實作 deterministic `codex/mcp.json` 序列化，確保穩定排序、結尾換行與 atomic write。

## 2. Codex TOML 投影與受管狀態

- [x] 2.1 以 `toml-reader.js` 的 header／line metadata 實作 MCP section 範圍辨識，涵蓋普通／引號名稱並拒絕 malformed、重複及 array-table。
- [x] 2.2 實作受管 section 的 `url`／`enabled` 白名單解析與 TOML quoted-key／basic-string 安全序列化；未知、重複或無法解析欄位 fail closed。
- [x] 2.3 實作 `to-local` section-level merge：upsert repo 受管名稱、保留所有非 MCP 與不受管 MCP 原文、語意無變更時不寫檔。
- [x] 2.4 新增 `CODEX_HOME/.ai-config-sync-mcp-state.json` versioned state 載入／atomic 寫入，記錄裝置受管名稱。
- [x] 2.5 實作 stale managed 刪除與 config→state 寫入順序；state 寫入失敗時附掛 partialChanges 並回報部分套用。
- [x] 2.6 實作 `to-repo`：只讀回 repo／state 已受管名稱的合法欄位、本機刪除反映至 repo、未受管本機 MCP 不自動吸入。

## 3. 同步核心與安全整合

- [x] 3.1 擴充 `SyncItem`／`SYNC_MANIFEST` materializer 支援 `homeLabel`，新增 `codex/mcp.json → ~/.codex/config.toml` 的 `mcp` fixed-flow 列。
- [x] 3.2 在 `diffSyncItem`／`applySyncItem` 增加明確 `mcp` case，透過 lazy MCP handler 接上 direction-aware diff／apply。
- [x] 3.3 讓 `diff`／`status`／`to-repo`／`to-local` 的摘要、dry-run、確認與 partial-apply 可見度涵蓋 MCP，輸出只列 Server 名與狀態。
- [x] 3.4 讓 `safety:check` 重用 MCP manifest validator，對 schema 外或疑似機密欄位 hard block，且只輸出檔案／欄位路徑不輸出原值。
- [x] 3.5 保留 `SYNC_MANIFEST` 不含 `codex/config.toml` 的回歸鎖，新增 `codex/mcp.json` 為唯一 Codex MCP repo 來源的 drift guard。

## 4. 單元與整合測試

- [x] 4.1 新增 `test/mcp.test.js`，覆蓋 manifest schema、名稱／URL 驗證、deterministic JSON、TOML encode/decode 與 section 範圍純函式。
- [x] 4.2 補 `test/sync.test.js`：`homeLabel` materialize、`mcp` 型別 dispatch、manifest 項目與 `config.toml` 不得回歸。
- [x] 4.3 補 `test/diff-integration.test.js`：一致、repo-only、本機不同、stale managed、未受管 local-only 與不顯示設定值。
- [x] 4.4 補 `test/apply-integration.test.js`：to-local upsert／保留／stale 刪除／dry-run、to-repo 更新／刪除／不吸入、atomic state 與部分失敗可見度。
- [x] 4.5 補 `test/boundary.test.js`：敏感／未知欄位、非 HTTPS、malformed／重複／引號 TOML、Authorization 值遮罩及 `safety:check` hard block。
- [x] 4.6 將 `mcp.js` 加入所有沙箱 runtime file 清單，確保 diff、apply、safety 三類整合測試不依賴真實 HOME。

## 5. 文件與驗證

- [x] 5.1 更新 README：同步項目表、目錄命名、Codex config 不同步邊界、安全檢查、新電腦 `git pull → to-local → codex mcp login supermemory` 流程。
- [x] 5.2 更新 CLAUDE.md：`mcp.js` 模組邊界、manifest `homeLabel`／`mcp` 型別、受管 state、修改守則及測試 runtime 清單。
- [x] 5.3 執行 `npm test` 與 `npm run safety:check`：319 項測試全數通過，MCP 來源無問題；safety 僅保留既有 `claude/settings.json` 的 4 個 env-key warnings。
- [x] 5.4 執行 `node sync.js to-local --dry-run --no-color`，人工確認預覽只觸及 Supermemory MCP 與受管 state，不改其他 Codex 設定。
- [x] 5.5 以 `codex mcp list` 搭配一次性 config override 驗證 Supermemory 可被辨識為啟用的 `streamable_http`；OAuth 登入與實際 `whoAmI`／save／recall 留為使用者明確執行的部署驗證，不在自動測試或 apply 中觸發。

## 6. Supermemory 本機 API Key overlay

- [x] 6.1 更新 OpenSpec 與 README：最終認證改為每台裝置本機 `http_headers.Authorization`，repo schema 仍不含任何認證欄位。
- [x] 6.2 擴充 `mcp.js`：受管 section 僅允許並原文保留單行 `http_headers.Authorization`；可攜比較與 `to-repo` 忽略其值，其他未知 header／欄位仍 fail closed。
- [x] 6.3 移除 `codex/mcp.json` 的 `bearerTokenEnvVar`，同步更新 CLAUDE.md 的本機認證與修改守則。
- [x] 6.4 補齊單元／diff／apply／boundary 測試，證明 header 在 to-local 更新後保留、to-repo 不吸入、輸出不洩漏、未知 header 仍被拒絕。
- [x] 6.5 執行 `npm test`、`npm run safety:check`、真實 `diff` 與 `to-local --dry-run`；確認 API Key header 保留且預覽無值。
