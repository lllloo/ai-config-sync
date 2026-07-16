## Why

現有 7 個 spec 覆蓋了 settings 同步、跨工具 skill、宣告式 manifest、opencode、safety-check 與模組邊界等「周邊」能力，但**核心同步引擎本身沒有任何 spec**：`diff`／`to-repo`／`to-local`／`status` 的雙向流程、CLI 契約（旗標白名單、npm flag fail-fast、exit code 語義）、以及跨模組共用的寫入安全不變式（atomic write、統一錯誤處理、部分失敗可見度、path 遮罩）皆只存在於程式碼與註解，未被規格捕捉。這些是所有周邊能力賴以成立的地基；缺 spec 使得回歸風險最高的路徑反而沒有規格護欄。本 change 為既有邏輯回填規格，不改變任何執行期行為。

## What Changes

- 為**核心同步 CLI 契約**建立規格：`COMMANDS`／`COMMAND_ALIASES`／`runCommand` 的指令分派、旗標白名單（未知旗標含 typo 一律拋 `INVALID_ARGS` 而非靜默忽略）、`--` 分隔語義、`assertNoSwallowedNpmFlags` 對被 npm 攔截旗標的 fail-fast、`help`／`--version` 行為、三段 exit code 語義（`EXIT_OK`／`EXIT_DIFF`／`EXIT_ERROR`）。
- 為**雙向同步流程**建立規格：`diff` 唯讀且有差異回 `EXIT_DIFF`、`status` 為 `diff`+`skills:diff` 合流、`to-repo` 的 git-repo 前置檢查與完成後 `showGitStatus`、`to-local` 的 preview→confirm 閘門、非互動環境（非 TTY）拒絕等待而非 hang、`--dry-run` 絕不寫入、內容相同即不寫入的冪等語義。
- 為**寫入安全不變式**建立規格：`writeFileSafe` 的 atomic write（同目錄暫存檔 + `O_EXCL` + `rename` + `mode 0600`）、暫存檔登記與退出清理、`SIGINT`／`SIGTERM` 中斷警告、部分失敗可見度（`partialChanges`→`warnPartialApply`）、`SyncError`+`formatError` 統一錯誤出口（禁裸 `console.error`+`exit`）、path 遮罩（`toRelativePath`／`maskHome` 不洩漏使用者目錄）。
- 為 **skills lock 比對行為**建立規格：`skills:diff` 對 `~/.agents/.skill-lock.json` 與 repo `skills-lock.json` 的三向集合差、只輸出建議指令不執行安裝／移除、與 `npx skills` 共管的誤報規避（不用 `npx skills list -g`）。
- 不新增／不移除任何指令、旗標或同步項目；不改任何函式行為。純規格回填。

## Capabilities

### New Capabilities
- `core-sync-cli`: 核心 CLI 契約——指令／別名分派、旗標白名單與 `--` 分隔、npm flag fail-fast、help／version、exit code 語義。
- `bidirectional-sync-workflow`: 雙向同步流程——`diff`／`status`／`to-repo`／`to-local` 的預覽、確認閘門、git 前置檢查、dry-run 與冪等語義。
- `sync-write-safety`: 寫入安全不變式——atomic write、暫存檔清理、訊號中斷、部分失敗可見度、統一錯誤處理與 path 遮罩。
- `skills-lock-diff`: skills lock 比對行為——三向集合差、只建議不執行、npx 共管誤報規避。

### Modified Capabilities
<!-- 無：本 change 純回填既有邏輯，未變更任何既有 spec 的 requirement -->

## Impact

- **規格**：新增 `openspec/specs/core-sync-cli`、`bidirectional-sync-workflow`、`sync-write-safety`、`skills-lock-diff` 四份 spec（archive 後）。
- **程式碼**：無變更。所有 requirement 皆對照 `sync.js`（CLI dispatch、flow、write primitives）與 `skills.js`（lock diff）之現況撰寫。
- **測試**：既有 `test/*.test.js` 已覆蓋這些行為（`sync.test.js`／`apply-integration.test.js`／`boundary.test.js`／`skills.test.js`）；本 change 不新增測試，僅要求規格敘述與現有測試不矛盾。
- **文件**：`CLAUDE.md` 已詳述這些不變式，spec 與其對齊；無 README 指令表變動。
