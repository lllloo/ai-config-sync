## 1. 新增 opencode area 與 manifest

- [x] 1.1 於 `sync.js` 的 `SYNC_AREAS` 加入 `opencode: { homeBase: path.join(HOME, '.config', 'opencode'), repoDir: 'opencode', prefix: 'opencode/' }`
- [x] 1.2 於 `SYNC_MANIFEST` 加入 opencode 主設定列（`file` 型，觸發檔名變體解析）與 `AGENTS.md` 列（`{ area:'opencode', label:'AGENTS.md', type:'file' }`）
- [x] 1.3 確認 `buildSyncItems`／`diffSyncItem`／`applySyncItem`／`runCommand` 的 switch 皆無需改動（宣告式擴充點驗證）

## 2. 主設定檔名變體解析

- [x] 2.1 於 `materializeSyncItem`（或其呼叫的小 helper）實作 canonical basename 解析：蒐集本機端與 repo 端 `opencode.{jsonc,json}` 候選，`.jsonc` 優先、皆不存在採預設 `opencode.jsonc`，兩端套用同一 canonical `label`
- [x] 2.2 以 manifest 列的可選欄位（`variants` 或 `resolveLabel` 旗標）僅對 opencode 主設定列觸發變體邏輯，其餘列 `label` 行為不變
- [x] 2.3 保持函式 ≤ 60 行；若解析邏輯使 `materializeSyncItem` 超行則抽出獨立 helper

## 3. safety:check 擴充

- [x] 3.1 於 `safety-check.js` 將 `opencode` 加入 `SAFETY_SCAN_DIRS`
- [x] 3.2 確認 opencode 主設定的 secret pattern／私鑰／HOME 路徑 hard block 與 `AGENTS.md` 掃描如預期；本次不加 opencode text 掃描排除（無同步子目錄）

## 4. 範本與 init 重置

- [x] 4.1 新增 `.example` 骨架：opencode 主設定範本（含 `$schema`）與 `opencode/AGENTS.example.md`
- [x] 4.2 將 opencode 項目納入 `npm run init` 重置流程（以 `.example` 覆寫正式檔），確認 `--dry-run` 正確預覽
- [x] 4.3 確認 init 對主設定檔名變體的處理（重置為 canonical `opencode.jsonc`）

## 5. 測試

- [x] 5.1 `test/sync.test.js`：`materializeSyncItem`／`buildSyncItems` 對 opencode area 的產出（`label`、`src`、`dest`、`type`、`prefix`）
- [x] 5.2 `test/sync.test.js`：檔名變體解析——僅 `.json`、僅 `.jsonc`、兩者皆存（`.jsonc` 優先）、皆不存（預設）四情境
- [x] 5.3 drift-guard：新增 opencode area 後 `claude`／`codex` area 既有項目產出不變
- [x] 5.4 `test/boundary.test.js`：safety sandbox 掃描涵蓋 `opencode/`（含 opencode 主設定含機密時回報 hard block）
- [x] 5.5 `npm test` 全數通過

## 6. 文件同步

- [x] 6.1 更新 `README.md`：同步項目表補列 opencode 對應、註記檔名變體與雙變體 orphan 提醒
- [x] 6.2 更新 `CLAUDE.md`：同步項目與對應表補列 opencode area；「刻意不同步」補記 opencode 資料/機密目錄與執行期產物
- [x] 6.3 `npm run safety:check` 與 `npm run status` 手動驗證 opencode 項目正確顯示
