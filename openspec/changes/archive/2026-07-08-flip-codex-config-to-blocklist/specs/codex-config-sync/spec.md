## ADDED Requirements

### Requirement: config.toml section 採黑名單混合制同步

系統 SHALL 預設同步 `config.toml` 的各 section，僅排除 section 名等於 section 黑名單項或以「`<黑名單項>.`」為前綴者。section 黑名單至少包含 `model_providers`、`mcp_servers`、`projects`、`profiles`、`history`、`shell_environment_policy`、`tui.model_availability_nux`。被排除的 section SHALL 整段（含其所有 key）不進入 repo。未列於黑名單、亦非 carve-out 特例的 section／key SHALL 依一般同步語意同步（含 Codex 未來新增的 section／key）。

#### Scenario: to-repo 同步未列黑名單的 section
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `config.toml` 含有不在 section 黑名單的 section（如 `features`、`memories`）
- **THEN** repo 的 `codex/config.toml` SHALL 包含該 section 及其 key

#### Scenario: to-repo 整段排除機密／裝置 section
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `config.toml` 含有列於 section 黑名單的 section（如 `model_providers.openai`、`mcp_servers.foo`、`projects."/home/user/x"`、`tui.model_availability_nux`）
- **THEN** repo 的 `codex/config.toml` SHALL NOT 包含該 section 或其任何 key

#### Scenario: 未知新 section 預設同步
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `config.toml` 含有一個不在黑名單、非 carve-out 的新 section（如 Codex 新增的 `[some_new_feature]`）
- **THEN** repo 的 `codex/config.toml` SHALL 包含該 section

#### Scenario: to-local 保留本機被排除 section
- **WHEN** 執行 `npm run to-local`
- **AND** 本機 `config.toml` 含有列於 section 黑名單的 section（如 `model_providers.*`、`projects.*`）
- **THEN** 套用 repo 設定後，系統 SHALL 保留該 section 的本機內容不受影響

### Requirement: plugins section 維持 enabled-only carve-out

系統 SHALL 對 `plugins.*` section 僅同步 `enabled` key，不同步該 section 內其他 key。此為「開放 key 空間」的精確 carve-out（plugin 名為半開放集合、plugin section 可能載有憑證或本機路徑），SHALL NOT 因整體 section 黑名單制而整段同步。

#### Scenario: plugins 只同步 enabled
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `config.toml` 的 `[plugins."x@y"]` 含 `enabled` 與其他 key（如假想的 `api_key` 或 `path`）
- **THEN** repo 的 `codex/config.toml` 的該 plugins section SHALL 只包含 `enabled`
- **AND** SHALL NOT 包含該 section 的其他 key

### Requirement: top-level 維持窄允許清單 carve-out

系統 SHALL 對 `config.toml` 的 top-level key 僅同步允許清單列舉者（至少 `personality`、`web_search`），其餘 top-level key SHALL NOT 同步。此為缺乏 Codex top-level 權威 schema 下的刻意 interim carve-out，SHALL NOT 因整體 section 黑名單制而反轉為預設同步。

#### Scenario: top-level 只同步允許清單
- **WHEN** 執行 `npm run to-repo`
- **AND** 本機 `config.toml` 含 top-level `personality`、`web_search` 與裝置 key（如 `model`、`approval_policy`）
- **THEN** repo 的 `codex/config.toml` SHALL 包含 `personality` 與 `web_search`
- **AND** SHALL NOT 包含 `model` 或 `approval_policy`
