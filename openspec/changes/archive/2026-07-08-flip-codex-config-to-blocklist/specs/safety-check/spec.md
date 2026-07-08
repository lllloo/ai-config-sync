## MODIFIED Requirements

### Requirement: safety check 回報 hard block

系統 SHALL 對明顯高風險內容回報 hard block。hard block 至少包含：已知 token 值樣式、私鑰片段、絕對 HOME 路徑、`claude/settings.json` 內出現 `hooks` 或 credential helper 欄位、以及 repo `codex/config.toml` 內出現機密載體 section（`model_providers.*`、`mcp_servers.*`）。若有任一 hard block，指令 SHALL 以 exit code `2` 結束。

#### Scenario: 偵測已知 token 值
- **WHEN** 同步來源含有符合已知 secret value pattern 的字串（如 `sk-`、`ghp_`、`AKIA`、`AIza` 或 JWT 前綴）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 偵測不應同步的 settings 欄位
- **WHEN** repo 的 `claude/settings.json` 含有 `hooks`、`apiKeyHelper`、`awsCredentialExport`、`awsAuthRefresh` 或 `otelHeadersHelper`
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 指出欄位路徑但 SHALL NOT 顯示欄位值

#### Scenario: 偵測不應同步的 codex config 機密 section
- **WHEN** repo 的 `codex/config.toml` 含有 `model_providers.*` 或 `mcp_servers.*` section
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 指出 section 路徑但 SHALL NOT 顯示其值
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 偵測絕對 HOME 路徑
- **WHEN** 同步來源含有 `/home/<user>/`、`/Users/<user>/` 或 `C:\Users\<user>\` 形式的絕對 HOME 路徑
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 遮罩完整使用者路徑
