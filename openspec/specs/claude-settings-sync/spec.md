## Purpose

定義 Claude Code `settings.json` 跨裝置同步的安全邊界。top-level 欄位採黑名單混合制：預設同步，僅排除列於 `DEVICE_SETTINGS_KEYS` 黑名單或命中敏感命名 pattern（`SENSITIVE_KEY_PATTERN`）的 key；`env` 內部維持巢狀白名單（`PORTABLE_ENV_KEYS`）。另以值層防線遞迴掃描收斂結果，攔截巢狀敏感 key 名與機密樣式值，確保憑證、API key、token 與裝置綁定設定不進入 repo 內容、diff 或一般輸出。

## Requirements

### Requirement: settings.json top-level 欄位採黑名單混合制同步

系統 SHALL 預設同步 `settings.json` 的 top-level key，僅排除下列兩類：列於 `DEVICE_SETTINGS_KEYS` 黑名單的 key，以及命中敏感命名 pattern `SENSITIVE_KEY_PATTERN`（`/(key|token|secret|credential|password|auth|cert|cookie|session|jwt|helper|refresh)/i`）的 key。排除判斷 SHALL 由單一分區（partition）實作一次計算產出可攜／裝置兩桶，供 to-repo 剝除、to-local 保留與 diff dropped 清單三個消費端共用，確保雙向互補與訊號同源。`env` 巢狀白名單（`PORTABLE_ENV_KEYS`）不受本需求影響，維持既有白名單行為。

#### Scenario: to-repo 同步未列黑名單且未命中 pattern 的 key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `DEVICE_SETTINGS_KEYS` 且未命中 `SENSITIVE_KEY_PATTERN` 的 top-level key
- **THEN** repo 的 `claude/settings.json` SHALL 包含該 key

#### Scenario: to-repo 剝除黑名單 key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有列於 `DEVICE_SETTINGS_KEYS` 的 top-level key（如 `model`、`hooks`、`apiKeyHelper`）
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含該 key

#### Scenario: to-repo 剝除命中敏感 pattern 的未知 key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `DEVICE_SETTINGS_KEYS` 但命中 `SENSITIVE_KEY_PATTERN` 的 top-level key（如假想的 `newAuthTokenHelper`）
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含該 key

#### Scenario: diff 忽略被排除的 top-level key 差異
- **WHEN** 執行 `npm run diff`
- **AND** 本機 `settings.json` 與 repo 只在被排除（黑名單或 pattern 命中）的 top-level key 上不同
- **THEN** 系統 SHALL NOT 將那些 key 回報為同步差異

#### Scenario: to-local 保留本機被排除 key 的原值
- **WHEN** 執行 `npm run to-local`
- **AND** 本機 `settings.json` 含有被排除（黑名單或 pattern 命中）的 top-level key
- **THEN** 套用 repo 設定後，系統 SHALL 保留該 key 的本機值

#### Scenario: strip 與 preserve 雙向互補
- **WHEN** 任一 top-level key 經 to-repo 判定為剝除（不進 repo）
- **THEN** 同一 key 於 to-local SHALL 判定為保留本機值（反之亦然），不存在遺失或雙寫的 key

#### Scenario: 既有可攜欄位翻轉後仍可攜（回歸）
- **WHEN** 本機 `settings.json` 含原白名單時代的可攜欄位（`env`、`permissions`、`statusLine`、`enabledPlugins`、`extraKnownMarketplaces`、`language`、`spinnerTipsEnabled`、`theme`、`skipDangerousModePermissionPrompt`、`skipAutoPermissionPrompt`）
- **THEN** 這些欄位 SHALL 全數判定為可攜（不被黑名單或 pattern 誤傷）

### Requirement: settings.json env 欄位另採巢狀白名單同步

系統 SHALL 只在套用 `PORTABLE_ENV_KEYS` 巢狀白名單後同步 `env`。只有列於 `PORTABLE_ENV_KEYS` 的 env key 會進入 repo 內容、diff 輸出與跨裝置同步。

#### Scenario: to-repo 剝除非可攜 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `PORTABLE_ENV_KEYS` 的 env key
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含那些 env key

#### Scenario: diff 不顯示非可攜 env key
- **WHEN** 執行 `npm run diff`
- **AND** 本機 `settings.json` 含有不在 `PORTABLE_ENV_KEYS` 的 env key
- **THEN** diff 輸出 SHALL NOT 包含那些 env key 或其值

#### Scenario: to-local 保留本機非可攜 env key
- **WHEN** 執行 `npm run to-local`
- **AND** 本機 `settings.json` 含有不在 `PORTABLE_ENV_KEYS` 的 env key
- **THEN** 套用 repo 設定後，系統 SHALL 保留那些本機 env key

#### Scenario: env 剝除後為空時省略 env 物件
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 的 `env` 只含有不在 `PORTABLE_ENV_KEYS` 的 key
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含空的 `env` 物件

### Requirement: 被排除欄位於 diff 預設可見

系統 SHALL 在 `diff`（含 `status`）預設輸出中列出被排除的 top-level key 名稱，作為黑名單制下發現「該排除而未排除」與「pattern 誤傷」的日常訊號。輸出 SHALL 僅含 key 名，SHALL NOT 包含其值。

#### Scenario: diff 預設列出被排除 key 名
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機 `settings.json` 含有被排除（黑名單或 pattern 命中）的 top-level key
- **THEN** 輸出 SHALL 以摘要列出那些 key 的名稱

#### Scenario: 被排除 key 的值不出現在輸出
- **WHEN** 執行 `npm run diff`（無論是否帶 `--verbose`）
- **THEN** 被排除 key 的值 SHALL NOT 出現在任何輸出中

### Requirement: to-repo 值層防線攔截巢狀敏感內容

系統 SHALL 在 settings.json 收斂結果進入 repo 內容或 diff 輸出前，遞迴掃描其巢狀內容：巢狀 key 名命中 `SENSITIVE_KEY_PATTERN`（`env` 子樹的 key 掃描除外，其值掃描仍適用）、或字串值命中已知機密樣式（如 `sk-`、`ghp_`、`AKIA`、JWT 前綴）或絕對家目錄路徑時，SHALL 以錯誤中止操作而非靜默剝除；錯誤訊息 SHALL 指出命中欄位的路徑且 SHALL NOT 顯示該值。

#### Scenario: 巢狀敏感 key 名中止同步
- **WHEN** 執行 `npm run to-repo` 或 `npm run diff`
- **AND** 某可攜 top-level 物件欄位的巢狀 key 命中 `SENSITIVE_KEY_PATTERN`（如假想的 `integrations.apiToken`）
- **THEN** 操作 SHALL 中止並回報命中欄位路徑，repo 檔案 SHALL NOT 被寫入

#### Scenario: 機密樣式值中止同步
- **WHEN** 執行 `npm run to-repo` 或 `npm run diff`
- **AND** 收斂結果中某字串值命中已知機密前綴或絕對家目錄路徑
- **THEN** 操作 SHALL 中止並回報命中欄位路徑，該值 SHALL NOT 出現在任何輸出

### Requirement: settings.json 同步不得洩漏敏感值

系統 SHALL 防止敏感值或裝置綁定設定進入 repo 內容、同步 diff 或一般指令輸出。

#### Scenario: API key 與 token 不寫入 repo
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 在非可攜 env key 內含 API key 或 token 值
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含那些 key 或值

#### Scenario: API key 與 token 不出現在 diff
- **WHEN** 執行 `npm run diff`
- **AND** 本機 `settings.json` 在非可攜 env key 內含 API key 或 token 值
- **THEN** diff 輸出 SHALL NOT 包含那些 key 或值

#### Scenario: 未知憑證類 top-level 欄位不外洩
- **WHEN** Claude Code 新增命名含 key／token／secret／credential／password／auth／cert／cookie／session／jwt／helper／refresh（不分大小寫）的 `settings.json` top-level 欄位
- **AND** 該欄位尚未被列入 `DEVICE_SETTINGS_KEYS`
- **THEN** 系統 SHALL 因 `SENSITIVE_KEY_PATTERN` 命中而將該欄位排除於 repo 內容與 diff 差異之外
