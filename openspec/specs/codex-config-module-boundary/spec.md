# codex-config-module-boundary Specification

## Purpose
TBD - created by syncing change extract-codex-config-module. Update Purpose after archive.
## Requirements
### Requirement: Codex config 過濾同步邏輯位於獨立模組

系統 SHALL 將 Codex `config.toml` 的 TOML parse／serialize、可攜欄位判斷、方向相依 merge、load／get 與 apply 進出口邏輯，以及其專屬常數，集中於獨立 Codex config 模組，而非直接實作於 `sync.js` 的同步流程區段中。

#### Scenario: Codex config 模組承載轉換與合併邏輯
- **WHEN** 維護者檢視 Codex config 的可攜欄位過濾與方向相依合併
- **THEN** 相關 parse／serialize／merge／apply 邏輯與常數 SHALL 位於 Codex config 專用模組
- **AND** `sync.js` SHALL 只保留型別分派、diff 渲染與對模組的呼叫

#### Scenario: 模組不反向依賴同步核心
- **WHEN** 載入 Codex config 模組
- **THEN** 該模組 SHALL NOT `require` `sync.js`
- **AND** 其對共用工具的依賴 SHALL 經由明確注入或純函式參數傳入

### Requirement: Codex config 對外同步行為保持不變

系統 SHALL 在拆出模組後，保持 `to-repo`、`to-local`、`diff`、`status` 對 `codex/config.toml` 的既有行為不變，包含可攜欄位白名單過濾、方向相依合併與保留本機未受管理欄位。

#### Scenario: to-repo 只寫入可攜欄位
- **WHEN** 使用者對含裝置特定與未知欄位的本機 `config.toml` 執行 `to-repo`
- **THEN** 系統 SHALL 僅將可攜欄位寫入 repo
- **AND** 裝置特定與未知欄位 SHALL NOT 進入 repo

#### Scenario: to-local 保留本機未受管理欄位
- **WHEN** 使用者執行 `to-local` 將 repo 的可攜欄位套用到本機
- **THEN** 系統 SHALL 只覆寫可攜欄位
- **AND** 本機未受管理欄位 SHALL 被保留

#### Scenario: diff 顯示語意不變
- **WHEN** 同步來源含與拆檔前相同的 `config.toml` 差異輸入
- **THEN** `diff`／`status` SHALL 回報相同的 direction-aware 差異狀態

### Requirement: 測試沙箱包含 Codex config runtime 檔案

系統 SHALL 更新會複製 `sync.js` 到臨時 repo 的整合測試，使其同時包含執行 Codex config 同步所需的 runtime 模組檔案。

#### Scenario: sandbox 中執行 Codex config 同步
- **WHEN** 整合測試在臨時 repo 中對 `codex/config.toml` 執行 `to-repo` 或 `to-local`
- **THEN** 該臨時 repo SHALL 包含 Codex config 模組檔案
- **AND** 測試 SHALL 驗證可攜欄位過濾、保留本機欄位與 diff 判斷仍符合既有行為
