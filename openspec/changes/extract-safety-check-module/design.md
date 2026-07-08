## Context

`sync.js` 目前仍是主要 CLI 入口，且包含同步、diff、skills、init 與 `safety:check` 邏輯。`decouple-safety-check` 已完成同步流程降責，但 safety check 的掃描與輸出函式仍位於 `sync.js` 的同一檔案內，形成概念上已分離、檔案上仍耦合的狀態。

目前 `safety:check` 主要依賴 `sync.js` 內的共用能力：路徑常數、相對路徑遮罩、HOME 遮罩、安全讀檔、目錄列舉、顏色輸出與 exit code。因此拆檔時要避免把同步核心整包反向匯入，否則只是把耦合移到 `require()` 層。

## Goals / Non-Goals

**Goals:**
- 讓 safety check 掃描、判斷與 report 產生邏輯集中在獨立檔案。
- 保留 `sync.js` 作為既有 CLI 入口，避免使用者指令改變。
- 保持 `safety:check` 的掃描範圍、分類、遮罩與 exit code 行為不變。
- 讓測試沙箱明確包含 safety check 模組，避免單檔假設回歸。

**Non-Goals:**
- 不改 `safety:check` 規則本身。
- 不新增外部 npm 套件。
- 不把整個專案改成多檔架構；只針對 safety check 拆出邊界。
- 不新增獨立使用者指令，例如 `node safety-check.js`。

## Decisions

### Decision 1: 保留 `sync.js` 作為唯一 CLI 入口

`npm run safety:check` 與 `node sync.js safety:check` 應維持不變。`sync.js` 只負責 command dispatch、呼叫 safety module、列印或轉換 exit code。

替代方案：讓 `npm run safety:check` 直接執行 `node safety-check.js`。暫不採用，因為會讓 CLI 入口分裂，且需要重複錯誤處理與色彩輸出初始化。

### Decision 2: safety module 以 dependency injection 接收共用工具

獨立模組應匯出純入口，例如 `runSafetyChecks(deps)` 與 `printSafetyReport(issues, deps)`，由 `sync.js` 傳入 `REPO_ROOT`、patterns、`getFiles`、`readFileSafe`、`toRelativePath`、`maskHome`、`col` 等依賴。

替代方案：`safety-check.js` 直接 require `sync.js`。拒絕，因為會造成循環依賴與反向耦合，測試也較難隔離。

### Decision 3: 行為測試保留在既有整合測試，模組可補純函式測試

既有 `boundary.test.js` 的 CLI sandbox 測試應繼續覆蓋 exit code 與輸出遮罩。拆檔後 sandbox helper 需要複製 `safety-check.js`。若拆出純函式，則可在 `sync.test.js` 或新測試段落補充模組輸出格式測試。

替代方案：只做單元測試、不跑 CLI sandbox。拒絕，因為此 change 的核心風險是 CLI 對外行為漂移。

## Risks / Trade-offs

- 模組邊界過度抽象 → 使用簡單 deps object，避免建立大型框架。
- `sync.js` 與 `safety-check.js` 共用常數漂移 → patterns 與掃描範圍由 `sync.js` 傳入或集中匯出，測試鎖住 CLI 行為。
- sandbox 測試漏複製新檔 → 更新共用 helper 或 setup function，讓未來新增必要 runtime 檔時更明顯。
- 專案文件仍宣稱「單檔 CLI」 → 更新 README / AGENTS / CLAUDE 為「`sync.js` 為主入口，safety check 模組獨立」。

## Open Questions

- 是否需要讓 `safety-check.js` 也能被直接執行？目前建議否，除非未來要把 safety scanner 做成獨立工具。
- 是否要把 patterns 常數也移入 safety module？若只供 safety 使用，可以移入；若文件與 tests 仍需從 `sync.js` 匯出，則先由 `sync.js` 持有並傳入。
