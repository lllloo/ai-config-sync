# skills-module-boundary Specification

## Purpose
定義 `skills.js`（skills 指令族模組）的職責邊界與依賴方向：lock 檔讀取、三向集合差、name/source 驗證、terminal 清洗與輸出格式化集中於本模組，`sync.js` 只保留 command dispatch、依賴注入與 exit code 對接的薄層；模組 SHALL NOT 反向 require `sync.js`，共用常數與工具一律經 `createSkillsHandler(deps)` 注入。同時鎖定拆檔後的對外穩定性——指令名稱、別名（`sd`／`sa`／`sr`）、建議指令輸出與 exit code 語意不變——並要求整合測試沙箱的 runtime 檔清單同時包含 `sync.js`、`safety-check.js`、`toml-reader.js` 與 `skills.js`，確保沙箱不依賴真實 HOME。
## Requirements
### Requirement: skills 指令邏輯位於獨立模組

系統 SHALL 將 skills 指令族的 lock 檔讀取、三向集合差計算、name/source 驗證、terminal 清洗與輸出格式化邏輯集中於獨立 skills 模組，而非實作於 `sync.js` 的主要同步流程區段中。

#### Scenario: skills 模組承載指令邏輯
- **WHEN** 維護者檢視 `skills:diff`／`skills:add`／`skills:remove` 的讀取、比對與輸出邏輯
- **THEN** 相關函式 SHALL 位於 skills 專用模組
- **AND** `sync.js` SHALL 只保留 command dispatch、依賴注入與 exit code 對接所需的薄層邏輯

#### Scenario: CLI 房客不混入 skills 模組
- **WHEN** 維護者檢視被抽出的 skills 模組
- **THEN** 該模組 SHALL NOT 包含 `printVersion`／`runHelp` 等屬於 CLI/Main 的函式

### Requirement: skills 模組不反向依賴同步核心

系統 SHALL 使 skills 模組不反向 require `sync.js`；共用常數與工具 SHALL 以依賴注入方式（deps object）傳入。

#### Scenario: 以依賴注入取得共用工具
- **WHEN** skills 模組需要 `REPO_ROOT`、`LOCAL_SKILL_LOCK`、exit code 常數、`SyncError`／`ERR`、檔案讀寫、顯示與色彩工具
- **THEN** 這些依賴 SHALL 由 `sync.js` 透過工廠函式（如 `createSkillsHandler(deps)`）注入
- **AND** skills 模組 SHALL NOT 直接 `require('./sync.js')`

### Requirement: skills 對外入口與行為保持穩定

系統 SHALL 保持既有 `npm run skills:diff`／`skills:add`／`skills:remove` 與 `node sync.js skills:*` 入口可用，且拆出模組後 SHALL 保持指令名稱、別名（`sd`／`sa`／`sr`）、輸出、建議指令與 exit code 語意不變。

#### Scenario: CLI 入口與別名不變
- **WHEN** 使用者執行 `npm run skills:diff` 或使用別名 `sd`
- **THEN** 系統 SHALL 透過既有 `sync.js` 指令分派執行 skills diff
- **AND** 使用者 SHALL NOT 需要改用新的指令或直接呼叫模組檔案

#### Scenario: skills 行為不變
- **WHEN** 給定與拆檔前相同的 `skills-lock.json` 與 `~/.agents/.skill-lock.json` 輸入
- **THEN** 系統 SHALL 產生相同的三向集合差與建議指令輸出
- **AND** `skills:diff` 的 exit code SHALL 維持一致（有差異為 1、一致為 0）
- **AND** name/source 驗證與 terminal 控制字元清洗行為 SHALL 不變

### Requirement: 測試沙箱包含 skills runtime 檔案

系統 SHALL 更新會複製 `sync.js` 到臨時 repo 的整合測試，使其同時包含 skills 指令執行所需的 runtime 模組檔案。

#### Scenario: sandbox 中執行 skills 指令
- **WHEN** 整合測試在臨時 repo 中執行需要 skills 模組的路徑
- **THEN** 該臨時 repo SHALL 包含 skills 模組檔案
- **AND** 相關 sandbox 的 runtime 檔清單 SHALL 同時列出 `sync.js`、`safety-check.js`、`toml-reader.js` 與 skills 模組檔案
