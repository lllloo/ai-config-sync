## MODIFIED Requirements

### Requirement: settings.json env 欄位採黑名單混合制同步

系統 SHALL 預設同步 `settings.json` 的 `env` key。`env` key SHALL NOT 因命中敏感命名 review pattern 而於同步流程中自動剝除；其人工審核 SHALL 由 `npm run safety:check` 以 warning 呈現。to-local 套用時，repo 的 env 可攜值 SHALL 依一般同步語意寫入本機；同步流程 SHALL NOT 嘗試保留 env 內的裝置特定或敏感命名 key。

`env` 區塊 SHALL NOT 存在任何黑名單常數：同步流程對 env 的唯一結構性處理為「`env` 為空物件時移除該鍵」，除此之外所有 env key 一律依一般同步語意處理。此規範 MUST NOT 指涉 `DEVICE_ENV_KEYS` 或任何等價的 env 排除清單——該常數已不存在於程式碼中，援引它會使規範的前置條件不可判定。

#### Scenario: to-repo 同步 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有 env key（如 `EDITOR`、`CLAUDE_CODE_DISABLE_MOUSE`、`ANTHROPIC_API_KEY`）
- **THEN** repo 的 `claude/settings.json` SHALL 於 `env` 內包含該 key

#### Scenario: to-repo 不靜默剝除裝置特定 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有裝置特定或平台綁定的 env key（如 `CLAUDE_CODE_USE_POWERSHELL_TOOL`、`HTTP_PROXY`）
- **THEN** repo 的 `claude/settings.json` SHALL 於 `env` 內包含該 key
- **AND** 指令 SHALL 照常完成，SHALL NOT 因該 key 中止

#### Scenario: to-repo 不靜默剝除敏感命名 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有命中敏感命名 review pattern 的 env key（如 `ANTHROPIC_API_KEY`、`GITHUB_TOKEN`）
- **THEN** repo 的 `claude/settings.json` SHALL 於 `env` 內包含該 key
- **AND** 指令 SHALL 照常完成，SHALL NOT 因該 key 中止

#### Scenario: 不存在 env 黑名單常數
- **WHEN** 檢查同步流程對 `env` 的處理
- **THEN** SHALL NOT 存在 `DEVICE_ENV_KEYS` 或任何等價的 env 排除清單
- **AND** env 的唯一結構性處理 SHALL 為「空物件時移除該鍵」

#### Scenario: env 由 safety check 人工審核
- **WHEN** repo 的 `claude/settings.json` 含有 env key
- **AND** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 以 warning 列出 env key 名稱並遮罩值

### Requirement: diff 與 status 不輸出任何設定內容

系統 SHALL 在 `diff`／`status`（無論是否帶 `--verbose`）中，對 `settings.json` 僅輸出項目層級的狀態行（有差異／無差異／新增），MUST NOT 輸出任何設定內容——包含 env 值、env key 名稱、被排除 key 的值，以及任何 top-level key 的值。

此為刻意的安全取捨而非未完成的功能：不輸出內容者無需遮罩機制，也就不存在遮罩漏網導致機密外洩的路徑。差異狀態（有／無差異）的判定 SHALL 以完整未處理內容計算，僅輸出層收斂為狀態行。

本規範 SHALL NOT 要求 env 差異以 key 層級呈現或值遮罩：該機制從未建造，且與「不輸出設定內容」的設計方向相反。若日後確有診斷需求，SHALL 作為獨立提案重新評估其安全代價。

#### Scenario: diff 不印 env 值
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機與 repo 的 `settings.json` 在某 env key 的值上不同（如 `EDITOR` 或 `DB_PASS`）
- **THEN** 輸出 SHALL 僅包含該同步項目的狀態行
- **AND** 輸出 MUST NOT 包含任何 env 值或 env key 名稱

#### Scenario: env 值不因 --verbose 而顯示
- **WHEN** 執行 `npm run diff --verbose`
- **THEN** 任何 env 值 SHALL NOT 出現在輸出中

#### Scenario: 不輸出設定內容因而無需遮罩機制
- **WHEN** 檢查 `diff`／`status` 對 `settings.json` 的輸出實作
- **THEN** 系統 SHALL 只回報整檔層級的差異狀態
- **AND** SHALL NOT 存在針對 settings 值的遮罩函式，因無任何值進入輸出層

## RENAMED Requirements

- FROM: `### Requirement: settings.json 明細 diff 不顯示 env 值`
- TO: `### Requirement: diff 與 status 不輸出任何設定內容`
