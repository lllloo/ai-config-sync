## Why

`extract-safety-check-module` 與 `extract-codex-config-module`（後為 `toml-reader.js`）已示範把內聚職責從 `sync.js` 抽成獨立、可注入、可獨立測試的模組。skills 指令族（`skills:diff`／`skills:add`／`skills:remove`）是 `sync.js` 內**耦合度最低、最自成一體**的一段：它只讀 `skills-lock.json` 與 `~/.agents/.skill-lock.json` 做集合比對並輸出建議指令，不參與 `file`／`dir`／`settings` 的同步核心，也不掃 `agents/skills/` 目錄。

此段目前物理上仍留在 `sync.js`（2591 行 monolith）的「Skills Handler」banner 區。抽成 `skills.js` 可再降 `sync.js` 約 240 行、讓職責邊界與既有兩個模組一致，並延續「函式 ≤ 60 行、單檔不無限膨脹」的紀律。

## What Changes

- 將 skills 指令族的 9 個純函式（`loadSkillsFromLock`、`computeSkillsDiff`、`sanitizeForTerminal`、`runSkillsDiff`、`validateSkillName`、`validateSkillSource`、`parseSkillSource`、`runSkillsAdd`、`runSkillsRemove`）從 `sync.js` 抽到獨立模組 `skills.js`。
- **先做房客歸位**：現位於「Skills Handler」banner 段尾、但實屬 CLI 的 `printVersion`／`runHelp` 移回 CLI/Main 段，使被抽出的區塊為純 skills。
- `skills.js` **不反向 require `sync.js`**：共用常數與工具（`REPO_ROOT`、`LOCAL_SKILL_LOCK`、`EXIT_OK`／`EXIT_DIFF`、`SyncError`／`ERR`、`readJson`／`writeJsonSafe`、`printSectionDivider`／`printStatusLine`、`col`）以 `createSkillsHandler(deps)` DI 注入，`fs`／`path` 由本檔自 require。
- `sync.js` 端以 lazy singleton 建立 handler；`runCommand` 的 `skills:diff`／`skills:add`／`skills:remove` 三個 switch case 改呼叫 singleton 方法，**指令名稱／別名／分派不變**。
- 保持 `npm run skills:diff`／`skills:add`／`skills:remove` 與 `node sync.js skills:*` 對外入口與行為完全不變。
- 更新測試沙箱：三處 runtime 檔清單（`diff-integration`／`apply-integration` 的 `SYNC_RUNTIME_FILES`、`boundary` 的 `SAFETY_RUNTIME_FILES`）加入 `skills.js`。
- 更新 CLAUDE.md／AGENTS.md／README 的「架構重點」與「測試策略」描述，納入 `skills.js` 模組與其反向 require 禁令。

## Capabilities

### New Capabilities
- `skills-module-boundary`：定義 skills 指令族的模組邊界、對外入口穩定性、反向 require 禁令與行為不變要求。

### Modified Capabilities
- 無。`skills:diff`／`skills:add`／`skills:remove` 的需求語意不變；本 change 只改實作邊界。

## Impact

- 影響 `sync.js`：移出 skills 掃描／驗證／輸出細節，保留 command dispatch 與 exit code 對接；`printVersion`／`runHelp` 歸位到 CLI/Main 段。
- 新增 `skills.js` 模組檔案（零外部相依，只用 Node.js 內建 + 注入依賴）。
- 影響 `test/diff-integration.test.js`、`test/apply-integration.test.js`、`test/boundary.test.js` 的 sandbox runtime 檔清單；skills 純函式測試可選配集中到新 `test/skills.test.js`（對稱 `toml-reader.test.js`）。
- 影響 README、AGENTS、CLAUDE 的架構描述。
- 不新增外部 npm 相依，不改任何對外指令、別名或行為。

## Dependency

- 無硬性前置。以現行 `skills:*` 行為為基線；`cross-tool-global-skills` 已歸檔，`agents/skills/` 相關語意穩定。
