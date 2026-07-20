# declarative-sync-manifest Specification

## Purpose
定義同步項目的宣告式定義機制：`SYNC_MANIFEST` 為所有同步路徑的單一來源（一列 = 一路徑），area 的 base 路徑與顯示前綴由 `SYNC_AREAS` 資料表驅動，單一 materializer 依方向產生 `SyncItem`，新增同步內容只需加一列、不需改 builder 或 dispatch。manifest 的可選欄位（`homeLabel`／`homeRootFile`／`fixedFlow`／`variants`／`exclude`）語義須與實作一致。型別分派（`diffSyncItem`／`applySyncItem`／`buildFullDiffList`）與指令分派（`runCommand`）刻意維持明確 `switch`、不引入 handler 查表，換取分派可讀性；型別集合鎖定為 `file`／`dir`／`settings`／`xtool-skills`，`mcp` 與 `advisory` 兩型別的「不得復活」在此作為回歸鎖。另要求專案文件不得引用已不存在的架構元件，並由測試守護 `COMMANDS` 登錄與 `runCommand` 分派的一致性。
## Requirements
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

### Requirement: 指令分派與 COMMANDS 登錄一致

系統 SHALL 確保每個登錄於 `COMMANDS` 的指令都能被指令分派器（`runCommand`）實際分派，不落入未知指令分支；此一致性 SHALL 由測試守護，避免新增指令時漏接分派。

#### Scenario: 每個登錄指令皆可分派

- **WHEN** 測試遍歷 `COMMANDS` 的每個 key
- **THEN** `runCommand` SHALL 能分派該指令而不回報「未知指令」
- **AND** 若新增指令登錄於 `COMMANDS` 卻未接上分派，測試 SHALL 失敗

