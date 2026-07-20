## REMOVED Requirements

### Requirement: safety check 掃描 MCP 可攜來源

**Reason**: `claude/mcp.json` 與 `codex/mcp.json` 兩個 repo 來源檔已刪除，結構化掃描無掃描對象；其判準實作位於已刪除的 `mcp.js`／`claude-mcp.js`。

**Migration**: 無。`safety:check` 的其餘掃描（secret value pattern、私鑰片段、絕對 HOME 路徑、`claude/settings.json` 的 `hooks`／credential helper、repo 內任何 `.toml` 的機密載體 section）全部不變；repo 內若出現任何含憑證的 JSON 檔，仍由既有 text pattern 掃描與 hard block 涵蓋。重新設計 MCP 同步時若再引入 repo 來源，SHALL 重新加回等價的結構化掃描。

## MODIFIED Requirements

### Requirement: safety check 回報 hard block

系統 SHALL 對明顯高風險內容回報 hard block。hard block 至少包含：已知 token 值樣式、私鑰片段、絕對 HOME 路徑、`claude/settings.json` 內出現 `hooks` 或 credential helper 欄位、以及 repo 內任何 `.toml` 出現機密載體 section（`model_providers.*`、`mcp_servers.*`）。若有任一 hard block，指令 SHALL 以 exit code `2` 結束。

`.toml` 機密載體 section 的 hard block SHALL 與 MCP 同步機制解耦：即使系統不再同步任何 MCP 設定，此防線仍 SHALL 存在，其職責為阻止人工把含機密的 `config.toml` 放進 repo。

#### Scenario: 偵測已知 token 值
- **WHEN** 同步來源含有符合已知 secret value pattern 的字串（如 `sk-`、`ghp_`、`AKIA`、`AIza` 或 JWT 前綴）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 偵測不應同步的 settings 欄位
- **WHEN** repo 的 `claude/settings.json` 含有 `hooks`、`apiKeyHelper`、`awsCredentialExport`、`awsAuthRefresh` 或 `otelHeadersHelper`
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 偵測 toml 機密載體 section
- **WHEN** repo 內任何 `.toml` 檔含有 `model_providers.*` 或 `mcp_servers.*` section
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: toml 防線不隨 MCP 同步移除而失效
- **WHEN** 系統已無任何 MCP 同步項目、`mcp.js` 與 `claude-mcp.js` 皆不存在
- **AND** 有人將含 `[mcp_servers.foo]` 的 `.toml` 放進 repo 同步來源
- **THEN** `safety:check` SHALL 仍回報 hard block
- **AND** `toml-reader.js` 與其回歸測試 SHALL 保持存在
