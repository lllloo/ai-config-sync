## MODIFIED Requirements

### Requirement: settings.json env 欄位同步
同步 `settings.json` 時，`env` 物件內的所有 key 一律參與跨裝置比對與套用，不再有裝置特定例外名單。

#### Scenario: diff 比對不排除任何 env key
- **WHEN** 執行 `npm run diff`
- **THEN** `env` 物件內所有 key 都納入比對，無任何 key 被靜默跳過

#### Scenario: to-local 不保留本機 env 特定 key
- **WHEN** 執行 `npm run to-local`
- **THEN** repo 的 `env` 內容完整覆蓋本機，不保留任何本機獨有 env key

## REMOVED Requirements

### Requirement: DEVICE_ENV_KEYS 裝置特定 env 排除
**Reason**: 唯一使用此機制的 `OBSIDIAN_VAULT_ROOT` 已移除，機制本身成為死碼。
**Migration**: 如未來需要裝置特定 env key，需重新加回 `DEVICE_ENV_KEYS` 機制。
