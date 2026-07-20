## Why

兩端 MCP 的 advisory 同步（`claude/mcp.json`、`codex/mcp.json` → 唯讀比對 + 輸出 `claude mcp add`／`codex mcp add` 指令）在實務上並未帶來預期價值：兩份來源目前皆為空（`servers: {}`），卻讓 `sync.js` 背負一個專屬型別、兩個 handler 模組、一整套憑證判準與唯讀 inspect 邏輯。與其在既有形狀上疊補丁，不如先整批移除，讓 MCP 同步從乾淨的地基重新設計。

## What Changes

- **BREAKING** 移除 `advisory` 同步型別與兩列 MCP manifest（`claude/mcp.json`、`codex/mcp.json`），`diff`／`status`／`to-local` 不再回報或建議任何 MCP 相關內容。
- 刪除 `mcp.js`、`claude-mcp.js` 兩個模組，以及其攜帶的 MCP schema、憑證判準（`findUrlCredentialPaths`／`findArgsCredentialPaths`／`isSuspiciousToken`）、Codex `config.toml` 受管 section 唯讀解析、`~/.claude.json` 唯讀 inspect 與 CLI 指令產生。
- 刪除 repo 來源檔 `claude/mcp.json`、`codex/mcp.json`（皆為空 manifest，無資料遷移需求）。
- `safety-check.js` 移除 MCP 可攜來源的結構化掃描（`scanMcpManifestSafety` 與兩條路徑分派）。
- **保留** `toml-reader.js` 與 repo 內 `.toml` 機密 section 的 hard block（`model_providers.*`／`mcp_servers.*`）。此防線與 MCP 同步已脫鉤，職責是「防人工把含機密的 `config.toml` 放進 repo」，移除 MCP 同步不減其必要性。
- 刪除 `test/mcp.test.js`、`test/claude-mcp.test.js`，並清理其他測試檔中的 advisory／MCP 斷言與 drift-guard 期望值。
- 同步更新 `README.md`、`CLAUDE.md` 的同步項目表、架構說明與修改守則。
- 保留既有的「`~/.claude.json` 與 `~/.codex/config.toml` 永不被寫入」不變式——移除後這兩個檔案連唯讀讀取的程式路徑也不存在。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `mcp-advisory`: 整個 capability 移除。所有 requirement（advisory 零寫入、可攜來源 schema、憑證 fail-closed 判準、唯讀 inspect、本機額外只列不刪、建議指令形式）不再適用。
- `declarative-sync-manifest`: 型別集合由 `file`／`dir`／`settings`／`xtool-skills`／`advisory` 收斂為 `file`／`dir`／`settings`／`xtool-skills`；固定流向項目只剩 `settings.json`。
- `safety-check`: 移除「safety check 掃描 MCP 可攜來源」requirement；`.toml` 機密 section hard block 不變。

## Impact

- **程式碼**：`sync.js`（require、`SYNC_MANIFEST` 兩列、型別 JSDoc、`diffSyncItem`／`applySyncItem` 的 `case 'advisory'`、`advisoryHandler`／`mcpHandler`／`claudeMcpHandler`、`buildFullDiffList` 的 advisory 分支、建議指令收集與輸出、`runToLocal` 的 advisory 閘門排除）、`safety-check.js`。刪除 `mcp.js`、`claude-mcp.js`。
- **repo 內容**：刪除 `claude/mcp.json`、`codex/mcp.json`。
- **測試**：刪除 `test/mcp.test.js`、`test/claude-mcp.test.js`；`test/sync.test.js`（manifest 與型別 drift-guard、「兩端 MCP 皆 advisory」與「`type: 'mcp'` 不得復活」guard）、`test/boundary.test.js`（`SAFETY_RUNTIME_FILES`）、`test/diff-integration.test.js`／`test/apply-integration.test.js`（`SYNC_RUNTIME_FILES` 與 advisory 零寫入斷言）需更新。
- **文件**：`README.md`、`CLAUDE.md`。
- **不受影響**：`toml-reader.js`、`test/toml-reader.test.js`、skills 同步、settings 黑名單機制、opencode 同步。
- **使用者影響**：既有裝置上的 `~/.claude.json`、`~/.codex/config.toml` 完全不動；MCP 設定回歸由使用者以官方 CLI 手動維護，直到新設計落地。
