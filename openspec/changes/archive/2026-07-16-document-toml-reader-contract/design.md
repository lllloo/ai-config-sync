## Context

`toml-reader.js`（166 行、4 個匯出純函式）是 `safety:check` 對 repo 內任何 `.toml` 做 hard block／warning 判斷的解析基礎。它前身為 `codex-config.js` 的解析半部；`config.toml` 同步移除後，過濾／序列化半部一併刪除，讀取器因 `safety:check` 仍依賴而抽成獨立模組。

現況缺口：這個安全關鍵模組的行為契約**只存在於程式碼註解與 CLAUDE.md**，OpenSpec 零覆蓋。對照同儕——`safety-check` 有 `safety-check` + `safety-check-module-boundary` 兩份 spec，`skills` 有 `skills-lock-diff` + `skills-module-boundary`——唯獨 toml-reader 既無行為 spec 也無 module-boundary spec。`safety-check` spec 明確**依賴** `.toml` 的 section 歸屬正確性（hard block 判斷），卻沒有被依賴的規格可指涉。

此 change 延續 `document-core-sync-engine` 的 backfill 慣例：把既有且已測試的行為補進規格，`toml-reader.js` 為 single source of truth，**不改任何程式碼**。

## Goals / Non-Goals

**Goals:**
- 將 toml-reader 的四項安全關鍵行為規格化：語句拆解與 key 歸屬、引號感知 header 解析、malformed header fail-closed、多行 value 續行。
- 將模組邊界不變式規格化：純函式零 IO、不反向 require `sync.js`、唯一消費者為 `safety-check.js`、回歸測試為安全防線不可刪。
- 讓 `safety-check` spec 對 `.toml` section 歸屬的依賴有明確被依賴規格。

**Non-Goals:**
- 不改 `toml-reader.js`、`safety-check.js` 或任何測試。
- 不改任何既有 spec 的需求（純新增 capability，無 MODIFIED）。
- 不擴充 TOML 解析能力（不追求完整 TOML 相容，只規格化 safety 掃描所需的子集行為）。
- 不恢復 `config.toml` 同步（見 CLAUDE.md「刻意不同步」，另有回歸鎖把關）。

## Decisions

**決策 1：單一 capability spec 同時涵蓋解析行為與模組邊界，不拆兩份。**
- 理由：toml-reader 體量小（166 行、4 函式）、module boundary 單純（純函式、單一消費者）。`safety-check`／`skills` 拆兩份是因行為面本身龐大；toml-reader 不需要。一份 `toml-statement-reader` 內以獨立 Requirement 分列解析不變式與模組邊界，讀者可一處讀全。
- 替代：比照 `*-module-boundary` 拆成 `toml-statement-reader` + `toml-reader-module-boundary`。否決——過度切割，兩份都會很短且互相指涉。

**決策 2：capability 命名為 `toml-statement-reader` 而非 `toml-reader`。**
- 理由：規格描述的是「把 TOML 讀成邏輯語句」這個能力（`readTomlStatements` 為核心對外契約），命名對齊能力而非檔名，與 `skills-lock-diff`（能力名）而非 `skills`（檔名）同慣例。

**決策 3：scenarios 對照既有測試，作為規格的可執行對照。**
- 理由：`test/toml-reader.test.js` 與 `test/boundary.test.js` 的 F2 回歸已覆蓋本 spec 所述行為。scenario 以 WHEN/THEN 描述這些既有測試的意圖，使規格 testable 且與現況一致，archive 後即為安全防線的規格層背書。

## Risks / Trade-offs

- **[規格與實作漂移]** → 本 change 不改碼，spec 忠實描述現況；日後改 `toml-reader.js` 時，修改守則要求同步既有回歸測試，spec 作為意圖層背書一併檢視。以 `toml-reader.js` 為 single source of truth，spec 不重述實作細節（如逐字元掃描演算法），只固定對外可觀察契約。
- **[過度規格化]** → 只規格化 safety 掃描實際依賴的行為子集，明確在 Non-Goals 排除「完整 TOML 相容」，避免把不保證的邊角行為寫成 SHALL。
- **[與 safety-check spec 重疊]** → 邊界清楚：`safety-check` 規定「哪些 section 是機密載體、命中即 hard block」；本 spec 規定「section 歸屬如何被正確算出」。前者是判準、後者是前提，互補不重複。

## Migration Plan

1. 建立 proposal／specs／design／tasks（本 change）。
2. `openspec validate` 通過後，依 tasks 逐項核對 spec 與 `toml-reader.js`／既有測試一致。
3. 執行 `/opsx:apply`：本 change 無程式碼變更，apply 階段主要為核對與 `openspec archive`。
4. archive 時 `toml-statement-reader` spec 落入 `openspec/specs/`，並將 Purpose 從預設佔位改寫為正式描述。
- 回滾：純文件與規格，移除 change 目錄即可，無任何執行期影響。

## Open Questions

- 無。行為已由現有測試釘死，規格為忠實回填。
