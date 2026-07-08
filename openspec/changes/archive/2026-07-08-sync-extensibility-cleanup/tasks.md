## 1. 擴充性收斂

- [x] 1.1 新增 `SYNC_AREAS` 資料表（`claude`／`codex` 各一筆：`homeBase`、`repoDir`、`prefix`），`resolveSyncArea(area)` 改為查表回 `{ homeBase, repoBase, prefix }`（`repoBase = path.join(REPO_ROOT, cfg.repoDir)`）。
- [x] 1.2 新增 `itemLabel(item, rel?)` 輔助（`${item.prefix || 'claude/'}${item.label}${rel ? '/' + rel : ''}`）；將 9 處手刻標籤改走此輔助，`diffSettingsItem`／`diffCodexConfigItem` 改用 `item.prefix` 移除硬編 `claude/`／`codex/`。

## 2. 死碼清除

- [x] 2.1 移除 `computeLineDiff`／`computeSimpleLineDiff` 函式與其 `module.exports` 條目。
- [x] 2.2 移除 `isDeviceEnvKey` 函式與其 `module.exports` 條目（保留 `DEVICE_ENV_KEYS` 常數）。
- [x] 2.3 移除 `test/` 中對應死碼測試（`computeLineDiff`／`computeSimpleLineDiff`）；`isDeviceEnvKey` 無測試。

## 3. 文件與 JSDoc 校正

- [x] 3.1 `CLAUDE.md`：移除不變式段落中不存在的 `printFileDiff` 描述；移除 `buildSyncItems 54 行為例外` 過時註記；移除 test-strategy 句中 `computeLineDiff` 引用。
- [x] 3.2 `sync.js`：補正 `diffFile` JSDoc `@returns` 為 `'new'|'changed'|'deleted'|'eol'|null`。

## 4. 測試與驗證

- [x] 4.1 新增 dispatch drift-guard 測試：遍歷 `Object.keys(COMMANDS)` 斷言 `runCommand` 皆可分派、不落「未知指令」。
- [x] 4.2 執行 `npm test` 全數通過。
- [x] 4.3 `node sync.js diff --no-color` 冒煙，確認 10 項標籤與差異輸出與重構前一致。
- [x] 4.4 `openspec validate "sync-extensibility-cleanup" --type change` 通過。
