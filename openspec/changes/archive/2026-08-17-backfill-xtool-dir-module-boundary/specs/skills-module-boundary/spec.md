## MODIFIED Requirements

### Requirement: 測試沙箱包含 skills runtime 檔案

系統 SHALL 更新會複製 `sync.js` 到臨時 repo 的整合測試，使其同時包含 skills 指令執行所需的 runtime 模組檔案。

#### Scenario: sandbox 中執行 skills 指令
- **WHEN** 整合測試在臨時 repo 中執行需要 skills 模組的路徑
- **THEN** 該臨時 repo SHALL 包含 skills 模組檔案
- **AND** 相關 sandbox 的 runtime 檔清單 SHALL 同時列出 `sync.js`、`safety-check.js`、`toml-reader.js`、skills 模組檔案與 xtool-dir 模組檔案
