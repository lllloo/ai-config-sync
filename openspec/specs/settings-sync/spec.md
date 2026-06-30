## Purpose

定義 Claude Code `settings.json` 跨裝置同步的安全邊界。只有明確可攜的設定會寫入 repo 或顯示於同步 diff；裝置特定值、平台綁定設定、憑證、API key、token 與未知未審核欄位預設留在本機。

## Requirements

### Requirement: settings.json top-level 欄位採白名單同步

系統 SHALL 只同步列於 `PORTABLE_SETTINGS_KEYS` 的 `settings.json` top-level key。

#### Scenario: to-repo 剝除非可攜 top-level key
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `settings.json` 含有不在 `PORTABLE_SETTINGS_KEYS` 的 top-level key
- **THEN** repo 的 `claude/settings.json` SHALL NOT 包含該 key

#### Scenario: diff 忽略非可攜 top-level key
- **WHEN** 執行 `npm run diff`
- **AND** 本機 `settings.json` 與 repo 只在非 `PORTABLE_SETTINGS_KEYS` 的 top-level key 上不同
- **THEN** 系統 SHALL NOT 將那些 key 回報為同步差異

#### Scenario: to-local 保留本機非可攜 top-level key
- **WHEN** 執行 `npm run to-local`
- **AND** 本機 `settings.json` 含有不在 `PORTABLE_SETTINGS_KEYS` 的 top-level key
- **THEN** 套用 repo 設定後，系統 SHALL 保留該 key 的本機值

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

#### Scenario: 未知新 settings 欄位預設留在本機
- **WHEN** Claude Code 新增新的 `settings.json` key
- **AND** 該 key 尚未被審核並加入 `PORTABLE_SETTINGS_KEYS`
- **THEN** 系統 SHALL 預設將該 key 視為非可攜欄位
