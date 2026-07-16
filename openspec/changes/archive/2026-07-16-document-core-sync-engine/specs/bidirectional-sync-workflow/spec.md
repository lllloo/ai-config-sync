## ADDED Requirements

### Requirement: diff 為唯讀比較，有差異回 EXIT_DIFF

系統 SHALL 提供 `diff` 指令，純比較本機與 repo 的同步項目並輸出狀態行，MUST NOT 寫入任何檔案或產生暫存檔。無差異時 SHALL 以 `EXIT_OK` 退出並顯示「完全一致」；有任一差異時 SHALL 以 `EXIT_DIFF` 退出並提示下一步 `npm run to-repo`。

#### Scenario: 無差異回 EXIT_OK
- **WHEN** 使用者執行 `node sync.js diff` 且本機與 repo 完全一致
- **THEN** 系統 SHALL 輸出「本機與 repo 完全一致」並以 `EXIT_OK` 退出

#### Scenario: 有差異回 EXIT_DIFF 且不寫入
- **WHEN** 使用者執行 `node sync.js diff` 且存在差異
- **THEN** 系統 SHALL 列出差異狀態行、以 `EXIT_DIFF` 退出，且 MUST NOT 寫入任何檔案

### Requirement: status 為 diff 與 skills:diff 合流

系統 SHALL 提供 `status` 指令，依序執行設定 `diff` 與 `skills:diff`，讓使用者一次看到設定與 skills 兩類差異。任一類偵測到差異時 SHALL 回傳 `EXIT_DIFF`。

#### Scenario: 任一類有差異即回 EXIT_DIFF
- **WHEN** 使用者執行 `node sync.js status`
- **AND** 設定或 skills 任一存在差異
- **THEN** 系統 SHALL 以 `EXIT_DIFF` 退出

### Requirement: to-repo 前置檢查 git 並於完成後顯示 git 狀態

系統 SHALL 在非 dry-run 的 `to-repo` 執行前檢查：若 git 可用但目前不在 git repository 內，SHALL 拋 `SyncError`（code `GIT_ERROR`）中止。成功套用後 SHALL 呼叫 `showGitStatus` 顯示 `git status --short` 與 `git diff --stat`，並提示 commit 前先執行 `safety:check`。git 不可用或不在 repo 內時，`showGitStatus` SHALL 只跳過顯示而不報錯。

#### Scenario: 不在 git repo 內時 to-repo 中止
- **WHEN** 使用者於非 git 目錄執行 `node sync.js to-repo`（非 dry-run，且 git 可用）
- **THEN** 系統 SHALL 拋 `GIT_ERROR` 並中止，MUST NOT 寫入 repo

#### Scenario: 完成後顯示 git 變動與安全提示
- **WHEN** `to-repo` 成功套用變更
- **THEN** 系統 SHALL 顯示 git 變動摘要並提示先跑 `npm run safety:check`

### Requirement: to-local 採預覽後確認的閘門

系統 SHALL 在 `to-local` 實際套用前先計算並顯示預覽（將新增／更新／刪除／撞名跳過／本機保留），再經 `askConfirm` 詢問使用者確認。使用者未回答 `y`／`yes` 時 SHALL 取消且不套用。無差異時 SHALL 直接回報「完全一致，無需套用」並以 `EXIT_OK` 退出。

#### Scenario: 使用者拒絕則不套用
- **WHEN** 使用者執行 `node sync.js to-local` 且在確認提示回答非 y
- **THEN** 系統 SHALL 輸出「已取消」並以 `EXIT_OK` 退出，MUST NOT 寫入本機

#### Scenario: 無差異直接結束
- **WHEN** 本機與 repo 完全一致
- **THEN** 系統 SHALL 輸出「無需套用」並以 `EXIT_OK` 退出，不進入確認流程

### Requirement: 非互動環境拒絕等待確認

系統 SHALL 在 `askConfirm` 偵測 `process.stdin` 非 TTY（CI／pipe／`/dev/null`）且未指定 `--yes`／`--force` 時，以 `SyncError`（`INVALID_ARGS`）拒絕，MUST NOT 無限等待或在 EOF 下靜默 `EXIT_OK` 什麼都沒做。指定 `--yes`／`--force` 時 SHALL 直接視為同意，不提問。

#### Scenario: 非互動環境未加 --yes 時拒絕
- **WHEN** 於非 TTY 環境執行 `node sync.js to-local` 且未加 `--yes`
- **THEN** 系統 SHALL 拋 `INVALID_ARGS`，提示改用 `--dry-run` 預覽或加 `--yes`

#### Scenario: --yes 略過提問
- **WHEN** 執行 `node sync.js to-local --yes`
- **THEN** `askConfirm` SHALL 直接回傳同意，不顯示提示

### Requirement: dry-run 絕不寫入且內容相同即不寫入

系統 SHALL 在任何指令加 `--dry-run` 時只計算與輸出預覽，MUST NOT 寫入任何檔案或產生暫存檔。非 dry-run 套用時，SHALL 以內容比對決定是否寫入：來源與目的內容相同即視為無變更、不寫入（冪等）。

#### Scenario: dry-run 僅預覽
- **WHEN** 使用者執行 `node sync.js to-repo --dry-run`
- **THEN** 系統 SHALL 顯示預覽並註明「未實際寫入任何檔案」，且 MUST NOT 產生任何寫入

#### Scenario: 內容相同不重寫
- **WHEN** 套用時來源檔與目的檔內容位元相同
- **THEN** 系統 SHALL 判定無需寫入，不計入變更統計
