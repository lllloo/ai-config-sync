# safety-check Specification

## Purpose
TBD - created by archiving change decouple-safety-check. Update Purpose after archive.
## Requirements
### Requirement: safety check 為唯讀離線檢查

系統 SHALL 提供 `npm run safety:check` 指令，用於檢查 repo 內同步來源是否含高風險設定或需人工審核的可疑項目。該指令 SHALL 為唯讀操作，MUST NOT 修改任何檔案、MUST NOT 安裝 git hook、MUST NOT 呼叫 LLM 或網路服務。

#### Scenario: safety check 不寫入檔案
- **WHEN** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 只讀取 repo 內容並輸出檢查結果
- **AND** 系統 MUST NOT 修改任何檔案或 git 設定

#### Scenario: safety check 不連網
- **WHEN** 使用者執行 `npm run safety:check`
- **THEN** 系統 MUST NOT 呼叫 LLM、HTTP API 或任何外部網路服務

### Requirement: safety check 掃描同步來源

系統 SHALL 掃描 repo 中會被同步或描述同步狀態的來源，包括 `claude/`、`codex/`、`opencode/` 與 `skills-lock.json`。系統 SHALL NOT 預設掃描 `test/`、`openspec/`、README 或其他純文件，以避免測試資料與範例造成噪音。

機密值／私鑰／絕對 HOME 路徑的 **text pattern 掃描** SHALL 只作用於本 repo 維護的設定同步來源，並 SHALL 排除原樣鏡射的外部套件文件目錄（`agents/skills/`），以避免這些「為說明而含 token／路徑樣式」的第三方文件造成整類 false positive。排除前綴 SHALL 只列舉 repo 中實際存在的目錄；同步層移除時其排除前綴 SHALL 一併撤除。結構化 `.json`／`.toml` 掃描（含 `settings.json` 與 repo 內任何 `.toml` 的 hard block 判斷）SHALL NOT 受此排除影響。

#### Scenario: 掃描 Claude 與 Codex 同步來源
- **WHEN** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 檢查 `claude/` 與 `codex/` 下的同步來源內容
- **AND** 系統 SHALL 檢查 `skills-lock.json`

#### Scenario: 掃描 opencode 同步來源
- **WHEN** repo 的 `opencode/` 下含有同步來源（如 `opencode.jsonc`、`AGENTS.md`）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 檢查 `opencode/` 下的同步來源內容
- **AND** 若 opencode 主設定檔內含機密值樣式、私鑰片段或絕對 HOME 路徑，系統 SHALL 依既有規則回報 hard block

#### Scenario: 不掃描測試與規格文件
- **WHEN** `test/` 或 `openspec/` 中含有 token 範例字串
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL NOT 因這些非同步來源範例回報問題

#### Scenario: 外部套件文件不觸發 text pattern hard block
- **WHEN** `agents/skills/` 下的文件含有機密值樣式、私鑰片段或絕對 HOME 路徑（如描述偵測 regex 的說明文字）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL NOT 因這些套件文件的 text pattern 命中回報 hard block

#### Scenario: 設定來源檔仍觸發 text pattern hard block
- **WHEN** 本 repo 維護的設定來源（如 `claude/statusline.sh`、`claude/CLAUDE.md`、`codex/AGENTS.md`、`opencode/AGENTS.md`）含有機密值樣式、私鑰片段或絕對 HOME 路徑
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 排除前綴不留無指涉項
- **WHEN** 某同步層（如 `claude/skills/`）自 `SYNC_MANIFEST` 移除且其 repo 目錄不存在
- **THEN** `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` SHALL NOT 保留該目錄的排除前綴

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

### Requirement: safety check 回報 hard block

系統 SHALL 對明顯高風險內容回報 hard block。hard block 至少包含：已知 token 值樣式、私鑰片段、絕對 HOME 路徑、`claude/settings.json` 內出現 `hooks` 或 credential helper 欄位、以及 repo 內任何 `.toml` 出現機密載體 section（`model_providers.*`、`mcp_servers.*`）。若有任一 hard block，指令 SHALL 以 exit code `2` 結束。

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

#### Scenario: 偵測 repo 內 `.toml` 的機密 section
- **WHEN** repo 內任何 `.toml` 檔含有 `model_providers.*` 或 `mcp_servers.*` section
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 指出 section 路徑但 SHALL NOT 顯示其值
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 偵測絕對 HOME 路徑
- **WHEN** 同步來源含有 `/home/<user>/`、`/Users/<user>/` 或 `C:\Users\<user>\` 形式的絕對 HOME 路徑
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 輸出 SHALL 遮罩完整使用者路徑

### Requirement: safety check 回報人工審核 warning

系統 SHALL 對需人工審核但不應自動阻斷同步的項目回報 warning。warning 至少包含：`claude/settings.json` 中存在 `env` key、key path 命中敏感命名 review pattern 的項目，以及 repo 內任何 `.toml` 出現裝置狀態 section（`profiles.*`、`history`、`shell_environment_policy`）。若沒有 hard block 但有 warning，指令 SHALL 以 exit code `1` 結束。

#### Scenario: env key 需要人工審核
- **WHEN** repo 的 `claude/settings.json` 含有 `env` 物件
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 以 warning 列出 env key 名稱
- **AND** 輸出 SHALL NOT 顯示任何 env 值

#### Scenario: 敏感命名只產生 warning
- **WHEN** 同步來源的結構化設定 key path 命中敏感命名 review pattern（如 `token`、`secret`、`credential`、`password`、`auth`、`session`、`refresh`）
- **AND** 該項目未命中 hard block 條件
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 warning
- **AND** 指令 SHALL NOT 因該命名直接回傳 exit code `2`

### Requirement: safety check 輸出不得洩漏值

系統 SHALL 在 `safety:check` 輸出中顯示分類、檔案路徑、欄位路徑或 key 名稱，但 SHALL NOT 顯示疑似 secret 值、env 值或完整使用者 HOME 路徑。

#### Scenario: hard block 不顯示 secret 值
- **WHEN** `safety:check` 偵測到疑似 secret 值
- **THEN** 輸出 SHALL 指出問題類型與位置
- **AND** 輸出 SHALL NOT 包含該 secret 原始值

#### Scenario: warning 不顯示 env 值
- **WHEN** `safety:check` 回報 env key warning
- **THEN** 輸出 SHALL 顯示 env key 名稱
- **AND** 輸出 SHALL NOT 顯示 env key 對應值

### Requirement: safety check exit code 表達最高嚴重度

系統 SHALL 依檢查結果的最高嚴重度設定 exit code：無問題為 `0`，只有 warning 為 `1`，任一 hard block 為 `2`。

#### Scenario: 無問題時成功
- **WHEN** 同步來源沒有 hard block 或 warning
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 指令 SHALL 以 exit code `0` 結束

#### Scenario: 只有 warning 時回傳 1
- **WHEN** 同步來源只有 warning
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 指令 SHALL 以 exit code `1` 結束

#### Scenario: hard block 優先於 warning
- **WHEN** 同步來源同時含有 warning 與 hard block
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 指令 SHALL 以 exit code `2` 結束

