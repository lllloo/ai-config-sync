## REMOVED Requirements

### Requirement: MCP 同步採諮詢式，永不寫入本機設定

**Reason**: 整個 `mcp-advisory` capability 移除，準備重新設計。兩份 repo 來源目前皆為空 manifest，advisory 機制未帶來實際價值，卻讓 `sync.js` 背負專屬型別與兩個 handler 模組。

**Migration**: 無資料遷移需求（`claude/mcp.json`／`codex/mcp.json` 皆為 `servers: {}`）。使用者的 MCP 設定回歸以官方 CLI（`claude mcp add`／`codex mcp add`）手動維護，直到新設計落地。`~/.claude.json` 與 `~/.codex/config.toml` 在本變更前後皆未被寫入，本機狀態不受影響。

### Requirement: MCP 可攜來源只存非機密身分欄位

**Reason**: 隨 capability 一併移除；`claude/mcp.json` 與 `codex/mcp.json` 兩個 repo 來源檔已刪除，schema 無承載對象。

**Migration**: 無。重新設計時若再引入 repo 來源，需重新定義其 schema 與機密邊界，不得直接沿用已刪除的實作。

### Requirement: URL pathname 與 args 的憑證檢查為 fail closed

**Reason**: 判準實作（`isSuspiciousToken`／`findUrlCredentialPaths`／`findArgsCredentialPaths`）位於已刪除的 `mcp.js`，且唯一消費者為 MCP 同步與 `safety:check` 的 MCP 掃描，兩者皆移除。

**Migration**: 無現存呼叫端。重新設計 MCP 同步時，若 repo 端要存放任何 URL 或 args，SHALL 重新建立等價的 fail-closed 憑證判準——本次移除不得被解讀為此原則的放寬。

### Requirement: 唯讀 inspect 提供偵測能力

**Reason**: 隨 capability 一併移除。移除後 `~/.claude.json` 的 top-level `mcpServers` 與 `~/.codex/config.toml` 的 `[mcp_servers.*]` 連唯讀讀取的程式路徑都不存在。

**Migration**: 無。「這兩個檔案永不被本工具寫入」的不變式維持不變且更為徹底。

### Requirement: 本機額外 Server 只列出不刪除

**Reason**: 隨 capability 一併移除；系統不再比對本機 MCP Server，無「本機額外」概念。

**Migration**: 無。既有裝置上可能殘留的 `~/.codex/.ai-config-sync-mcp-state.json` 仍為孤兒檔，本工具不代刪，使用者可自行 `rm`。

### Requirement: 建議指令為可直接執行的完整形式

**Reason**: 隨 capability 一併移除；`to-local` 不再輸出任何 MCP 建議指令區塊。

**Migration**: 無。使用者改以官方 CLI 文件為準手動新增 MCP Server。
