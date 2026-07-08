## ADDED Requirements

### Requirement: 同步項目以宣告式 manifest 為單一來源

系統 SHALL 以單一宣告式 manifest（`SYNC_MANIFEST`）作為所有同步項目的定義來源，每列描述一個同步路徑，並由單一 materializer 依同步方向產生 `SyncItem`。

#### Scenario: 新增同步內容只需加一列

- **WHEN** 維護者要新增一個要同步的檔案或目錄
- **THEN** 只需在 `SYNC_MANIFEST` 增加一列（`area`、`label`、`type`，必要時 `fixedFlow`）
- **AND** 不需修改任何 builder 函式或 dispatch `switch`

#### Scenario: manifest 涵蓋 area 與固定流向規則

- **WHEN** materializer 處理一列 manifest
- **THEN** 系統 SHALL 依 `area` 決定本機端與 repo 端 base 路徑與顯示 `prefix`
- **AND** 對 `fixedFlow` 為真的項目（如 `settings.json`、`config.toml`）將 `src` 固定為本機端、`dest` 固定為 repo 端，不隨方向交換
- **AND** 對其餘項目依方向交換 `src`/`dest`（`to-repo` 為 home→repo、`to-local` 為 repo→home）

### Requirement: 同步項目 materialize 行為與重構前等價

系統 SHALL 在導入 manifest 後，使 `buildSyncItems` 對 `to-repo` 與 `to-local` 兩方向產生的同步項目集合，與重構前逐項等價（項目順序、`label`、`src`、`dest`、`type` 及顯示 `prefix` 皆不變）。

#### Scenario: to-repo 產出等價

- **WHEN** 呼叫 `buildSyncItems('to-repo')`
- **THEN** 產出的每個項目其 `label`、`src`、`dest`、`type` 與顯示 `prefix` SHALL 與重構前相同
- **AND** 項目順序 SHALL 不變

#### Scenario: to-local 產出等價

- **WHEN** 呼叫 `buildSyncItems('to-local')`
- **THEN** 產出的每個項目其 `label`、`src`、`dest`、`type` 與顯示 `prefix` SHALL 與重構前相同
- **AND** 固定流向項目（`settings.json`、`config.toml`）的 `src`/`dest` SHALL 不因方向而交換

### Requirement: 型別與指令分派維持既有 switch

系統 SHALL 保持同步型別分派（`diffSyncItem`／`applySyncItem`／`buildFullDiffList`）與指令分派（`runCommand`）為既有的明確 `switch` 實作，本次不引入 handler 查表。

#### Scenario: 型別分派不改行為

- **WHEN** 對含 `file`／`dir`／`settings`／`codex-config` 型別的同步項目執行 diff 或 apply
- **THEN** 分派結果 SHALL 與重構前相同
- **AND** 系統 SHALL NOT 依賴任何名為 `SYNC_TYPE_HANDLERS` 的查表物件

### Requirement: 文件與程式碼架構描述一致

系統的專案文件 SHALL 準確描述實際的分派與擴充機制，不得引用已不存在的架構元件。

#### Scenario: 文件不引用不存在的元件

- **WHEN** 讀者查閱 `CLAUDE.md` 的架構重點與 codex-config 段落
- **THEN** 文件 SHALL NOT 出現 `SYNC_TYPE_HANDLERS` 或 `COMMANDS[cmd].handler` 等不存在於程式碼的描述
- **AND** 文件 SHALL 指明「新增同步內容只需在 `SYNC_MANIFEST` 加一列」
- **AND** 文件 SHALL 據實描述指令與型別分派為明確 `switch`
