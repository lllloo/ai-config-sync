## Why

Codex MCP 設定目前只存在於每台裝置的 `~/.codex/config.toml`，而該檔因混有裝置狀態、路徑與機密載體而被本專案刻意排除，造成新電腦必須逐一手動重建 MCP Server。需要一個只同步可攜 MCP 定義、保留本機 OAuth 與其他 Codex 設定的窄邊界。

## What Changes

- 新增 repo 來源 `codex/mcp.json`，只保存可攜、非機密的 Codex MCP Server 定義；Supermemory 為第一個項目，使用 `https://mcp.supermemory.ai/mcp`、預設啟用，且不設定 `x-sm-project`。
- `diff`／`status`／`to-repo`／`to-local` 納入 Codex MCP 差異與套用；`to-local` 只合併本機 `~/.codex/config.toml` 的 `[mcp_servers.*]`，不得覆寫其他 section。
- 對受管 Server 採非 prune 共管：保存不受管的本機 MCP；以裝置本機狀態記錄受管名稱，讓 repo 後續移除項目時能刪除對應的舊受管設定。
- `to-repo` 只擷取受管 Server 的可攜欄位；本機受管 section 可保留靜態 `http_headers.Authorization`，但其值不得進入 repo、diff、preview 或錯誤輸出。
- Supermemory 採每台裝置本機設定的 API Key Bearer header，不使用 OAuth 登入；新電腦 `to-local` 後各自加入本機 header。
- 維持 `codex/config.toml` 不存在、`~/.codex/config.toml` 不做整檔同步的既有政策。
- v1 僅支援 Codex Streamable HTTP MCP；Claude Code、OpenCode、stdio MCP 與 project-specific `x-sm-project` 不在本次範圍。

## Capabilities

### New Capabilities

- `codex-mcp-sync`: 定義 Codex MCP 可攜來源、雙向差異／合併、受管名稱共管、憑證隔離及 Supermemory 初始項目。

### Modified Capabilities

（無；既有同步 manifest、CLI 與 safety-check 契約不改，新增行為由新 capability 定義。）

## Impact

- **程式碼**：新增獨立 MCP 模組；`sync.js` 增加模組注入、同步項目型別與明確 switch 分派。
- **同步來源**：新增 `codex/mcp.json`；本機目的地為 `~/.codex/config.toml` 的 MCP sections，另新增不進 repo 的受管狀態檔。
- **安全**：擴充結構驗證與 `safety:check` 覆蓋，確保來源不含憑證；本機 header 只作 opaque preservation，輸出不洩漏值。
- **測試**：新增 MCP 純函式測試，以及沙箱化 diff／to-repo／to-local／殘留刪除／機密拒絕整合案例。
- **文件**：更新 README、CLAUDE.md 與新電腦部署流程。
- **相依性**：維持 Node.js 18+、零外部套件。
