## Purpose

定義 Claude Code `settings.json` 跨裝置同步的安全邊界。top-level 欄位與 `env` 內部皆採黑名單混合制：預設同步，僅排除列於黑名單（top-level `DEVICE_SETTINGS_KEYS`／env `DEVICE_ENV_KEYS`）或命中敏感命名 pattern（`SENSITIVE_KEY_PATTERN`）的 key。另以值層防線遞迴掃描收斂結果、明細 diff 對 env 值遮罩，攔截巢狀敏感 key 名與機密樣式值，確保憑證、API key、token 與裝置綁定設定不進入 repo 內容、diff 或一般輸出。env 黑名單為已承擔的安全邊界弱化（乾淨名+乾淨值機密可能漏網進 repo）。

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

### Requirement: settings.json env 欄位採黑名單混合制同步

系統 SHALL 預設同步 `settings.json` 的 `env` key，僅排除下列兩類：列於 `DEVICE_ENV_KEYS` 黑名單的 key（裝置／平台綁定或值即憑證但名稱乾淨的 env，如 `CLAUDE_CODE_USE_POWERSHELL_TOOL`、`ANTHROPIC_CUSTOM_HEADERS`、`HTTP_PROXY`），以及命中 `SENSITIVE_KEY_PATTERN` 的 key。被排除者 SHALL NOT 進入 repo 內容與跨裝置同步；to-local 時 SHALL 保留本機原值。命中排除條件的 env key SHALL 被靜默剝除且 to-repo SHALL 照常完成（不因存在此類 key 而中止）。剝除（to-repo，`stripDeviceEnv`）與保留（to-local，`extractDeviceValues` 的 env 迴圈）為對稱的兩處判斷，SHALL 保證互補。

> 本需求為已知的安全邊界弱化：黑名單無法枚舉機密 key 名，key 名未命中 `SENSITIVE_KEY_PATTERN`、值未命中 `SECRET_VALUE_PATTERN`、且未列入 `DEVICE_ENV_KEYS` 的機密將漏網進入 repo。此風險為刻意承擔，詳見「settings.json 同步不得洩漏敏感值」需求的殘餘限制說明。

#### Scenario: to-repo 同步未列黑名單且未命中 pattern 的 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `DEVICE_ENV_KEYS` 且未命中 `SENSITIVE_KEY_PATTERN` 的 env key（如 `EDITOR`、`CLAUDE_CODE_DISABLE_MOUSE`）
- **THEN** repo 的 `claude/settings.json` SHALL 於 `env` 內包含該 key

#### Scenario: to-repo 靜默剝除列於黑名單的 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有列於 `DEVICE_ENV_KEYS` 的 env key（如 `CLAUDE_CODE_USE_POWERSHELL_TOOL`、`HTTP_PROXY`）
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含該 env key
- **AND** 指令 SHALL 照常完成，SHALL NOT 因該 key 中止

#### Scenario: to-repo 靜默剝除命中敏感 pattern 的 env key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有命中 `SENSITIVE_KEY_PATTERN` 的 env key（如 `ANTHROPIC_API_KEY`、`GITHUB_TOKEN`）
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含該 env key 或其值
- **AND** 指令 SHALL 照常完成，SHALL NOT 因該 key 中止

#### Scenario: env strip 與 preserve 對稱互補
- **WHEN** 任一 env key 經 to-repo 判定為剝除（不進 repo）
- **THEN** 同一 key 於 to-local SHALL 判定為保留本機值（反之亦然），不存在遺失或雙寫的 env key

#### Scenario: env 剝除後為空時省略 env 物件
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 的 `env` 只含被排除的 key
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含空的 `env` 物件

### Requirement: settings.json 明細 diff 不顯示 env 值

因 `env` 改採黑名單後可能同步進 repo 的 env key 含未過濾機密值，系統 SHALL NOT 在 `diff`／`status`（含預設非 `--verbose` 的明細輸出）中顯示任何 env 值。settings.json 的 env 差異 SHALL 僅以 key 層級呈現（哪個 env key 新增／移除／變更），其值 SHALL 被遮罩。差異狀態（有／無差異）的判定 SHALL 以未遮罩內容計算，僅顯示層遮罩。

#### Scenario: diff 不印 env 值
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機與 repo 的 `settings.json` 在某 env key 的值上不同（如 `EDITOR` 或漏網的 `DB_PASS`）
- **THEN** 輸出 SHALL NOT 包含任何 env 值
- **AND** 輸出 MAY 以 key 名指出該 env key 有差異

#### Scenario: env 值不因 --verbose 而顯示
- **WHEN** 執行 `npm run diff --verbose`
- **THEN** 任何 env 值 SHALL NOT 出現在輸出中

### Requirement: 被排除欄位於 diff 預設可見

系統 SHALL 在 `diff`（含 `status`）預設輸出中列出**意料之外**被排除的 top-level key 名稱，作為發現「pattern 誤傷官方欄位」的日常訊號。所謂意料之外，指命中 `SENSITIVE_KEY_PATTERN` 而被排除、但未明列於 `DEVICE_SETTINGS_KEYS` 的 key。明列於 `DEVICE_SETTINGS_KEYS` 的預期裝置鍵（如 `model`、`hooks`、`tui`、`autoUpdatesChannel`）SHALL NOT 出現在此輸出，以消除永久噪音。當過濾後無任何意料之外的排除時，系統 SHALL NOT 印出該行。輸出 SHALL 僅含 key 名，SHALL NOT 包含其值。

#### Scenario: diff 不列出預期的裝置鍵
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機 `settings.json` 與 repo 僅在明列於 `DEVICE_SETTINGS_KEYS` 的 top-level key（如 `model`、`hooks`）上不同
- **THEN** 輸出 SHALL NOT 列出那些 key 名
- **AND** 系統 SHALL NOT 印出「未同步」摘要行

#### Scenario: diff 列出意料之外的 pattern 誤傷 key
- **WHEN** 執行 `npm run diff`（未帶 `--verbose`）
- **AND** 本機 `settings.json` 含有命中 `SENSITIVE_KEY_PATTERN` 但未明列於 `DEVICE_SETTINGS_KEYS` 的 top-level key（如官方新增的 `sessionDefaults`）
- **THEN** 輸出 SHALL 以摘要列出該 key 的名稱

#### Scenario: 被排除 key 的值不出現在輸出
- **WHEN** 執行 `npm run diff`（無論是否帶 `--verbose`）
- **THEN** 被排除 key 的值 SHALL NOT 出現在任何輸出中

### Requirement: 值層防線攔截巢狀敏感內容（direction-aware）

系統 SHALL 在 settings.json 收斂結果進入 repo 內容或 diff 輸出前，遞迴掃描其巢狀內容：巢狀 key 名命中 `SENSITIVE_KEY_PATTERN`（`env` 子樹的 key 掃描除外，其值掃描仍適用）、或字串值命中已知機密樣式（`SECRET_VALUE_PATTERN`，如 `sk-`、`sk_live_`、`ghp_`、`AKIA`、`AIza`、JWT 前綴）或絕對家目錄路徑時觸發。觸發行為依方向而異：to-repo 實際寫入前 SHALL 以錯誤中止操作而非靜默剝除；diff SHALL 將 settings 項目標記為暫不同步並繼續其餘項目的比對（不中止整個指令）；to-local SHALL NOT 因本機內容命中而受阻（該方向不將本機內容寫回 repo）。任何情況下錯誤訊息與 diff 標記 SHALL 指出命中欄位的路徑且 SHALL NOT 顯示該值。

#### Scenario: 巢狀敏感 key 名中止 to-repo
- **WHEN** 執行 `npm run to-repo`
- **AND** 某可攜 top-level 物件欄位的巢狀 key 命中 `SENSITIVE_KEY_PATTERN`（如假想的 `integrations.apiToken`）
- **THEN** 操作 SHALL 中止並回報命中欄位路徑，repo 檔案 SHALL NOT 被寫入

#### Scenario: 機密樣式值中止 to-repo
- **WHEN** 執行 `npm run to-repo`
- **AND** 收斂結果中某字串值命中已知機密前綴或絕對家目錄路徑
- **THEN** 操作 SHALL 中止並回報命中欄位路徑，該值 SHALL NOT 出現在任何輸出

#### Scenario: diff 命中時標記跳過並續行
- **WHEN** 執行 `npm run diff`
- **AND** 本機收斂結果命中值層防線（如 `permissions.additionalDirectories` 含絕對家目錄路徑）
- **THEN** settings 項目 SHALL 標記為值層防線命中（含欄位路徑、不含值、不輸出 settings 內容）
- **AND** 其餘同步項目 SHALL 照常比對並列出，指令以 diff 語義的 exit code 結束（有差異為 1）而非錯誤 2

#### Scenario: to-local 不因本機內容命中而中止
- **WHEN** 執行 `npm run to-local`（含 `--dry-run`）
- **AND** 本機 settings.json 的可攜欄位含絕對家目錄路徑或機密樣式值
- **THEN** 指令 SHALL 照常預覽與套用（repo 內容覆寫本機可攜欄位、本機保留欄位不動），SHALL NOT 中止

### Requirement: settings.json 同步不得洩漏敏感值

系統 SHALL 防止敏感值或裝置綁定設定進入 repo 內容、同步 diff 或一般指令輸出。對 `env` 而言，防線由四層構成：`DEVICE_ENV_KEYS` 黑名單、`SENSITIVE_KEY_PATTERN` key 名剝除、`SECRET_VALUE_PATTERN` 值層掃描（恆常適用於 env 值）、以及明細 diff 對 env 值的顯示遮罩。系統 SHALL NOT 宣稱此組合等同白名單的結構保證：key 名未命中 `SENSITIVE_KEY_PATTERN`、值未命中 `SECRET_VALUE_PATTERN`、且未列入 `DEVICE_ENV_KEYS` 的機密屬已知且被接受的漏網限制，該類值可能經 to-repo 進入 repo 內容（但不會出現在 diff 輸出）。

#### Scenario: 名字或值含敏感樣式的 env key 不寫入 repo
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 的 env key 名命中 `SENSITIVE_KEY_PATTERN`（如 `ANTHROPIC_API_KEY`）或其值命中 `SECRET_VALUE_PATTERN`（如某乾淨名 key 的值為 `sk-…`）
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含那些 key 或值

#### Scenario: 未知憑證類 top-level 欄位不外洩
- **WHEN** Claude Code 新增命名含 key／token／secret／credential／password／auth／cert／cookie／session／jwt／helper／refresh（不分大小寫）的 `settings.json` top-level 欄位
- **AND** 該欄位尚未被列入 `DEVICE_SETTINGS_KEYS`
- **THEN** 系統 SHALL 因 `SENSITIVE_KEY_PATTERN` 命中而將該欄位排除於 repo 內容與 diff 差異之外

#### Scenario: 系統不宣稱攔截乾淨名且乾淨值的 env 機密（已知限制）
- **WHEN** 本機 `settings.json` 的 env 含 key 名未命中 `SENSITIVE_KEY_PATTERN`、值未命中 `SECRET_VALUE_PATTERN`、且未列入 `DEVICE_ENV_KEYS` 的機密（如 `DB_PASS=hunter2`）
- **THEN** 系統 SHALL NOT 宣稱能攔截此類機密（該值屬已接受的漏網限制，可能經 to-repo 進入 repo）
- **AND** 該值 SHALL NOT 出現在 `diff`／`status` 的任何輸出中（由「明細 diff 不顯示 env 值」需求保證）
