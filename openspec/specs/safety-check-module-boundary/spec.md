# safety-check-module-boundary Specification

## Purpose
定義 `safety-check.js`（安全掃描模組）的職責邊界與依賴方向：掃描範圍收集、text pattern 掃描、結構化 key path 掃描、issue 產生與 report 格式化集中於本模組，`sync.js` 只保留 CLI dispatch、依賴注入與 exit code 對接的薄層；共用工具經 `createSafetyChecker(deps)` 注入，TOML 解析則直接 require `toml-reader.js`（純函式、零 IO，非 `sync.js` 故不違反反向 require 禁令）。同時鎖定拆檔後的對外穩定性——掃描範圍、hard block／warning 分類、輸出遮罩與 exit code 語意（clean 0／warning 1／hard block 2）不變——並要求整合測試沙箱的 runtime 檔清單同時包含 `sync.js`、`safety-check.js`、`toml-reader.js` 與 `skills.js`。
## Requirements
### Requirement: safety check 邏輯位於獨立模組

系統 SHALL 將 `safety:check` 的掃描範圍收集、文字掃描、結構化 key path 掃描、issue 產生與 report 格式化邏輯集中於獨立 safety check 模組，而非直接實作於 `sync.js` 的主要同步流程區段中。

#### Scenario: safety check 模組承載掃描邏輯
- **WHEN** 維護者檢視 safety check 的 hard block 與 warning 判斷
- **THEN** 相關掃描與 issue 產生邏輯 SHALL 位於 safety check 專用模組
- **AND** `sync.js` SHALL 只保留 CLI dispatch、依賴注入與 exit code 對接所需的薄層邏輯

### Requirement: safety check 對外入口與行為保持穩定

系統 SHALL 保持既有 `npm run safety:check` 與 `node sync.js safety:check` 入口可用，且拆出模組後 SHALL 保持既有掃描範圍、hard block、warning、安全輸出與 exit code 語意不變。

#### Scenario: CLI 入口不變
- **WHEN** 使用者執行 `npm run safety:check`
- **THEN** 系統 SHALL 透過既有 `sync.js safety:check` 指令執行安全檢查
- **AND** 使用者 SHALL NOT 需要改用新的指令或直接呼叫模組檔案

#### Scenario: safety check 行為不變
- **WHEN** 同步來源含有與拆檔前相同的 hard block 或 warning 輸入
- **THEN** 系統 SHALL 回報相同嚴重度分類
- **AND** exit code SHALL 維持 clean 為 0、只有 warning 為 1、任一 hard block 為 2
- **AND** 輸出 SHALL 仍不得顯示 env 值、secret 原值或完整 HOME 路徑

### Requirement: 測試沙箱包含 safety check runtime 檔案

系統 SHALL 更新會複製 `sync.js` 到臨時 repo 的整合測試，使其同時包含 safety check 指令執行所需的 runtime 模組檔案。

#### Scenario: sandbox 中執行 safety check
- **WHEN** 整合測試在臨時 repo 中執行 `node sync.js safety:check`
- **THEN** 該臨時 repo SHALL 包含 safety check 模組檔案
- **AND** 測試 SHALL 驗證 hard block、warning、輸出遮罩與 exit code 仍符合既有行為

