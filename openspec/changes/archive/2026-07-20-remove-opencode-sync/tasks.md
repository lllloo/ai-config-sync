## 1. 移除 repo 端來源

- [x] 1.1 刪除 `opencode/` 整個目錄（`opencode.json`、`AGENTS.md`）

## 2. 移除 sync.js 的 opencode 與 variants 機制

- [x] 2.1 移除 `OPENCODE_HOME` 常數與其上方的 XDG 佈局說明註解
- [x] 2.2 移除 `SYNC_AREAS.opencode` 一列
- [x] 2.3 移除 `SYNC_MANIFEST` 的兩列 opencode 項目（`opencode.jsonc` 與 `AGENTS.md`）
- [x] 2.4 移除 `resolveVariantLabel` 函式及其 JSDoc
- [x] 2.5 移除 `materializeSyncItem` 中的 `entry.variants` 分支，`label` 改為直接取 `entry.label`
- [x] 2.6 移除 `SYNC_MANIFEST` 與 `materializeSyncItem` 型別註記中的 `variants?: string[]` 欄位，以及註解中對 variants 的說明段落
- [x] 2.7 移除模組尾端 exports 的 `resolveVariantLabel`

## 3. 移除 safety-check.js 的 opencode 掃描

- [x] 3.1 `SAFETY_SCAN_DIRS` 移除 `'opencode'` 項

## 4. 更新測試

- [x] 4.1 刪除 `test/sync.test.js` 中「opencode area」整段測試（`SYNC_AREAS` 檢查、`materializeSyncItem` AGENTS.md、四則 `resolveVariantLabel` 變體解析、canonical label、「新增 opencode area 後 claude／codex 產出不變」drift-guard）
- [x] 4.2 移除 `test/sync.test.js:305` 附近的 `norm` 正規化函式（`opencode.jsonc?` → `opencode.CONFIG`），並調整其所在測試的期望 label 清單
- [x] 4.3 更新 `test/sync.test.js` 中含 opencode 的 label 清單／README 對照 drift-guard 期望值
- [x] 4.4 保留 claude／codex label 清單 drift-guard（原 opencode 對照測試改寫而成，仍為該清單的唯一把關）
- [x] 4.5 不新增任何「不得復活」回歸鎖（求零殘留，見 design D4）
- [x] 4.6 更新 `test/boundary.test.js` 的 7 處 opencode 命中（`SAFETY_SCAN_DIRS` drift-guard 與相關斷言）
- [x] 4.7 執行 `npm test`，確認全數通過

## 5. 更新文件

- [x] 5.1 `README.md`：同步項目表移除兩列 opencode、`SAFETY_SCAN_DIRS` 清單移除 opencode
- [x] 5.2 `README.md`：移除所有 opencode 敘述（求零殘留，不留孤兒檔說明）
- [x] 5.3 `CLAUDE.md`：移除「目錄命名」中的 `opencode/` 段落、同步項目對應表兩列、「刻意不同步」中的 opencode 機密與執行期產物兩段
- [x] 5.4 `CLAUDE.md`：更新「新增同步項目」敘述（不再提 opencode 落點）
- [x] 5.5 `ROADMAP.md`：改寫 `--area` 旗標提案動機（分區工具由三個減為兩個）

## 6. 收尾驗證

- [x] 6.1 執行 `npm run safety:check`，確認 exit 0 且無 opencode 相關輸出
- [x] 6.2 執行 `npm run diff`，確認輸出不含 opencode 項目且無例外
- [x] 6.3 確認 `git status` 中本機 `~/.config/opencode/` 未被觸碰（本變更僅動 repo 內檔案）
- [x] 6.4 全庫 `grep -rni "opencode"` 排除 `openspec/changes/` 後零命中（含刪除 `openspec/specs/opencode-sync/` 與兩份主 spec 的 Purpose 字樣）
