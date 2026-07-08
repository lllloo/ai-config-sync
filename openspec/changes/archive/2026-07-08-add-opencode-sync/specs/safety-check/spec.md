## MODIFIED Requirements

### Requirement: safety check 掃描同步來源

系統 SHALL 掃描 repo 中會被同步或描述同步狀態的來源，包括 `claude/`、`codex/`、`opencode/` 與 `skills-lock.json`。系統 SHALL NOT 預設掃描 `test/`、`openspec/`、README 或其他純文件，以避免測試資料與範例造成噪音。

機密值／私鑰／絕對 HOME 路徑的 **text pattern 掃描** SHALL 只作用於本 repo 維護的設定同步來源，並 SHALL 排除原樣鏡射的外部套件文件目錄（`claude/agents/`、`claude/skills/`、`codex/agents/`），以避免這些「為說明而含 token／路徑樣式」的第三方文件造成整類 false positive。結構化 `.json`／`.toml` 掃描（含 `settings.json` 與 `codex/config.toml` 的 hard block 判斷）SHALL NOT 受此排除影響。

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
- **WHEN** `claude/agents/`、`claude/skills/` 或 `codex/agents/` 下的文件含有機密值樣式、私鑰片段或絕對 HOME 路徑（如描述偵測 regex 的說明文字）
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL NOT 因這些套件文件的 text pattern 命中回報 hard block

#### Scenario: 設定來源檔仍觸發 text pattern hard block
- **WHEN** 本 repo 維護的設定來源（如 `claude/statusline.sh`、`claude/CLAUDE.md`、`codex/AGENTS.md`、`opencode/AGENTS.md`）含有機密值樣式、私鑰片段或絕對 HOME 路徑
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 回報 hard block
- **AND** 指令 SHALL 以 exit code `2` 結束
