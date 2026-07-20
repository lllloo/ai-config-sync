## MODIFIED Requirements

### Requirement: 同步項目 materialize 行為與重構前等價

系統 SHALL 在導入 manifest 後，使 `buildSyncItems` 對 `to-repo` 與 `to-local` 兩方向產生的同步項目集合，與重構前逐項等價（項目順序、`label`、`src`、`dest`、`type` 及顯示 `prefix` 皆不變）。

#### Scenario: to-repo 產出等價

- **WHEN** 呼叫 `buildSyncItems('to-repo')`
- **THEN** 產出的每個項目其 `label`、`src`、`dest`、`type` 與顯示 `prefix` SHALL 與重構前相同
- **AND** 項目順序 SHALL 不變

#### Scenario: to-local 產出等價

- **WHEN** 呼叫 `buildSyncItems('to-local')`
- **THEN** 產出的每個項目其 `label`、`src`、`dest`、`type` 與顯示 `prefix` SHALL 與重構前相同
- **AND** 固定流向項目（僅 `settings.json`）的 `src`/`dest` SHALL 不因方向而交換

#### Scenario: manifest 不含 MCP 列

- **WHEN** 測試檢查 `SYNC_MANIFEST`
- **THEN** SHALL NOT 存在 `label` 為 `mcp.json` 的列
- **AND** SHALL NOT 存在使用 `homeRootFile: '.claude.json'` 的列

### Requirement: 型別與指令分派維持既有 switch

系統 SHALL 保持同步型別分派（`diffSyncItem`／`applySyncItem`／`buildFullDiffList`）與指令分派（`runCommand`）為既有的明確 `switch` 實作，不引入 handler 查表。型別集合 SHALL 為 `file`／`dir`／`settings`／`xtool-skills`；`mcp`（TOML section 投影）與 `advisory`（MCP 諮詢式比對）型別 SHALL 皆不存在。

#### Scenario: 型別分派不改行為

- **WHEN** 對含 `file`／`dir`／`settings`／`xtool-skills` 型別的同步項目執行 diff 或 apply
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

### Requirement: 文件與程式碼架構描述一致

系統的專案文件 SHALL 準確描述實際的分派與擴充機制，不得引用已不存在的架構元件。

#### Scenario: 文件不引用不存在的元件

- **WHEN** 讀者查閱 `CLAUDE.md` 的架構重點與同步項目表
- **THEN** 文件 SHALL NOT 出現 `SYNC_TYPE_HANDLERS` 或 `COMMANDS[cmd].handler` 等不存在於程式碼的描述
- **AND** 文件 SHALL NOT 描述 `advisory` 型別、`mcp.js`／`claude-mcp.js` 模組或 MCP 同步項目
- **AND** 文件 SHALL 指明「新增同步內容只需在 `SYNC_MANIFEST` 加一列」
- **AND** 文件 SHALL 據實描述指令與型別分派為明確 `switch`
