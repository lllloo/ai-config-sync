## 1. 導入宣告式 manifest

- [x] 1.1 新增 `SYNC_MANIFEST` 常數（10 列，對應現有 7 claude + 3 codex 項目，順序不變），欄位 `area`／`label`／`type`／可選 `fixedFlow`；`settings.json`、`config.toml` 標 `fixedFlow: true`。
- [x] 1.2 新增 `resolveSyncArea(area)` 回傳 `{ homeBase, repoBase, prefix }`（claude／codex 各一）與 `materializeSyncItem(entry, direction)`（依 `fixedFlow` 決定固定或 swap，產出 `SyncItem`）。
- [x] 1.3 改寫 `buildSyncItems(direction)` 為 `SYNC_MANIFEST.map(entry => materializeSyncItem(entry, direction))`；移除 `buildClaudeSyncItems`／`buildCodexSyncItems`／`buildPathSyncItem`／`buildSwapItem`。
- [x] 1.4 更新 `module.exports`：移除 `buildSwapItem`，確認 `buildSyncItems` 仍匯出；確認所有函式 ≤ 60 行。

## 2. 行為不變驗證

- [x] 2.1 在 `test/sync.test.js` 新增 golden 測試：對 `to-repo`／`to-local` 逐項比對 `buildSyncItems` 產出的 `label`／`src`／`dest`／`type`／`prefix||'claude/'`，鎖定與重構前等價（含順序、固定流向項目不 swap）。
- [x] 2.2 將原 `buildSwapItem` 單元測試改寫為驗證 manifest materialization 的等效行為（`to-repo` home→repo、`to-local` repo→home），或以 2.1 的等價測試涵蓋後移除。
- [x] 2.3 確認 `diffSyncItem`／`applySyncItem`／`buildFullDiffList` 型別分派與指令分派未改動、行為不變。
- [x] 2.4 執行 `npm test`，確認全數通過。

## 3. 文件與檢查

- [x] 3.1 校正 `CLAUDE.md` 架構重點：移除 `SYNC_TYPE_HANDLERS`／`COMMANDS.handler` 不實描述，改述真實 switch-based 指令與型別分派，新增 `SYNC_MANIFEST` 與「新增同步內容只需加一列」。
- [x] 3.2 修正 `CLAUDE.md` codex-config 段落對 `SYNC_TYPE_HANDLERS` 的引用為真實的 `applySyncItem` switch 分派；`README.md` 如有相關描述一併校正。
- [x] 3.3 以 `grep -c "SYNC_TYPE_HANDLERS"` 確認 `sync.js`、`CLAUDE.md`、`README.md` 皆為 0。
- [x] 3.4 執行 `openspec validate "declarative-sync-manifest" --type change` 確認通過。
