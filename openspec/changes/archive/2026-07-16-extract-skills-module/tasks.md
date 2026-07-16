## 1. 房客歸位（step 0）

- [x] 1.1 將 `printVersion`、`runHelp` 從「Skills Handler」banner 段移到 CLI/Main 段，確認兩者仍正常被 `--version`／`help` 路徑呼叫。
- [x] 1.2 確認移動後「Skills Handler」段只剩 9 個純 skills 函式。

## 2. 模組邊界拆分（step 1）

- [x] 2.1 新增 `skills.js`，承載 `loadSkillsFromLock`、`computeSkillsDiff`、`sanitizeForTerminal`、`runSkillsDiff`、`validateSkillName`、`validateSkillSource`、`parseSkillSource`、`runSkillsAdd`、`runSkillsRemove`。
- [x] 2.2 `skills.js` 匯出 `createSkillsHandler(deps)`，回傳對外 `{ runSkillsDiff, runSkillsAdd, runSkillsRemove }`；其餘 6 函式為模組內私有。`fs`／`path` 由本檔自 require。
- [x] 2.3 `skills.js` **不反向 require `sync.js`**；共用工具與常數以 deps object 注入（`REPO_ROOT`、`LOCAL_SKILL_LOCK`、`EXIT_OK`、`EXIT_DIFF`、`SyncError`、`ERR`、`readJson`、`writeJsonSafe`、`printSectionDivider`、`printStatusLine`、`col`）。
- [x] 2.4 `sync.js` 以 lazy singleton 建立 handler（照 `_safetyChecker` 樣式），`runCommand` 的 `skills:diff`／`skills:add`／`skills:remove` 三 case 改呼叫 singleton 方法。
- [x] 2.5 保持 `npm run skills:*` 與 `node sync.js skills:*` 對外入口、指令名稱與別名（`sd`／`sa`／`sr`）不變。

## 3. 行為不變驗證

- [x] 3.1 確認 `skills:diff` 三向集合差輸出、建議指令（`npx skills add/remove`、`npm run skills:add`）與 `sanitizeForTerminal` 清洗行為不變。
- [x] 3.2 確認 `skills:add`／`skills:remove` 對 `skills-lock.json` 的讀寫、重複偵測、name/source 驗證與 exit code 不變。
- [x] 3.3 更新三處 sandbox runtime 檔清單加入 `skills.js`：`test/diff-integration.test.js` 與 `test/apply-integration.test.js` 的 `SYNC_RUNTIME_FILES`、`test/boundary.test.js` 的 `SAFETY_RUNTIME_FILES`。
- [x] 3.4（選配）新增 `test/skills.test.js`，集中 `computeSkillsDiff`／`validateSkillName`／`validateSkillSource`／`parseSkillSource`／`sanitizeForTerminal` 純函式測試。

## 4. 文件與檢查

- [x] 4.1 更新 CLAUDE.md／AGENTS.md「架構重點」段，描述 `skills.js` 為獨立模組、反向 require 禁令、DI 注入邊界。
- [x] 4.2 更新「測試策略」敘述的模組／測試檔數（六檔 → 含 `skills.js`／`test/skills.test.js`）。
- [x] 4.3 更新 README 若有模組結構或架構描述處。
- [x] 4.4 執行 `npm test`，確認全數通過。
- [x] 4.5 執行 `npm run safety:check`，確認無回歸。
- [x] 4.6 執行 `openspec validate "extract-skills-module" --type change --json` 或等效檢查。
