## MODIFIED Requirements

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
