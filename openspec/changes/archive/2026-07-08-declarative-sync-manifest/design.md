## Context

`sync.js` 的同步項目目前由 `buildSyncItems(direction)` 組裝，內部委派兩個 builder：

- `buildClaudeSyncItems`：7 個項目（`CLAUDE.md`、`settings.json`、`statusline.sh`、`agents`、`commands`、`skills`、`rules`）。5 個走 `buildPathSyncItem`（依 direction 預先算好的 `src`/`dest` swap），`settings.json` 為固定 src/dest 特例（inline 物件 + 註解）。
- `buildCodexSyncItems`：3 個項目（`AGENTS.md`、`config.toml`、`agents`）。`AGENTS.md`／`agents` 走 `buildSwapItem`，`config.toml` 為固定 src/dest 特例（inline 物件 + 註解）。

「固定 src/dest」（`settings.json`、`config.toml`）指 src 恆為本機端、dest 恆為 repo 端，資料流向由 `mergeSettingsJson`／`mergeCodexConfigToml` 內部依 direction 決定，故不能隨 direction 交換路徑。這個規則目前以重複註解表達，未成為資料。

型別行為分派是明確 `switch`（`diffSyncItem`／`applySyncItem`，另 `buildFullDiffList` 以 `item.type==='dir'` 特判），程式碼註解明言刻意「避免 handler 注入層／額外 handler 表」。指令分派同理走 `runCommand` 的 `switch`。這些是**刻意決定**，本 change 不動。

## Goals / Non-Goals

**Goals:**
- 讓同步項目成為宣告式單一來源（`SYNC_MANIFEST`），新增同步內容 = 加一列。
- 把「固定 src/dest」「direction-swap」「area→base/prefix」三種規則從散落註解與四個函式收斂進資料 + 單一 materializer。
- 保持 `buildSyncItems` 輸出位元級等價，並以測試鎖定。
- 讓 `CLAUDE.md`／`README` 與真實程式碼一致（消除 `SYNC_TYPE_HANDLERS`／`COMMANDS.handler` 漂移）。

**Non-Goals:**
- 不反轉 `switch` dispatch 為 handler table。
- 不改對外同步行為、可攜欄位白名單、merge 語意。
- 不新增外部 npm 套件（零相依鐵律）。
- 不動 `safety-check.js`／`codex-config.js`。

## Decisions

### Decision 1: 以 `area` 對應 base/prefix，`fixedFlow` 表達固定 src/dest

`SYNC_MANIFEST` 每列形如 `{ area, label, type, fixedFlow? }`。materializer 內以小表把 `area` 對到 `{ homeBase, repoBase, prefix }`：

- `claude` → `{ homeBase: CLAUDE_HOME, repoBase: path.join(REPO_ROOT, 'claude'), prefix: 'claude/' }`
- `codex` → `{ homeBase: CODEX_HOME, repoBase: path.join(REPO_ROOT, 'codex'), prefix: 'codex/' }`

`fixedFlow: true`（`settings.json`、`config.toml`）→ `src = homeBase/label`、`dest = repoBase/label`，不隨 direction；否則依 direction swap（`to-repo`：home→repo，`to-local`：repo→home）。

替代方案：保留兩個 area builder。拒絕，因為 area 差異只有 base/prefix，屬資料而非邏輯，合併後新增 codex 或未來第三個 area 都只是加列。

### Decision 2: `prefix` 語意與現況對齊，避免 diff/apply 標籤漂移

現況 claude 項目多數**不帶** `prefix` 欄位（消費端 fallback 為 `'claude/'`），codex 項目**顯式**帶 `prefix: 'codex/'`。materializer 對 `claude` area 產出的 `SyncItem` 一律帶 `prefix: 'claude/'`。這與消費端 `item.prefix || 'claude/'` 的 fallback 結果**顯示等價**（標籤字串相同），故 diff/apply 輸出不變。等價測試比對 `label`/`src`/`dest`/`type` 與（正規化後）`prefix` 顯示結果。

替代方案：materializer 對 claude 省略 `prefix` 欄位以求物件深度全等。可行但需在資料層特判 area，增加複雜度；改以「顯示等價」為驗證標準即可，消費端行為不變。

### Decision 3: dispatch 維持 switch，只校正文件

型別與指令分派保持 `switch`。`CLAUDE.md` 改為據實描述：指令分派為 `COMMANDS`（`{alias, desc}`）存在性檢查 + `runCommand` switch；型別分派為 `diffSyncItem`／`applySyncItem` switch + `buildFullDiffList` 的 dir 特判。新增「同步內容」的擴充點改指向 `SYNC_MANIFEST`。

替代方案：重建 `SYNC_TYPE_HANDLERS` 讓舊文件成真。拒絕，會反轉近期刻意決定、為少數型別引入 indirection，且與本 change「不動 dispatch」界線衝突。

## Risks / Trade-offs

- **materialize 與現況不等價** → 以 golden 測試鎖定：對 `to-repo`／`to-local` 兩方向，逐項比對重構後 `buildSyncItems` 的 `label`/`src`/`dest`/`type`/正規化 `prefix`。任何漂移即測試失敗。
- **`buildSwapItem` 被外部測試引用** → `test/sync.test.js` 現有 `buildSwapItem` 測試改寫為驗證 manifest materialization 的等效行為（to-repo home→repo、to-local repo→home）。`module.exports` 移除 `buildSwapItem`。
- **materializer 過長（>60 行）** → 拆成 `resolveSyncArea(area)`（回 base/prefix）與 `materializeSyncItem(entry, direction)`，`buildSyncItems` 僅 `SYNC_MANIFEST.map(...)`。
- **文件再度漂移** → 本 change 明列文件校正為任務，並以「grep `SYNC_TYPE_HANDLERS` 應為 0」作為完成檢查。

## Open Questions

- 未來若某 area 需要非 `home/label` 的巢狀來源路徑（如 `~/.codex/agents` 已是 `label='agents'` 直接對應），是否要在 manifest 加 `srcRel`/`destRel` 覆寫？目前所有項目都是 `base/label`，暫不加欄位，待實際需求出現再擴充（YAGNI）。
