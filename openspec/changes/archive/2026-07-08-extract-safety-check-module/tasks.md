## 1. 模組邊界拆分

- [x] 1.1 新增 safety check 專用模組檔案，承載掃描範圍收集、文字掃描、結構化 key path 掃描、issue 產生與 report 格式化邏輯。
- [x] 1.2 調整 `sync.js` 的 `safety:check` command，使其只負責 CLI dispatch、依賴注入、report 呼叫與 exit code 對接。
- [x] 1.3 避免 `safety-check.js` 反向 require `sync.js`；共用工具與常數以簡單 deps object 或明確匯出方式傳入。
- [x] 1.4 保持 `npm run safety:check` 與 `node sync.js safety:check` 對外入口不變。

## 2. 行為不變驗證

- [x] 2.1 確認拆檔後掃描範圍仍為 `claude/`、`codex/`、`skills-lock.json`，且仍不掃 `test/`、`openspec/`、README 等非同步來源文件。
- [x] 2.2 確認 hard block 偵測、warning 偵測、輸出遮罩與 exit code 語意與拆檔前一致。
- [x] 2.3 更新整合測試 sandbox setup，使臨時 repo 同時包含 `sync.js` 與 safety check 模組檔案。
- [x] 2.4 補充或調整測試，覆蓋 `node sync.js safety:check` 在 sandbox 中仍可正常執行。

## 3. 文件與檢查

- [x] 3.1 更新 README 的架構描述，移除或修正「所有邏輯在 sync.js」的單檔說法。
- [x] 3.2 更新 AGENTS/CLAUDE 專案指引，描述 `sync.js` 為主入口、safety check 為獨立模組。
- [x] 3.3 執行 `npm test`，確認全數通過。
- [x] 3.4 執行 `openspec validate "extract-safety-check-module" --type change --json` 或等效 OpenSpec 檢查。
