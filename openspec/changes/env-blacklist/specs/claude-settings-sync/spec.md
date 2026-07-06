## REMOVED Requirements

### Requirement: settings.json env 欄位另採巢狀白名單同步

**Reason**: `env` 過濾機制由白名單翻轉為黑名單混合制，白名單語意的需求整條被新需求取代。

**Migration**: 見新增需求「settings.json env 欄位採黑名單混合制同步」。原僅同步 `PORTABLE_ENV_KEYS` 列舉 key 的行為，改為預設同步、僅排除 `DEVICE_ENV_KEYS` 與命中 `SENSITIVE_KEY_PATTERN` 的 key。原白名單放行的四鍵（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`、`CLAUDE_CODE_DISABLE_MOUSE`、`CLAUDE_CODE_DISABLE_MOUSE_CLICKS`、`EDITOR`）在新制下因未命中任何排除條件而繼續同步，行為不變。原「diff 不顯示非可攜 env key」的保護，由新增需求「settings.json 明細 diff 不顯示 env 值」以更強形式取代（連同步進 repo 的 env 值也不在 diff 顯示）。

## ADDED Requirements

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

## MODIFIED Requirements

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
