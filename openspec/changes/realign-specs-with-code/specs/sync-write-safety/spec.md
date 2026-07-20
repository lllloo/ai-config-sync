## MODIFIED Requirements

### Requirement: 所有寫入走原子寫入

系統 SHALL 讓所有寫入路徑（`writeJsonSafe`、`copyFile`、`mirrorDir`）皆經底層 `writeFileSafe`：先寫同目錄暫存檔（隨機尾碼避免平行撞名、`flag:'wx'`／`O_EXCL` 拒絕跟隨既存 symlink、`mode 0600` 在 rename 前不以預設 umask 暴露），再 `rename` 至目標路徑（同檔系統避免 EXDEV）。此機制 SHALL 提供原子性（避免半截損壞），但不付 fsync 成本、不保證持久性。

新增任何寫入路徑時 SHALL 經 `writeFileSafe`，MUST NOT 直接呼叫 `fs.writeFileSync`／`fs.writeFile`；此規範列舉的寫入路徑清單 SHALL 與程式碼實際存在的函式一致，MUST NOT 保留已刪除函式的名稱。

#### Scenario: 暫存檔加 O_EXCL 拒絕既存 symlink
- **WHEN** `writeFileSafe` 建立暫存檔
- **THEN** 系統 SHALL 以 `flag:'wx'` 建立，若暫存路徑已存在（含 symlink）SHALL 失敗而非跟隨

#### Scenario: 寫入為先暫存後 rename
- **WHEN** 系統寫入任一設定檔
- **THEN** 系統 SHALL 先寫同目錄暫存檔再 `rename` 至目標，途中失敗 SHALL 刪除暫存檔

#### Scenario: 寫入路徑清單不含已刪除函式
- **WHEN** 檢查本規範列舉的寫入路徑
- **THEN** 每個名稱 SHALL 對應到程式碼中實際存在的函式
- **AND** SHALL NOT 包含 `writeTextSafe`（已隨 MCP 同步移除而刪除）
