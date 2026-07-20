## 1. 共用憑證判準（先做，兩端與 safety 皆依賴）

- [x] 1.1 在共用位置實作 fail-closed 憑證判準：`url` 的 pathname 與 query、`args` 每個元素，採「路徑片段長度 + 字元集熵」啟發式，判不出來即拒絕（D3）
- [x] 1.2 錯誤物件只攜帶欄位路徑（如 `servers.foo.url`、`servers.foo.args[2]`），MUST NOT 攜帶值；沿用 `McpValidationError.paths` 既有形狀
- [x] 1.3 錯誤訊息指引改用 `envKeys` 或手動維護，不提供繞過旗標
- [x] 1.4 單元測試：Zapier 形式 opaque token（`NjQ4MWZhZDgt...`）於 pathname 被擋、正常短路徑放行、args 內含憑證 URL 被擋、錯誤不含值

## 2. Claude 端 advisory 模組（`claude-mcp.js`）

- [x] 2.1 建立 `claude-mcp.js`，零外部相依，**不得 require `sync.js`**，且**不得含任何檔案寫入路徑**（本機端）
- [x] 2.2 實作 schema 驗證：`type` 支援 `http`／`sse`／`stdio`，HTTPS `url` 或白名單 `command`＋`args`，諮詢性 `envKeys`（僅 key 名）；未涵蓋的 `type` fail closed 報錯，MUST NOT 靜默丟棄（D5）
- [x] 2.3 實作唯讀 inspect：以 `JSON.parse` 讀 `~/.claude.json`，只取 top-level `mcpServers`，其餘欄位不解析不輸出（D2）
- [x] 2.4 檔案不存在視為「無任何 MCP Server」；malformed 回報該項目錯誤但不中止其他同步項目
- [x] 2.5 實作指令產生：輸出 `claude mcp add --transport <t> --scope user <name> <url>` 形式的可直接執行單行；需憑證者附註 env key 名，MUST NOT 填入真實值
- [x] 2.6 實作 `to-repo` 方向：由本機讀出可攜欄位寫入 `claude/mcp.json`，剝除 `env` 值與 `headers`
- [x] 2.7 建立 `claude/mcp.json`，以本機現有 supermemory（`type: http`、`https://mcp.supermemory.ai/mcp`）為首筆
- [x] 2.8 新增 `test/claude-mcp.test.js`：schema fail-closed、`sse` 不被丟棄、唯讀 inspect、指令產生正確性、to-repo 剝除憑證

## 3. Codex 端由 `mcp` 收斂為 advisory（`mcp.js` 淨減量）

- [x] 3.1 刪除投影寫入路徑：`projectToLocal`、`appendManagedSections`、`removeRanges`、`writeLocalProjection`
- [x] 3.2 刪除受管 state 機制：`validateMcpState`、`serializeMcpState`、`loadState`，以及 handler deps 的 `statePath`
- [x] 3.3 刪除本機 Authorization 的 surgical preservation 寫回邏輯與 TOML basic-string codec（`encodeTomlBasicString`／`decodeTomlBasicString`）中僅供寫回使用的部分
- [x] 3.4 保留並確認唯讀能力：`parseMcpConfig`／`collectSectionRanges`／`sameServer`／`diffServerSets`／`projectToRepo`／`writeRepoProjection`（寫 repo 保留）
- [x] 3.5 `parseMcpConfig` 維持容忍本機 `http_headers.Authorization`（不 fail closed、不輸出值、比對時忽略）；受管 section 未知 key 維持 fail closed，理由改記為「比對結論不可信」（D6）
- [x] 3.6 實作 Codex 指令產生：輸出 `codex mcp add ...` 單行，並於需要時附 `codex mcp login <name>` 後續步驟
- [x] 3.7 `createMcpHandler` 對外契約改為 `{ diffMcpItem, applyMcpItem }` 之 advisory 版本；`applyMcpItem` 的 to-local 分支只回傳建議指令，不寫檔

## 4. `sync.js` 型別與 manifest 接線

- [x] 4.1 新增 `homeRootFile` manifest 欄位與 materializer 解析（本機端路徑為 `$HOME/<file>`，不套用 area `homeBase`）
- [x] 4.2 `SYNC_MANIFEST` 新增 claude MCP 一列（`advisory` 型、`homeRootFile: '.claude.json'`、`fixedFlow`）
- [x] 4.3 `SYNC_MANIFEST` 的 codex MCP 一列由 `type: 'mcp'` 改為 `advisory`
- [x] 4.4 `diffSyncItem`／`applySyncItem` 的 `switch` 新增 `case 'advisory'`，移除 `case 'mcp'`
- [x] 4.5 移除 `CODEX_MCP_STATE` 常數與其 export
- [x] 4.6 新增 `claudeMcpHandler()` lazy singleton（照 `_mcpHandler` 樣式），deps 注入不含任何本機寫入能力
- [x] 4.7 `to-local` 流程：advisory 差異不計入待寫入變更數、不進確認閘門；全為 advisory 差異時直接輸出指令並 `EXIT_OK`
- [x] 4.8 建議指令輸出區塊統一格式（沿用 `skills:diff` 的呈現慣例），並移除既有的 `codex mcp login` 臨時提示（sync.js:2005 附近）改由指令產生器統一輸出
- [x] 4.9 更新 JSDoc 型別 union（兩處）
- [x] 4.10 `diff`／`status` 對 advisory 項目的唯讀失敗只回報該項目，不中止其他同步項目的比對

## 5. safety-check 擴充

- [x] 5.1 `scanMcpManifestSafety` 的 rel path 分派新增 `claude/mcp.json`
- [x] 5.2 接上共用憑證判準（第 1 組），確認同步驗證與 safety 共用同一實作、不出現分歧
- [x] 5.3 確認 `.toml` section hard block／device warn 兩份常數與掃描規則不變
- [x] 5.4 boundary 測試補：`claude/mcp.json` 的 URL pathname／args／憑證欄位三類 hard block

## 6. 測試改寫

- [x] 6.1 `test/mcp.test.js` 移除 3 條 `projectToLocal` 案例與 1 條 state partialChanges 案例
- [x] 6.2 `test/apply-integration.test.js` 的 4 條 MCP `to-local` 寫入驗證改寫為：斷言 `config.toml` 內容與 mtime 未變、無暫存檔產生、輸出含預期指令
- [x] 6.3 `test/apply-integration.test.js` 的 3 條 `to-repo` 案例保留並確認仍通過（移除 state 依賴）
- [x] 6.4 `test/diff-integration.test.js` 移除 state 檔 seed 與依賴，改以 repo/本機兩方集合直接比對
- [x] 6.5 新增整合測試：Claude advisory 的 `to-local` 對 `~/.claude.json` **零寫入**（mtime + 內容雙重斷言）
- [x] 6.6 `test/sync.test.js` 更新 manifest drift guard：codex MCP 列的 `type` 斷言改 `advisory`、新增 claude MCP 列斷言、`codexLabels`／`claudeLabels` 清單更新
- [x] 6.7 新增回歸鎖：`SYNC_MANIFEST` MUST NOT 含 `type: 'mcp'`；runtime 檔案清單納入 `claude-mcp.js`
- [x] 6.8 `npm test` 全綠

## 7. 文件

- [x] 7.1 README 同步項目表：新增 `claude/mcp.json` 列，`codex/mcp.json` 列改述為 advisory
- [x] 7.2 README「Codex MCP 同步行為」整節改寫為兩端共用的「MCP 諮詢式同步」，移除 state 檔與 Authorization 保留的敘述
- [x] 7.3 README 刻意不同步清單：新增「`~/.codex/config.toml` 永不寫入」，說明孤兒 state 檔可手動 `rm`
- [x] 7.4 README 專案檔案表新增 `claude-mcp.js` 與 `test/claude-mcp.test.js`
- [x] 7.5 CLAUDE.md 更新：同步項目表、架構重點的 `mcp.js` 段落、修改守則的 MCP 條目、型別 union
- [x] 7.6 確認 README drift-guard 測試（sync.test.js:468-548）全綠

## 8. 收尾

- [x] 8.1 `npm run safety:check` 無新增問題（exit 1，僅既有的 4 條 `claude/settings.json` env key warning；本次變更未新增任何 hard block 或 warning）
- [x] 8.2 `npm run diff` 於本機實跑，確認兩端 MCP 狀態行正確且不顯示 URL／header
- [x] 8.3 `npm run to-local -- --dry-run` 實跑，確認輸出建議指令且零寫入
- [x] 8.4 `openspec validate advise-claude-mcp-via-cli --strict` 通過
