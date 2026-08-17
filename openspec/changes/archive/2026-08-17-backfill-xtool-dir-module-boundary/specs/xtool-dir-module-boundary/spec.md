## Purpose

定義 `xtool-dir.js`（跨工具全域 skill 同步型別模組）的職責邊界與依賴方向，使 `xtool-dir` 型的型別專屬邏輯與 `sync.js` 的通用能力維持分離，並鎖定拆檔後的對外契約與測試沙箱的 runtime 檔清單。

## ADDED Requirements

### Requirement: xtool-dir 型別邏輯位於獨立模組

系統 SHALL 將 `xtool-dir` 型的型別專屬邏輯——受管名字集合、npx 撞名判準、非 prune upsert、探索點橋接與其安全閘門、diff entry 構造——集中於獨立的 xtool-dir 模組，而非實作於 `sync.js` 的主要同步流程區段中。

#### Scenario: xtool-dir 模組承載型別專屬邏輯
- **WHEN** 維護者檢視受管名字判定、撞名守門、非 prune upsert 或探索點橋接的實作
- **THEN** 相關函式 SHALL 位於 xtool-dir 專用模組
- **AND** `sync.js` SHALL 只保留 type switch 分派、依賴注入與共用工具所需的薄層邏輯

#### Scenario: CLI 房客不混入 xtool-dir 模組
- **WHEN** 維護者檢視被抽出的 xtool-dir 模組
- **THEN** 該模組 SHALL NOT 包含指令分派、引數解析或說明輸出等屬於 CLI/Main 的函式

### Requirement: xtool-dir 模組不反向依賴同步核心

系統 SHALL 使 xtool-dir 模組不反向 require `sync.js`；共用常數與工具 SHALL 以依賴注入方式（deps object）傳入。

#### Scenario: 以依賴注入取得共用常數與工具
- **WHEN** xtool-dir 模組需要三個 skill 根路徑、npx lock 路徑、全域排除清單、目錄比對與鏡射工具、symlink 工具、錯誤型別與顯示工具
- **THEN** 這些依賴 SHALL 由 `sync.js` 透過工廠函式（如 `createXtoolDir(deps)`）注入
- **AND** xtool-dir 模組 SHALL NOT 直接 `require('./sync.js')`

#### Scenario: 注入不得破壞其他模組的延後建立
- **WHEN** xtool-dir 模組需要讀取 npx lock 檔的能力，而該能力由 skills 模組提供
- **THEN** 該依賴 SHALL 以延後求值的包裝函式注入，而非直接注入 skills 模組實體
- **AND** 建立 xtool-dir handler SHALL NOT 強制實體化 skills handler

### Requirement: 通用檔案系統工具留在同步核心

系統 SHALL 將通用檔案系統能力——symlink 建立與修復、lstat 包裝、目錄鏡射、檔案列舉、目錄比對、項目標籤——保留於 `sync.js`，SHALL NOT 因目前唯一消費者為 xtool-dir 型而搬入該模組。

#### Scenario: 通用工具不隨型別邏輯搬移
- **WHEN** 維護者重構或擴充 xtool-dir 型的行為
- **THEN** 通用檔案系統工具 SHALL 仍位於 `sync.js` 並以依賴注入提供
- **AND** 型別專屬邏輯與通用工具 SHALL NOT 混居於同一模組

### Requirement: xtool-dir 對外契約保持穩定

系統 SHALL 使 xtool-dir 模組對 `sync.js` 的 type switch 曝露 diff 與 apply 兩個進入點；其餘經注入綁定的輔助函式 SHALL 僅供 `sync.js` re-export 與單元測試作為 seam 使用，SHALL NOT 由型別分派直接呼叫。

#### Scenario: type switch 只經兩個進入點
- **WHEN** `sync.js` 對 `xtool-dir` 型項目執行 diff 或 apply
- **THEN** 分派 SHALL 只呼叫該模組的 diff 與 apply 兩個進入點
- **AND** `xtool-dir` 型的行為 SHALL NOT 依賴其與任何其他同步項的相對順序

#### Scenario: 部分失敗可見度不因拆檔而遺失
- **WHEN** xtool-dir 型的 apply 中途拋出錯誤，且先前已完成的 skill 與當前 skill 內部都有已寫入的變更
- **THEN** 兩邊的已完成變更 SHALL 一併併入部分變更清單並被呈報
- **AND** 任一邊 SHALL NOT 被另一邊覆寫而失去可見度

### Requirement: 測試沙箱包含 xtool-dir runtime 檔案

系統 SHALL 使會複製 `sync.js` 到臨時 repo 的整合測試同時包含 xtool-dir 模組檔案，確保沙箱不依賴真實 HOME 且任一指令路徑不因缺檔而崩潰。

#### Scenario: sandbox 中執行需要 xtool-dir 的路徑
- **WHEN** 整合測試在臨時 repo 中執行任一 `node sync.js` 指令
- **THEN** 該臨時 repo SHALL 包含 xtool-dir 模組檔案
- **AND** 相關 sandbox 的 runtime 檔清單 SHALL 同時列出 `sync.js`、`safety-check.js`、`toml-reader.js`、skills 模組檔案與 xtool-dir 模組檔案
