## Context

`sync.js` 是主 CLI 入口，同時承載 Claude 設定同步、diff、skills、init，以及 Codex `config.toml` 的過濾同步。Codex config 邏輯目前**跨兩個 section**：

1. **Codex Config Handler**（約 1113–1409，19 函式）：TOML parse／serialize、可攜欄位判斷、方向相依 merge，以及 apply 進出口（`mergeCodexConfigToml`／`mergeCodexConfigToRepo`／`mergeCodexConfigToLocal`）。
2. **Sync Core 內的 diff 渲染**（約 1637+）：`diffCodexConfigToLocal`、`diffCodexConfigItem`——direction-aware，鏡射 merge 判斷以產生 diff entry，經 `SYNC_TYPE_HANDLERS` 的 `codex-config` 型別分派。

前者相依邊極乾淨（只吃 `readFileSafe`、`writeTextSafe`、`REPO_ROOT`、`CODEX_HOME` 與自身常數，零顯示層）；後者屬 diff 引擎，額外用到 `createTmpDiffFile`、`isEolOnlyDiff` 等 diff 工具。這與 skills 的教訓同構：**純轉換層可乾淨抽出，diff 渲染屬引擎、應留原地並回呼模組純函式**。

## Goals / Non-Goals

**Goals:**
- 讓 Codex config 的 parse／serialize／merge／load／apply 與專屬常數集中在獨立檔案。
- 保留 `sync.js` 作為既有 CLI 入口，`to-repo`／`to-local`／`diff`／`status` 對 `codex/config.toml` 行為不變。
- 保持相依邊乾淨：模組只接受 leaf fs util 與路徑常數注入，不反向 require `sync.js`。
- 讓測試沙箱明確包含新模組，避免單檔假設回歸。

**Non-Goals:**
- 不改 Codex config 的可攜欄位白名單或 merge 語意。
- 不新增外部 npm 套件。
- 不把整個專案改成多檔架構；只針對 Codex config 拆出邊界（延續 `extract-safety-check-module` 的一次性收斂原則）。
- 不新增獨立使用者指令或獨立 CLI 入口（`node codex-config.js`）。

## Decisions

### Decision 1: 只抽「純轉換 + apply 層」，diff 渲染留在 Sync Core

`codex-config.js` 承載 parse／serialize／merge／load／get／apply（`mergeCodexConfigToml` 等）與常數。`diffCodexConfigItem`／`diffCodexConfigToLocal` **留在 `sync.js`**，因為它們屬 diff 引擎、依賴 `createTmpDiffFile`／`isEolOnlyDiff`，只需改為呼叫模組匯出的 `loadPortableCodexConfig`／`mergePortableCodexConfig`／`getPortableCodexConfig`。

替代方案：把 diff 渲染也搬進模組。拒絕，會把 diff 引擎工具反向拖進模組，重演 skills 的顯示層耦合。

### Decision 2: 以 dependency injection 接收共用工具

比照 `safety-check.js` 的 `createSafetyChecker(deps)`：模組匯出 factory（如 `createCodexConfigHandler(deps)`）或純函式集合，由 `sync.js` 傳入 `readFileSafe`、`writeTextSafe` 與路徑常數。apply 進出口需寫檔故注入 `writeTextSafe`；純 parse／serialize／merge 無 IO，可為無相依純函式直接匯出。

替代方案：`codex-config.js` 直接 require `sync.js`。拒絕，造成循環依賴與反向耦合。

### Decision 3: 常數與純函式由模組持有並經 `sync.js` re-export

`CODEX_CONFIG_TOP_KEYS`、`CODEX_CONFIG_SECTION_KEYS` 與被測試引用的純函式（`parsePortableCodexConfig`、`serializePortableCodexConfig`、`mergePortableCodexConfig`、`loadPortableCodexConfig`、`getPortableCodexConfig`）移入模組，`sync.js` re-export 以維持既有 `test/codex-config.test.js` 的 import 來源，避免測試大改與常數漂移。比照 safety 常數 re-export 的做法。

替代方案：改寫 `test/codex-config.test.js` 直接 import 新模組。可行但增加 diff 面積；re-export 讓行為驗證聚焦在「行為不變」而非 import 位移。

## Risks / Trade-offs

- 模組邊界過度抽象 → 沿用簡單 deps object / 純函式匯出，不建框架。
- 常數／純函式漂移 → 由模組單一持有、`sync.js` re-export，測試鎖住行為。
- sandbox 漏抄新檔 → 更新 `SYNC_RUNTIME_FILES`（`apply-integration.test.js`）納入新模組；`sync.js` require 缺檔即崩，測試會立即抓到。
- 文件仍描述 Codex config 在 sync.js → 更新 README／CLAUDE。

## Open Questions

- apply 進出口（`mergeCodexConfigToRepo`／`ToLocal`／`Toml`）該放模組還是留 `sync.js`？傾向放模組（只用 `readFileSafe`／`writeTextSafe`，注入即可），讓 `SYNC_TYPE_HANDLERS` 的 `codex-config` 分派僅一行呼叫模組。
- 是否連同 `diffCodexConfigItem` 需要的 merge 判斷一併匯出輔助，避免 sync 端重複邏輯？以「diff 端只呼叫既有純函式、不複製判斷」為原則。
