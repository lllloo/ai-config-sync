## Purpose

定義 Claude Code `settings.json` 跨裝置同步的安全邊界。**top-level 採黑名單制**：預設同步，僅排除列於 `DEVICE_SETTINGS_KEYS`（裝置偏好、平台綁定 `hooks`）的 key，strip／preserve 由單一分區同源產出以保證雙向互補。**`env` 無任何黑名單**：所有 env key 一律依一般同步語意處理，唯一結構性動作是「`env` 為空物件時移除該鍵」。

敏感命名 pattern 不再作為同步流程的自動排除條件——命中者照常同步，改由 `npm run safety:check` 以 warning 呈現供人工審核。此為刻意的職責分離：同步流程不宣稱能阻止機密進 repo，該保證由 commit 前的 `safety:check` 與人工審核承擔。這是已承擔的安全邊界弱化（乾淨名 + 乾淨值的機密可能漏網進 repo）。

輸出面則採最強收斂：`diff`／`status` 對 `settings.json` 只輸出項目層級狀態行，不輸出任何設定內容（env 值、env key 名、被排除 key 的值皆不印）。不輸出內容者無需遮罩機制，也就不存在遮罩漏網導致外洩的路徑。
## Requirements
### Requirement: settings.json top-level 欄位採黑名單混合制同步

系統 SHALL 預設同步 `settings.json` 的 top-level key，僅排除列於 `DEVICE_SETTINGS_KEYS` 黑名單的 key。敏感命名 review pattern SHALL NOT 作為同步流程的自動排除條件；命中敏感命名的 key SHALL 依一般可攜欄位同步，並由 `npm run safety:check` 回報 warning 供人工審核。排除判斷 SHALL 由單一分區（partition）實作一次計算產出可攜／裝置兩桶，供 to-repo 剝除、to-local 保留與 diff 判斷共用，確保雙向互補與訊號同源。

#### Scenario: to-repo 同步未列黑名單的 key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `DEVICE_SETTINGS_KEYS` 的 top-level key
- **THEN** repo 的 `claude/settings.json` SHALL 包含該 key

#### Scenario: to-repo 剝除黑名單 key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有列於 `DEVICE_SETTINGS_KEYS` 的 top-level key（如 `model`、`hooks`、`tui`）
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含該 key

#### Scenario: to-repo 不因敏感命名剝除未知 key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `DEVICE_SETTINGS_KEYS` 但命中敏感命名 review pattern 的 top-level key（如 `keyboardLayout` 或 `sessionDefaults`）
- **THEN** repo 的 `claude/settings.json` SHALL 包含該 key

#### Scenario: diff 不忽略敏感命名 key 差異
- **WHEN** 執行 `npm run diff`
- **AND** 本機 `settings.json` 與 repo 只在命中敏感命名 review pattern、但未列於 `DEVICE_SETTINGS_KEYS` 的 top-level key 上不同
- **THEN** 系統 SHALL 將該差異視為一般同步差異

#### Scenario: to-local 僅保留黑名單 key 的本機原值
- **WHEN** 執行 `npm run to-local`
- **AND** 本機 `settings.json` 含有列於 `DEVICE_SETTINGS_KEYS` 的 top-level key
- **THEN** 套用 repo 設定後，系統 SHALL 保留該 key 的本機值

#### Scenario: strip 與 preserve 雙向互補
- **WHEN** 任一 top-level key 經 to-repo 判定為剝除（不進 repo）
- **THEN** 同一 key 於 to-local SHALL 判定為保留本機值（反之亦然），不存在遺失或雙寫的 key

#### Scenario: 既有可攜欄位翻轉後仍可攜（回歸）
- **WHEN** 本機 `settings.json` 含原白名單時代的可攜欄位（`env`、`permissions`、`statusLine`、`enabledPlugins`、`extraKnownMarketplaces`、`language`、`spinnerTipsEnabled`、`theme`、`skipDangerousModePermissionPrompt`、`skipAutoPermissionPrompt`）
- **THEN** 這些欄位 SHALL 全數判定為可攜（不被黑名單排除）

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

### Requirement: 被排除欄位於 diff 預設可見

系統 SHALL 在 `diff`（含 `status`）中僅把明列於 `DEVICE_SETTINGS_KEYS` 的 top-level key 視為被同步排除。命中敏感命名 review pattern 但未列於 `DEVICE_SETTINGS_KEYS` 的 key SHALL NOT 被列為「未同步」項目；其差異 SHALL 依一般 settings 差異處理。`diff` 輸出 SHALL NOT 顯示被排除 key 的值。

#### Scenario: diff 不列出預期的裝置鍵
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機 `settings.json` 與 repo 僅在明列於 `DEVICE_SETTINGS_KEYS` 的 top-level key（如 `model`、`hooks`）上不同
- **THEN** 輸出 SHALL NOT 列出那些 key 名
- **AND** 系統 SHALL NOT 印出「未同步」摘要行

#### Scenario: diff 不把敏感命名當成未同步
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機 `settings.json` 含有命中敏感命名 review pattern 但未明列於 `DEVICE_SETTINGS_KEYS` 的 top-level key（如 `sessionDefaults`）
- **THEN** 輸出 SHALL NOT 將該 key 列為「未同步（敏感護欄排除）」
- **AND** 該 key 的差異 SHALL 依一般 settings 差異判定

#### Scenario: 被排除 key 的值不出現在輸出
- **WHEN** 執行 `npm run diff`（無論是否帶 `--verbose`）
- **THEN** 明列於 `DEVICE_SETTINGS_KEYS` 的被排除 key 的值 SHALL NOT 出現在任何輸出中

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

