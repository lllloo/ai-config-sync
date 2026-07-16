# sync-write-safety Specification

## Purpose
定義跨模組共用的寫入安全不變式：所有寫入走原子寫入（同目錄暫存檔 + `O_EXCL` + `rename` + `mode 0600`）、暫存檔在所有退出路徑（含訊號）被清理、`SIGINT`／`SIGTERM` 中斷警告與正確 exit code、apply 部分失敗的可見度（`partialChanges`→`warnPartialApply`）、`SyncError`+`formatError` 統一錯誤出口，以及 path 遮罩（`toRelativePath`／`maskHome`）不洩漏使用者目錄。
## Requirements
### Requirement: 所有寫入走原子寫入

系統 SHALL 讓所有寫入路徑（`writeJsonSafe`、`writeTextSafe`、`copyFile`、`mirrorDir`）皆經底層 `writeFileSafe`：先寫同目錄暫存檔（隨機尾碼避免平行撞名、`flag:'wx'`／`O_EXCL` 拒絕跟隨既存 symlink、`mode 0600` 在 rename 前不以預設 umask 暴露），再 `rename` 至目標路徑（同檔系統避免 EXDEV）。此機制 SHALL 提供原子性（避免半截損壞），但不付 fsync 成本、不保證持久性。

#### Scenario: 暫存檔加 O_EXCL 拒絕既存 symlink
- **WHEN** `writeFileSafe` 建立暫存檔
- **THEN** 系統 SHALL 以 `flag:'wx'` 建立，若暫存路徑已存在（含 symlink）SHALL 失敗而非跟隨

#### Scenario: 寫入為先暫存後 rename
- **WHEN** 系統寫入任一設定檔
- **THEN** 系統 SHALL 先寫同目錄暫存檔再 `rename` 至目標，途中失敗 SHALL 刪除暫存檔

### Requirement: 暫存檔在所有退出路徑被清理

系統 SHALL 以 `tempFiles` 登記所有暫存檔，並在正常結束、例外與訊號中斷時清理。`writeFileSafe` 於 `finally` 移除已 rename 的暫存路徑登記；`handleSignal` 於中斷時先 `cleanupTempFiles` 再退出。

#### Scenario: 訊號中斷時清理暫存檔
- **WHEN** 程序在寫入期間收到 `SIGINT`
- **THEN** 系統 SHALL 先清理已登記暫存檔，再以正確 exit code 退出

### Requirement: 中斷訊號給出可見警告並以正確 exit code 退出

系統 SHALL 攔截 `SIGINT`／`SIGTERM`：清理暫存檔後，若中斷發生於寫入期間（`isWriting`）SHALL 印出「同步中斷，部分檔案可能未更新」警告。退出方式 SHALL 在移除自身 handler 後 re-raise signal 讓 OS 設定正確 exit code；Windows 不支援 re-raise 時 SHALL 改用慣例 exit code 130。

#### Scenario: 寫入期間中斷印出警告
- **WHEN** `to-local` 套用中收到 `SIGINT`
- **THEN** 系統 SHALL 印出寫入中斷警告後退出

### Requirement: apply 部分失敗須可見

系統 SHALL 在多項套用中途拋例外時，保留已完成變更的可見度：`mirrorDir` 把已完成變更附掛到 `SyncError.context.partialChanges`，`applySyncItems` 據此補印已寫入項並將整體已套用清單附掛給呼叫端，`warnPartialApply` 印出「已寫入 N 筆變更、其餘未執行」警告（dry-run 不警告）。已寫入的檔案 MUST NOT 零可見度。

#### Scenario: 中途失敗仍列出已寫入項
- **WHEN** `applySyncItems` 套用第 K 項時拋例外
- **THEN** 系統 SHALL 補印該項已完成的部分變更，並警告已寫入筆數與「其餘項目未執行」

### Requirement: 統一錯誤處理，禁裸 console.error 退出

系統 SHALL 以 `SyncError`（`code` + `context`）承載錯誤，所有路徑經檔尾 `.catch(formatError)` 統一輸出，MUST NOT 使用裸 `console.error` + `process.exit`。`formatError` SHALL 依 `code` 附上修復提示；`fs` 例外 SHALL 經 `toSyncFsError` 轉為帶 path context 的 `SyncError`（區分 `PERMISSION` 與 `IO_ERROR`），不讓裸 fs 例外穿透。

#### Scenario: fs 例外轉為 SyncError
- **WHEN** 寫入因權限不足失敗（EACCES/EPERM）
- **THEN** 系統 SHALL 拋 code `PERMISSION` 的 `SyncError`（帶 path context），由 `formatError` 統一輸出並附提示

### Requirement: 錯誤與路徑輸出遮罩使用者目錄

系統 SHALL 在所有面向使用者的路徑輸出遮罩使用者目錄：`toRelativePath` 優先顯示相對 `REPO_ROOT` 的路徑，其次以 `~` 代替 `$HOME`；`SyncError.context.path` 與 verbose 路徑輸出皆走此函式。無結構的原生 `Error.message` SHALL 經 `maskHome` 將 `$HOME`（含 Windows 反斜線與正斜線寫法）替換為 `~`。輸出 MUST NOT 洩漏使用者名稱。

#### Scenario: HOME 路徑以 ~ 顯示
- **WHEN** 錯誤 context 帶有 `$HOME` 底下的絕對路徑
- **THEN** `formatError` SHALL 以 `~/...` 顯示，MUST NOT 輸出完整使用者目錄

