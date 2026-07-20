## ADDED Requirements

### Requirement: safety check 掃描 MCP 可攜來源

系統 SHALL 對 repo 的 MCP 可攜來源（`claude/mcp.json` 與 `codex/mcp.json`）執行結構化掃描，判準 SHALL 與同步流程的驗證共用同一實作，避免兩者行為分歧。掃描 SHALL 涵蓋 `url` 的 pathname 與 query、`args` 的每個元素、以及不應存在於 repo 的憑證欄位。

#### Scenario: MCP 來源含 path-embedded 憑證回報 hard block

- **WHEN** `claude/mcp.json` 或 `codex/mcp.json` 的某 Server URL 於 pathname 或 query 含無法判定為安全的高熵片段
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 指出欄位路徑但 MUST NOT 顯示該片段的值
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: MCP 來源含 args 挾帶憑證回報 hard block

- **WHEN** `stdio` 型 Server 的 `args` 某元素含憑證或含憑證的 URL
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 指出是第幾個 arg 但 MUST NOT 顯示其值

#### Scenario: MCP 來源出現憑證欄位回報 hard block

- **WHEN** MCP 可攜來源出現 `headers`、`Authorization` 或 `env` 值等憑證載體欄位
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 指出欄位路徑但 MUST NOT 顯示其值

#### Scenario: 掃描判準與同步驗證一致

- **WHEN** 某個 MCP 來源內容被同步流程的驗證拒絕
- **THEN** `safety:check` 對同一內容 SHALL 同樣回報 hard block
- **AND** 兩者 MUST NOT 出現「同步擋下但 safety 放行」或反之的分歧
