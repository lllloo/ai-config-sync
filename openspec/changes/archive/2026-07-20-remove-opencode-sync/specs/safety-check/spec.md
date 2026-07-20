## MODIFIED Requirements

### Requirement: safety check 掃描同步來源

系統 SHALL 掃描 repo 中會被同步或描述同步狀態的來源，包括 `claude/`、`codex/`、`agents/` 與 `skills-lock.json`。系統 SHALL NOT 預設掃描 `test/`、`openspec/`、README 或其他純文件，以避免測試資料與範例造成噪音。

機密值／私鑰／絕對 HOME 路徑的 **text pattern 掃描** SHALL 只作用於本 repo 維護的設定同步來源，並 SHALL 排除原樣鏡射的外部套件文件目錄（`agents/skills/`），以避免這些「為說明而含 token／路徑樣式」的第三方文件造成整類 false positive。排除前綴 SHALL 只列舉 repo 中實際存在的目錄；同步層移除時其排除前綴 SHALL 一併撤除。結構化 `.json`／`.toml` 掃描（含 `settings.json` 與 repo 內任何 `.toml` 的 hard block 判斷）SHALL NOT 受此排除影響。

#### Scenario: 掃描 Claude 與 Codex 同步來源
- **WHEN** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 檢查 `claude/` 與 `codex/` 下的同步來源內容
- **AND** 系統 SHALL 檢查 `skills-lock.json`

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
- **WHEN** 本 repo 維護的設定來源（如 `claude/statusline.sh`、`claude/CLAUDE.md`、`codex/AGENTS.md`）含有機密值樣式、私鑰片段或絕對 HOME 路徑
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束

#### Scenario: 排除前綴不留無指涉項
- **WHEN** 某同步層（如 `claude/skills/`）自 `SYNC_MANIFEST` 移除且其 repo 目錄不存在
- **THEN** `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` SHALL NOT 保留該目錄的排除前綴
