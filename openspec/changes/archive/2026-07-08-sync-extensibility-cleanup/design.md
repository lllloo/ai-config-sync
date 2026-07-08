## Context

三方稽核（`sync.js` 擴充性、docs↔code 一致性、全專案結構）對已由 `declarative-sync-manifest` 優化過的程式碼再掃一輪，收斂出低風險收尾項。所有項目皆逐一 grep 查證：`computeLineDiff`／`computeSimpleLineDiff`／`isDeviceEnvKey` 無生產呼叫點、`printFileDiff` 在 `sync.js` 為 0 次、`diffFile` 實際回傳含 `deleted`／`eol`、`resolveSyncArea` 為 imperative 分支。

## Goals / Non-Goals

**Goals:**
- 讓 area 解析與 `SYNC_MANIFEST` 一樣資料驅動（新增 area = 加一筆）。
- 消除標籤構造重複與硬編 area 字串。
- 清除確認無用的死碼，降低誤導。
- 修正文件與 JSDoc 漂移；補上指令分派 drift-guard 測試。

**Non-Goals:**
- 不改對外同步行為、可攜欄位、merge 語意。
- 不反轉刻意保留的 switch dispatch。
- 不動 `safety-check.js`／`codex-config.js` 對外行為。
- 不新增外部相依。

## Decisions

### Decision 1: `SYNC_AREAS` 資料表 + `resolveSyncArea` 查表

```
const SYNC_AREAS = {
  claude: { homeBase: CLAUDE_HOME, repoDir: 'claude', prefix: 'claude/' },
  codex:  { homeBase: CODEX_HOME,  repoDir: 'codex',  prefix: 'codex/'  },
};
```
`resolveSyncArea(area)` 回 `{ homeBase, repoBase: path.join(REPO_ROOT, cfg.repoDir), prefix }`。與 `SYNC_MANIFEST` 對稱：新增工具只需加一筆 area + 對應 manifest 列。

### Decision 2: `itemLabel(item, rel?)` 統一標籤，保留 fallback

`itemLabel(item, rel)` 回 `${item.prefix || 'claude/'}${item.label}${rel ? '/' + rel : ''}`。**保留 `|| 'claude/'` fallback**：`boundary.test.js` 等會手工建構不帶 `prefix` 的 item，移除 fallback 會產生 `undefined...` 標籤。`diffSettingsItem`／`diffCodexConfigItem` 改用 `item.prefix`（materialize 已保證 settings=`claude/`、config.toml=`codex/`），消除硬編 area 字串。

替代方案：移除 fallback 假設所有 item 皆帶 prefix。拒絕，破壞手工建構 item 的防呆且無實益。

### Decision 3: 死碼一律連測試移除

`computeLineDiff`／`computeSimpleLineDiff`（隨已移除的 `printFileDiff` 遺留，`computeSimpleLineDiff` 僅被 `computeLineDiff` 呼叫、後者無生產呼叫點）與 `isDeviceEnvKey`（零呼叫零測試）連同 `module.exports` 與 `test/` 對應案例一併刪除。`DEVICE_ENV_KEYS` 常數保留（文件化 review 清單）、`getStrippedSettings` 保留（有測試的 back-compat wrapper）。

### Decision 4: dispatch drift-guard 測試

新增測試：對每個 `Object.keys(COMMANDS)` 斷言 `runCommand` 不落入 `default`（可透過 export 一個 dispatchable 集合並與 `COMMANDS` keys 做 set 相等，或以 `--help` 冒煙）。鎖住「新增指令漏改 switch」的漂移。

## Risks / Trade-offs

- **9 處標籤改動引入細微字串漂移** → 202 個既有測試 + 整合測試覆蓋 diff/apply 標籤，任何漂移即失敗；改動後跑全套。
- **誤刪仍被引用的死碼** → 已 grep 查證零生產呼叫；移除後 `npm test` 與 `node sync.js diff` 冒煙雙驗。
- **dispatch guard 過度耦合實作** → 以 `COMMANDS` keys 為單一事實來源、只斷言「可被分派」，不硬編指令清單。

## Open Questions

- 無。所有項目已查證、範圍明確。
