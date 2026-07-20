## MODIFIED Requirements

### Requirement: safety check 掃描同步來源

系統 SHALL 掃描 repo 中會被同步或描述同步狀態的來源，包括 `claude/`、`codex/`、`opencode/`、`agents/` 與 `skills-lock.json`。系統 SHALL NOT 預設掃描 `test/`、`openspec/`、README 或其他純文件，以避免測試資料與範例造成噪音。

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

#### Scenario: 掃描跨工具 skill 同步來源
- **WHEN** repo 的 `agents/` 下含有同步來源（如 `agents/skills/<name>/SKILL.md`）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 掃描範圍 SHALL 涵蓋 `agents/`
- **AND** 該目錄下的結構化設定檔 SHALL 依既有規則判斷 hard block／warning

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

### Requirement: safety check 回報 hard block

系統 SHALL 對明顯高風險內容回報 hard block。hard block 至少包含：已知 token 值樣式、私鑰片段、絕對 HOME 路徑、`claude/settings.json` 內出現 `hooks` 或 credential helper 欄位、repo 內任何 `.toml` 出現機密載體 section（`model_providers.*`、`mcp_servers.*`），以及 repo 內任何 `.toml` 出現無法解析的 section header。若有任一 hard block，指令 SHALL 以 exit code `2` 結束。

`.toml` 機密載體 section 的比對 SHALL 對 section 名做去引號正規化後判斷：TOML 允許 section 名的各段以引號包裝（如 `["mcp_servers"]`、`['mcp_servers']`、`["mcp_servers".foo]`），這些寫法 SHALL 與未加引號的等價寫法同樣命中 hard block。未做正規化時上述變體會靜默通過（exit 0），故此正規化 SHALL 被視為繞過防線的一部分，MUST NOT 因「看似冗餘」而於重構中移除。

無法解析的 `.toml` section header（以 `[` 起始但不構成合法 header）SHALL 觸發 hard block 並清空當前 section 歸屬。此為 fail-closed：section 名不可信時機密判斷失去依據，SHALL 擋下讓人工檢視，MUST NOT 沿用前一個 section 名或降級為 warning。

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

#### Scenario: 引號包裝的機密 section 同樣命中
- **WHEN** repo 內某 `.toml` 檔的機密載體 section 以引號包裝（如 `["mcp_servers"]`、`['mcp_servers']` 或 `["mcp_servers".foo]`）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 對其做去引號正規化後判定為機密載體 section 並回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束，MUST NOT 因引號寫法而靜默通過

#### Scenario: 無法解析的 section header 觸發 hard block
- **WHEN** repo 內某 `.toml` 檔含有以 `[` 起始但無法解析為合法 header 的行（如未閉合、`[[x]`）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block（分類為無法解析的 TOML section header）
- **AND** 指令 SHALL 以 exit code `2` 結束
- **AND** 該行之後的 key MUST NOT 沿用前一個合法 section 的歸屬

#### Scenario: toml 防線不隨 MCP 同步移除而失效
- **WHEN** 系統已無任何 MCP 同步項目、`mcp.js` 與 `claude-mcp.js` 皆不存在
- **AND** 有人將含 `[mcp_servers.foo]` 的 `.toml` 放進 repo 同步來源
- **THEN** `safety:check` SHALL 仍回報 hard block
- **AND** `toml-reader.js` 與其回歸測試 SHALL 保持存在
