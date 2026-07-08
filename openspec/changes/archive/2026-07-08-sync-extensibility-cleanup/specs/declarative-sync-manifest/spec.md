## MODIFIED Requirements

### Requirement: 同步項目以宣告式 manifest 為單一來源

系統 SHALL 以單一宣告式 manifest（`SYNC_MANIFEST`）作為所有同步項目的定義來源，每列描述一個同步路徑，並由單一 materializer 依同步方向產生 `SyncItem`；area 對應的 base 路徑與顯示前綴 SHALL 由資料表（`SYNC_AREAS`）驅動，而非 imperative 分支。

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
- **AND** 對 `fixedFlow` 為真的項目（如 `settings.json`、`config.toml`）將 `src` 固定為本機端、`dest` 固定為 repo 端，不隨方向交換
- **AND** 對其餘項目依方向交換 `src`/`dest`（`to-repo` 為 home→repo、`to-local` 為 repo→home）

## ADDED Requirements

### Requirement: 指令分派與 COMMANDS 登錄一致

系統 SHALL 確保每個登錄於 `COMMANDS` 的指令都能被指令分派器（`runCommand`）實際分派，不落入未知指令分支；此一致性 SHALL 由測試守護，避免新增指令時漏接分派。

#### Scenario: 每個登錄指令皆可分派

- **WHEN** 測試遍歷 `COMMANDS` 的每個 key
- **THEN** `runCommand` SHALL 能分派該指令而不回報「未知指令」
- **AND** 若新增指令登錄於 `COMMANDS` 卻未接上分派，測試 SHALL 失敗
