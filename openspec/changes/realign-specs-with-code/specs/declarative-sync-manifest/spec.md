## MODIFIED Requirements

### Requirement: 同步項目以宣告式 manifest 為單一來源

系統 SHALL 以單一宣告式 manifest（`SYNC_MANIFEST`）作為所有同步項目的定義來源，每列描述一個同步路徑，並由單一 materializer 依同步方向產生 `SyncItem`；area 對應的 base 路徑與顯示前綴 SHALL 由資料表（`SYNC_AREAS`）驅動，而非 imperative 分支。

manifest SHALL 支援下列可選欄位，其語義 SHALL 與程式碼實作一致：

- `homeLabel`：本機端檔名不同於 repo `label` 時，指定本機端使用的檔名
- `homeRootFile`：本機端目標位於 `$HOME` 下、不在該 area 的 `homeBase` 之內時，指定相對於 `$HOME` 的檔名，materializer SHALL 據此解析本機端路徑而不套用 area 的 `homeBase`
- `fixedFlow`：`src`／`dest` 固定不隨方向交換
- `variants`：同一同步項目存在多種副檔名寫法時（如 opencode 主設定的 `.jsonc`／`.json`），由此欄位解析出兩端一致的 canonical label，避免同一設定在 repo 與本機各自產生重複檔
- `exclude`：目錄型項目中不納入同步的路徑樣式

`homeLabel` 與 `homeRootFile` 目前皆無 manifest 使用者，SHALL 保留為 materializer 的通用能力並各以合成 entry 維持測試覆蓋。`variants` SHALL 有實際 manifest 使用者。

#### Scenario: 新增同步內容只需加一列

- **WHEN** 維護者要新增一個要同步的檔案或目錄
- **THEN** 只需在 `SYNC_MANIFEST` 增加一列（必填 `area`、`label`、`type`，視需要加上 `homeLabel`／`homeRootFile`／`fixedFlow`／`variants`／`exclude`）
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

- **WHEN** 一列 manifest 指定 `homeRootFile: '.root-level.json'`
- **THEN** materializer SHALL 將本機端路徑解析為 `$HOME/.root-level.json`
- **AND** SHALL NOT 將該 area 的 `homeBase` 併入路徑

#### Scenario: variants 解析出兩端一致的 canonical label

- **WHEN** 一列 manifest 以 `variants` 列出同一設定的多種副檔名寫法（如 `opencode.jsonc`／`opencode.json`）
- **THEN** materializer SHALL 解析出單一 canonical label 同時套用於 repo 端與本機端
- **AND** SHALL NOT 因兩端使用不同副檔名而產生重複的同步項目
