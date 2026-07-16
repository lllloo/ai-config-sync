## Context

`sync.js` 為主 CLI 入口，已有 `safety-check.js`（`createSafetyChecker(deps)` DI）與 `toml-reader.js`（純函式）兩個抽出模組作為範本。skills 指令族目前仍實作於 `sync.js` 的「Skills Handler」banner 段（約 sync.js 2032–2324）。

實讀該段 body 後確認的事實：

- **純 skills 為 9 個函式**：`loadSkillsFromLock`、`computeSkillsDiff`、`sanitizeForTerminal`、`runSkillsDiff`、`validateSkillName`、`validateSkillSource`、`parseSkillSource`、`runSkillsAdd`、`runSkillsRemove`。
- **banner 段尾混入 2 個非 skills 房客**：`printVersion`、`runHelp` 實屬 CLI，只是物理位置落在此段尾巴。
- **精確跨 section 依賴**（即注入清單）：常數 `REPO_ROOT`、`LOCAL_SKILL_LOCK`、`EXIT_OK`、`EXIT_DIFF`；錯誤框架 `SyncError`、`ERR`；FS 工具 `readJson`（**非** `readJsonSafe`）、`writeJsonSafe`；顯示工具 `printSectionDivider`、`printStatusLine`；ANSI `col`。`fs`／`path` 為 Node 內建、由 `skills.js` 自 require。
- **`REPO_AGENTS_SKILLS` 未被這 9 函式使用**：skills:diff 是讀 lock 檔集合比對，不掃 `agents/skills/` 目錄，故不在注入清單。

## Goals / Non-Goals

**Goals:**
- 讓 skills 指令族的讀取／比對／驗證／輸出邏輯集中在獨立 `skills.js`。
- 保留 `sync.js` 為唯一 CLI 入口與 `runCommand` 分派中心，指令名稱／別名不變。
- 保持 `skills:diff`／`skills:add`／`skills:remove` 的輸出、建議指令與 exit code 行為不變。
- 讓測試沙箱明確包含 `skills.js`，避免單檔假設回歸。

**Non-Goals:**
- 不改 skills 指令的規則或輸出語意。
- 不動 skills-lock.json 資料格式或 `~/.agents/.skill-lock.json` 讀取邏輯。
- 不新增外部 npm 套件。
- 不新增獨立使用者指令（如 `node skills.js`）。
- 不觸碰 `xtool-skills` 型同步（`SYNC_MANIFEST` 的 `agents/skills`）——那屬 Sync Core，不在本 change 射程。

## Decisions

### Decision 1: 先做房客歸位（step 0），再抽模組（step 1）

先把 `printVersion`／`runHelp` 從「Skills Handler」段移回 CLI/Main 段，使被抽出的區塊為純 skills。若不先分離，一刀會連 CLI 房客一起端進 `skills.js`，造成 `skills.js` 反而依賴 `readPackageJson`／`COMMANDS` 等非 skills 符號、模糊邊界。

替代方案：連 `printVersion`／`runHelp` 一起搬。拒絕——兩者與 skills 無關，`runHelp` 遍歷 `COMMANDS`、屬 CLI 敘事，搬過去會製造新的跨模組耦合。

### Decision 2: `createSkillsHandler(deps)` DI，對稱 `createSafetyChecker`

`skills.js` 匯出 `createSkillsHandler(deps)`，回傳 `{ runSkillsDiff, runSkillsAdd, runSkillsRemove }` 三個對外方法（其餘 6 個為模組內私有）。`sync.js` 以 lazy singleton（照 `_safetyChecker` 樣式）建立，`runCommand` 三個 case 改呼叫 singleton 方法。

注入清單（實測）：
```
REPO_ROOT, LOCAL_SKILL_LOCK, EXIT_OK, EXIT_DIFF,   // 常數
SyncError, ERR,                                     // 錯誤框架
readJson, writeJsonSafe,                            // FS 工具
printSectionDivider, printStatusLine,              // 顯示工具
col                                                 // ANSI 色碼
```

替代方案：`skills.js` 直接 require `sync.js`。拒絕——造成反向耦合與潛在循環依賴，與 `safety-check.js` 既定鐵律不一致，測試也較難隔離。

### Decision 3: 純函式測試可選配集中到 `test/skills.test.js`

`computeSkillsDiff`／`validateSkillName`／`validateSkillSource`／`parseSkillSource`／`sanitizeForTerminal` 皆為純函式，適合對稱 `toml-reader.test.js` 集中到新 `test/skills.test.js`。現有散在 `sync.test.js`／`apply-integration.test.js`／`boundary.test.js` 的 skills 覆蓋維持不動即可通過；是否搬移為整理性選項，不影響行為正確性。

替代方案：完全不動測試分布。可行，但錯過與既有模組測試結構對齊的機會；列為選配。

## Risks / Trade-offs

- **sandbox 漏複製 `skills.js`** → 三處 runtime 檔清單（`diff-integration`／`apply-integration` 的 `SYNC_RUNTIME_FILES`、`boundary` 的 `SAFETY_RUNTIME_FILES`）任一漏加，整合測試在 tmp repo `Cannot find module './skills.js'` 直接 fail——此為安全網而非風險，漏改即紅燈。
- **注入清單漂移**（如日後 skills 新增對某工具的依賴未注入）→ 以 DI object 明確列出，`skills.js` 不 require `sync.js` 使遺漏在 require 期即暴露。
- **`readJson` vs `readJsonSafe` 誤注入** → body 實測用的是 `readJson`；注入時須照實對應，避免行為（例外包裝）差異。
- **`COMMANDS` ↔ `runCommand` drift-guard** → 指令名稱／別名／說明不變，僅 case body 改呼叫 singleton，既有 drift-guard 測試續綠即證分派完整。
- **文件仍宣稱「skills 邏輯在 sync.js」** → 更新 CLAUDE.md／AGENTS.md／README 架構段與「測試策略」檔數敘述。

## Open Questions

- 是否要把 `sanitizeForTerminal`（terminal log injection 防禦）留在 `skills.js` 私有，或未來若他處也需清洗控制字元再提升為共用工具？目前只有 skills 使用，先留私有。
- `test/skills.test.js` 是否本 change 一併建立，或留待後續整理？建議一併建立以對齊模組測試結構，但不阻擋核心拆分。
