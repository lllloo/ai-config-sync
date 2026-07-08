## Why

日後打算持續**擴充同步內容**（新增要同步的檔案／目錄）。目前新增一個同步項目需要在 `buildClaudeSyncItems`／`buildCodexSyncItems` 兩個 imperative builder 之一動手，並理解 `buildPathSyncItem`／`buildSwapItem` 兩個 helper 與「settings.json／config.toml 為何 src/dest 不隨 direction 交換」的散落 inline 註解。同步項目的「單一事實來源」其實被拆在四個函式裡。

同時 `CLAUDE.md` 架構重點存在**描述漂移**：它宣稱「`COMMANDS` 物件含 `handler`，`main()` 透過 `COMMANDS[cmd].handler(opts)` 派發」「型別行為由 `SYNC_TYPE_HANDLERS`（`{ diff, apply, isDir }`）集中分派，新增同步類型只需加一筆」——但 `grep` 確認 `SYNC_TYPE_HANDLERS` 在 `sync.js` 出現 **0 次**。程式碼早已刻意重構為明確 `switch` 分派（`runCommand`／`diffSyncItem`／`applySyncItem`，註解明言「避免 handler 注入層」）。這些不實描述恰好落在「如何擴充本工具」的段落，會誤導未來維護。

> 本 change 為**結構性重構 + 文件校正**：不改任何對外同步行為，動機是把同步項目收斂成宣告式單一來源、並讓文件與程式碼一致。

## What Changes

- 新增宣告式 `SYNC_MANIFEST` 常數：一列描述一個同步路徑（`area`、`label`、`type`、可選 `fixedFlow`），以 `area`（`'claude'`／`'codex'`）對應 `(homeBase, repoBase, prefix)`。
- `buildSyncItems(direction)` 改為 map `SYNC_MANIFEST` → `SyncItem[]`，透過單一 materializer 依 `fixedFlow` 決定 direction-swap 或固定流向。移除 `buildClaudeSyncItems`／`buildCodexSyncItems`／`buildPathSyncItem`／`buildSwapItem`，邏輯整併進 materializer。
- **行為位元級不變**：materialize 出的 `SyncItem[]` 之順序、`label`、`src`、`dest`、`type`、`prefix` 與重構前完全等價，以測試鎖定 `buildSyncItems('to-repo')` 與 `('to-local')` 的輸出。
- 型別 dispatch（`diffSyncItem`／`applySyncItem`／`buildFullDiffList`）維持既有 `switch`，**不反轉為 handler table**（尊重既有刻意決定）。
- 校正 `CLAUDE.md` 架構重點：改為描述真實的 switch-based 指令與型別分派、移除所有 `SYNC_TYPE_HANDLERS`／`COMMANDS.handler` 不實描述、新增 `SYNC_MANIFEST` 描述與「新增同步內容只需在 `SYNC_MANIFEST` 加一列」；修正 codex-config 段落對 `SYNC_TYPE_HANDLERS` 的引用。
- 更新受影響單元測試（`test/sync.test.js` 的 `buildSwapItem` 測試改為測 manifest materialization／`buildSyncItems` 產出）；README 若有相關描述一併校正。

## Capabilities

### New Capabilities
- `declarative-sync-manifest`: 定義同步項目以宣告式 manifest 為單一來源、materialize 行為、行為不變要求，以及文件與程式碼一致性要求。

### Modified Capabilities
- 無。同步的需求語意不變；本 change 只改同步項目的**定義形式**與文件正確性。

## Impact

- 影響 `sync.js`：新增 `SYNC_MANIFEST` 與 materializer，移除四個 builder／helper 函式，`buildSyncItems` 改寫。
- 影響 `test/sync.test.js`：`buildSwapItem` 單元測試改測 manifest materialization；新增鎖定 `buildSyncItems` 輸出等價的測試。
- 影響 `CLAUDE.md`（架構重點、codex-config 段落）與 `README.md`（如有相關描述）。
- 不新增外部 npm 相依，不改對外同步行為、可攜欄位或 merge 語意，不動 `safety-check.js`／`codex-config.js`。

## Dependency

- 無前置 change 相依。承接 `extract-safety-check-module`／`extract-codex-config-module` 導入的模組化與文件同步紀律。
