## Why

跨裝置還原 MCP Server 目前有兩條不一致的路：Claude Code 的 user-scope MCP 存於 `~/.claude.json` 的 top-level `mcpServers`，**完全沒有同步機制**，新裝置需手動重建；Codex 則由 `codex/mcp.json` 經 TOML section-level 投影**自動寫入** `~/.codex/config.toml`。

先前的 `sync-claude-mcp-config` 提案試圖把 Claude 端也做成自動寫入（「member 級 JSON splice」），實作後審查確認 4 項缺陷：URL path／`args` 挾帶的 token 會被寫進 repo（機密外洩，`safety:check` 亦不擋）、名稱落在 `Object.prototype` 的 member 被靜默改寫且 `diff` 顯示無差異、`sse` transport 被靜默丟棄並導致本機 member 遭刪、top-level 重複 `mcpServers` key 未 fail closed。

根因不是實作品質，而是**目標選錯**：`~/.claude.json` 是 76 KB、含 OAuth session token 與 `projects[].history`、且被 Claude Code 持續寫入的活檔，對它做字元級 splice 是在重造 `claude mcp add --scope user` 已提供的官方能力。本 repo 對 skills 早已採「只輸出建議指令、不執行安裝／移除」（`skills-lock-diff` spec），MCP 應套用同一模式。

**兩端一併收斂**：`codex mcp add` 同樣是功能完整的官方 CLI，故 Codex 端維持自動寫入的理由僅剩「爆炸半徑較小」（`config.toml` 不含 OAuth token 與專案歷史）。這個理由成立但不足以支撐兩套心智模型，也不足以支撐一整組只為「安全改寫本機活檔」而存在的機制。統一為 advisory 後，本工具對**任何本機 MCP 設定檔零寫入**，Codex 端連帶可刪除受管 state 檔與本機 Authorization header 的 surgical preservation 邏輯——後者的存在理由正是「我們要重寫這個檔案但不能弄丟使用者的憑證」，不再重寫即不再需要。

## What Changes

- 新增 repo 來源 `claude/mcp.json`，只保存可攜、非機密的 Claude MCP Server 定義（`type: http`／`sse`／`stdio`、HTTPS `url` 或白名單 `command`＋`args`、諮詢性 `envKeys`）。
- 新增 **advisory（諮詢式）同步型**：`diff`／`status` **唯讀**讀取本機設定比對受管 Server 並回報差異；`to-local` **不寫入任何本機檔**，改為輸出可直接執行的官方 CLI 指令（Claude 為 `claude mcp add --scope user ...`，Codex 為 `codex mcp add ...`）。
- `to-repo` 兩端維持寫入 **repo** 來源（`claude/mcp.json`／`codex/mcp.json`），`env` 值／`headers`／`Authorization` 一律剝除。「不寫入」只約束本機端。
- **Codex 端由 `mcp` 型收斂為 advisory 型**：
  - 移除 `~/.codex/config.toml` 的投影寫入（`projectToLocal`／`appendManagedSections`／`removeRanges`／`writeLocalProjection`）。
  - 移除受管 state 檔 `~/.codex/.ai-config-sync-mcp-state.json` 與其 schema／序列化。
  - 移除本機 Authorization header 的 surgical preservation 寫回邏輯；`parseMcpConfig` 仍**容忍**該 header 存在（不 fail closed）、仍不輸出其值。
  - 保留唯讀能力：`parseMcpConfig` 讀 `config.toml` 受管 section、`diffServerSets` 集合比對、`projectToRepo` 讀回可攜欄位。
- **修補機密外洩**：`url` 的 **pathname**（不只 query）與 `args` 的每個元素皆須通過憑證檢查；無法判定為安全者 fail closed。`safety:check` 同步擴充至 `claude/mcp.json`。
- **stale 語意改變**：repo 有而本機沒有 → 輸出 add 指令；本機有而 repo 沒有 → 僅列為「本機額外」供參考，**不輸出 remove 指令、不執行刪除**（與 `skills:diff` 一致，刪除決策留給使用者）。這使受管 state 檔失去唯一存在理由。
- **BREAKING（相對於未合併的 `sync-claude-mcp-config`）**：不再寫入 `~/.claude.json`，不再需要 member splice 掃描器。該提案的 splice 半部整體不採用。
- **BREAKING（相對於已上線的 Codex MCP 同步）**：`npm run to-local` 不再自動更新 `~/.codex/config.toml`。既有裝置的 `config.toml` 內容**原地保留不動**，state 檔成為孤兒檔（不自動刪除，README 註明可手動移除）。
- 政策維持「`~/.claude.json` 永不寫入」；新增「`~/.codex/config.toml` 永不寫入」。兩者皆放寬為**唯讀讀取受管 MCP 區塊**作比對，其餘欄位不讀不寫。

## Capabilities

### New Capabilities

- `mcp-advisory`: 定義兩端 MCP 可攜來源 schema、本機設定唯讀比對、`to-local` 的 CLI 指令輸出契約、憑證隔離與 fail-closed 驗證。涵蓋 Claude（`~/.claude.json` top-level `mcpServers`）與 Codex（`~/.codex/config.toml` 受管 `[mcp_servers.*]`）。

  註：Codex MCP 的既有契約定義於 `openspec/changes/archive/2026-07-19-sync-codex-mcp-config/specs/codex-mcp-sync/spec.md`，**該 spec 從未 sync 進 `openspec/specs/`**，故無法對其做 delta。本 change 以 `mcp-advisory` 統一承載兩端契約，取代該 archive spec 中「to-local 只合併受管 MCP sections」「受管 state 支援殘留刪除」兩條 requirement 的行為。

### Modified Capabilities

- `declarative-sync-manifest`: 新增 `advisory` 型別與 `homeRootFile` 欄位（本機端目標為 `$HOME` 下的相對檔名，位於 area homeBase 之外）；移除 `mcp` 型別。既有 area／`homeLabel`／`variants`／`fixedFlow` 行為不變。
- `bidirectional-sync-workflow`: `to-local` 對 advisory 型項目不執行寫入、不納入確認閘門的寫入清單，改於摘要後輸出建議指令。
- `safety-check`: 掃描範圍新增 `claude/mcp.json`，對 URL pathname／query／`args` 挾帶憑證、`env` 值、`headers` 出現於 repo 來源者 hard block。`config.toml` 的 section 掃描規則不變。

## Impact

- **程式碼**：新增 `claude-mcp.js`（schema 驗證、唯讀 inspect、set-diff、指令產生；**無**檔案寫入路徑）；`mcp.js` 淨減量——刪除投影寫入、state、TOML 字串 codec 與 Authorization 保留邏輯，保留解析／diff／`projectToRepo`；`sync.js` 新增 advisory 型分派與 `homeRootFile` 機制，移除 `mcp` 型分派與 `CODEX_MCP_STATE` 常數。
- **同步來源**：新增 `claude/mcp.json`。不新增任何本機狀態檔；移除既有的 `~/.codex/.ai-config-sync-mcp-state.json` 用途。
- **安全**：憑證檢查涵蓋 URL pathname 與 `args`；`to-repo`／diff／輸出一律不含 `env` 值、`headers` 與 `Authorization`。
- **測試**：新增 `test/claude-mcp.test.js`；`test/mcp.test.js` 移除 3 條 `projectToLocal` 與 1 條 state partialChanges 案例；`test/apply-integration.test.js` 的 4 條 MCP `to-local` 寫入驗證改寫為「零檔案寫入 + 指令輸出」，3 條 `to-repo` 案例保留；`test/diff-integration.test.js` 移除 state 檔依賴；`test/sync.test.js` 的 manifest drift guard（codex MCP 唯一來源、`type: 'mcp'` 硬編）須更新。
- **文件**：README 同步項目表、「Codex MCP 同步行為」整節改寫、刻意不同步清單、專案檔案表；CLAUDE.md 政策條目與架構重點。
- **相依性**：維持 Node.js 18+、零外部套件。
- **不影響**：`toml-reader.js` 與 `config.toml` 整檔不同步政策、skills 同步、既有非 MCP drift guards。
