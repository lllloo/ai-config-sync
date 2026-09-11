## MODIFIED Requirements

### Requirement: 型別與指令分派維持既有 switch

系統 SHALL 保持同步型別分派（`diffSyncItem`／`applySyncItem`／`buildFullDiffList`）與指令分派（`runCommand`）為既有的明確 `switch` 實作，不引入 handler 查表。型別集合 SHALL 為 `file`／`dir`／`settings`；`mcp`（TOML section 投影）、`advisory`（MCP 諮詢式比對）與 `xtool-dir`（跨工具全域 skill 共管同步）型別 SHALL 皆不存在。

#### Scenario: 型別分派不改行為

- **WHEN** 對含 `file`／`dir`／`settings` 型別的同步項目執行 diff 或 apply
- **THEN** 分派結果 SHALL 與本次變更前相同
- **AND** 系統 SHALL NOT 依賴任何名為 `SYNC_TYPE_HANDLERS` 的查表物件

#### Scenario: advisory 型別不再存在

- **WHEN** 測試檢查 `SYNC_MANIFEST` 與型別分派
- **THEN** SHALL NOT 存在 `type: 'advisory'` 的 manifest 列
- **AND** `diffSyncItem`／`applySyncItem` SHALL NOT 保留 `case 'advisory'`
- **AND** SHALL NOT 存在 `advisoryHandler`／`mcpHandler`／`claudeMcpHandler` 等分派函式

#### Scenario: mcp 型別不再存在

- **WHEN** 測試檢查 `SYNC_MANIFEST` 與型別分派
- **THEN** SHALL NOT 存在 `type: 'mcp'` 的 manifest 列
- **AND** `diffSyncItem`／`applySyncItem` SHALL NOT 保留 `case 'mcp'`

#### Scenario: xtool-dir 型別不再存在

- **WHEN** 測試檢查 `SYNC_MANIFEST`、`SYNC_AREAS` 與型別分派
- **THEN** SHALL NOT 存在 `type: 'xtool-dir'` 的 manifest 列，也 SHALL NOT 存在 `agents` 同步區
- **AND** `diffSyncItem`／`applySyncItem` SHALL NOT 保留 `case 'xtool-dir'`
- **AND** `sync.js` SHALL NOT require `xtool-dir.js`
