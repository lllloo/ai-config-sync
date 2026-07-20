## MODIFIED Requirements

### Requirement: 同步項目以宣告式 manifest 為單一來源

系統 SHALL 以單一宣告式 manifest（`SYNC_MANIFEST`）作為所有同步項目的定義來源，每列描述一個同步路徑，並由單一 materializer 依同步方向產生 `SyncItem`；area 對應的 base 路徑與顯示前綴 SHALL 由資料表（`SYNC_AREAS`）驅動，而非 imperative 分支。

manifest SHALL 支援 `homeRootFile` 欄位：當本機端目標位於 `$HOME` 下、不在該 area 的 `homeBase` 之內時（如 `~/.claude.json`），以此欄位指定相對於 `$HOME` 的檔名，materializer SHALL 據此解析本機端路徑而不套用 area 的 `homeBase`。

#### Scenario: 新增同步內容只需加一列

- **WHEN** 維護者要新增一個要同步的檔案或目錄
- **THEN** 只需在 `SYNC_MANIFEST` 增加一列（`area`、`label`、`type`，必要時 `fixedFlow`）
- **AND** 不需修改任何 builder 函式或 dispatch `switch`

#### Scenario: 新增工具 area 只需加一筆資料

- **WHEN** 維護者要新增一個工具 area（例如另一個 `~/.<tool>` 目錄）
- **THEN** 只需在 `SYNC_AREAS` 資料表增加一筆（base 路徑與顯示前綴）
- **AND** area 解析 SHALL NOT 依賴針對特定 area 名稱的 imperative 條件分支

#### Scenario: manifest 涵蓋 area 與固定流向規則

- **WHEN** materializer 處理一列 manifest
- **THEN** 系統 SHALL 依 `area` 決定本機端與 repo 端 base 路徑與顯示 `prefix`
- **AND** 對 `fixedFlow` 為真的項目（如 `settings.json`）將 `src` 固定為本機端、`dest` 固定為 repo 端，不隨方向交換
- **AND** 對其餘項目依方向交換 `src`/`dest`（`to-repo` 為 home→repo、`to-local` 為 repo→home）

#### Scenario: homeRootFile 解析 area base 之外的本機路徑

- **WHEN** 一列 manifest 指定 `homeRootFile: '.claude.json'`
- **THEN** materializer SHALL 將本機端路徑解析為 `$HOME/.claude.json`
- **AND** SHALL NOT 將該 area 的 `homeBase` 併入路徑

### Requirement: 型別與指令分派維持既有 switch

系統 SHALL 保持同步型別分派（`diffSyncItem`／`applySyncItem`／`buildFullDiffList`）與指令分派（`runCommand`）為既有的明確 `switch` 實作，不引入 handler 查表。型別集合 SHALL 為 `file`／`dir`／`settings`／`xtool-skills`／`advisory`；`mcp`（TOML section 投影）型別 SHALL 被移除，其職責由 `advisory` 承接。

#### Scenario: 型別分派不改行為

- **WHEN** 對含 `file`／`dir`／`settings`／`xtool-skills` 型別的同步項目執行 diff 或 apply
- **THEN** 分派結果 SHALL 與本次變更前相同
- **AND** 系統 SHALL NOT 依賴任何名為 `SYNC_TYPE_HANDLERS` 的查表物件

#### Scenario: advisory 型別接上分派

- **WHEN** 對 `advisory` 型項目執行 diff 或 apply
- **THEN** `diffSyncItem`／`applySyncItem` 的 `switch` SHALL 有對應 case
- **AND** apply 分派 SHALL 走輸出建議指令的路徑而非寫入路徑

#### Scenario: mcp 型別不再存在

- **WHEN** 測試檢查 `SYNC_MANIFEST` 與型別分派
- **THEN** SHALL NOT 存在 `type: 'mcp'` 的 manifest 列
- **AND** `diffSyncItem`／`applySyncItem` SHALL NOT 保留 `case 'mcp'`
