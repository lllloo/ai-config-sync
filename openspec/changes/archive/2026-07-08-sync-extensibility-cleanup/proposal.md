## Why

延續 `declarative-sync-manifest` 對「擴充同步內容」的優化，一次三方獨立稽核（sync.js 擴充性、文件一致性、全專案結構）收斂出一批**已查證、低風險**的收尾項目：

- `resolveSyncArea` 仍以 imperative if/else 硬編 `claude`／`codex`，與宣告式 `SYNC_MANIFEST` 不對稱——新增第三個工具 area 需改控制流，而非加一列資料。
- 顯示標籤 `${item.prefix || 'claude/'}${item.label}` 在 9 處手刻，其中 `diffSettingsItem`／`diffCodexConfigItem` 甚至硬編 `claude/`／`codex/` 字串，繞過 `item.prefix`。
- **死碼**：`computeLineDiff`／`computeSimpleLineDiff`（隨已移除的 `printFileDiff` 行級 diff 渲染器遺留，零生產呼叫點）、`isDeviceEnvKey`（零呼叫、零測試）。
- **文件漂移**：`CLAUDE.md` 仍引用不存在的 `printFileDiff`、`buildSyncItems 54 行為例外`（現為 3 行）；`diffFile` JSDoc `@returns` 少列 `'deleted'`／`'eol'`。
- **測試缺口**：`COMMANDS` 與 `runCommand` 的 switch 是刻意雙來源，但無 drift-guard 測試——新增指令若漏改 switch 會落到 `default`「未知指令」而無測試攔截。

> 本 change 為**結構性收尾 + 死碼清除 + 文件校正**：不改任何對外同步行為。

## What Changes

- 新增 `SYNC_AREAS` 資料表，`resolveSyncArea` 改為索引查表（新增 area = 加一筆資料，對稱於 `SYNC_MANIFEST`）。
- 新增 `itemLabel(item, rel?)` 輔助，統一 9 處標籤構造（保留 `|| 'claude/'` fallback 供手工建構的 item 防呆）；`diffSettingsItem`／`diffCodexConfigItem` 改用 `item.prefix`，移除硬編 area 字串。
- 移除死碼 `computeLineDiff`／`computeSimpleLineDiff`／`isDeviceEnvKey` 及其 `module.exports` 與對應測試。
- 校正文件：`CLAUDE.md` 移除 `printFileDiff` 與 `buildSyncItems 54 行` 過時描述、移除 test-strategy 中 `computeLineDiff` 引用；補正 `diffFile` JSDoc `@returns`。
- 新增 dispatch drift-guard 測試：斷言每個 `COMMANDS` key 都能被 `runCommand` 分派（不落 `default`）。

## Capabilities

### Modified Capabilities
- `declarative-sync-manifest`: area 解析由 imperative 分支改為 `SYNC_AREAS` 資料表；新增「指令分派需與 `COMMANDS` 一致」的可驗證要求。行為語意不變，只強化擴充對稱性與防漂移。

## Impact

- 影響 `sync.js`：新增 `SYNC_AREAS`／`itemLabel`，改寫 `resolveSyncArea` 與 9 處標籤構造，移除 3 個死碼函式與其 exports。
- 影響 `test/sync.test.js`／`test/boundary.test.js`：移除死碼對應測試，新增 dispatch drift-guard 測試。
- 影響 `CLAUDE.md`（不變式與 test-strategy 段落）與 `sync.js` JSDoc。
- 不新增外部相依，不改對外同步行為、可攜欄位或 merge 語意，不動 `safety-check.js`／`codex-config.js` 的對外行為。

## Dependency

- 承接 `declarative-sync-manifest`（已封存）。無其他前置相依。
