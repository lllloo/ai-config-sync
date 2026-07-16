## ADDED Requirements

### Requirement: skills:diff 對兩份 lock 檔做三向集合差

系統 SHALL 提供 `skills:diff` 指令，讀取 repo 的 `skills-lock.json` 與本機 `~/.agents/.skill-lock.json`（`npx skills` CLI 的原生 lock 檔），以 `computeSkillsDiff` 計算三向集合差：僅在 repo（`onlyInRepo`）、僅在本機（`onlyInLocal`）、兩端皆有（`inBoth`）。此指令為唯讀比對，MUST NOT 修改任一 lock 檔或安裝／移除任何 skill。

#### Scenario: 分類為三向集合差
- **WHEN** 使用者執行 `node sync.js skills:diff`
- **THEN** 系統 SHALL 依兩份 lock 檔的 skill 名稱集合，將結果分為 `inBoth`／`onlyInRepo`／`onlyInLocal` 三類輸出

#### Scenario: 唯讀不改 lock
- **WHEN** 執行 `skills:diff`
- **THEN** 系統 MUST NOT 寫入 `skills-lock.json` 或 `~/.agents/.skill-lock.json`，MUST NOT 執行任何安裝／移除

### Requirement: skills:diff 只輸出建議指令、不執行

系統 SHALL 對 `onlyInRepo`（repo 有、本機未裝）輸出 `npx skills add ... -g -y --skill <name>` 建議；對 `onlyInLocal`（本機有、repo 未記錄）同時輸出兩種選項——（A）`npm run skills:add -- <name> <source>` 加入 repo 紀錄、（B）`npx skills remove <name> -g -y` 從本機移除。系統 SHALL 只印出這些指令供人工執行，MUST NOT 代為執行。

#### Scenario: repo 有本機未裝時建議安裝
- **WHEN** 某 skill 僅存在於 repo 的 `skills-lock.json`
- **THEN** 系統 SHALL 輸出對應的 `npx skills add` 指令，且不代為安裝

#### Scenario: 本機多裝時提供加入或移除兩選項
- **WHEN** 某 skill 僅存在於本機 lock
- **THEN** 系統 SHALL 同時輸出（A）加入 repo 與（B）從本機移除兩種建議指令

### Requirement: skills:diff 直讀原生 lock 檔以規避 npx 共管誤報

系統 SHALL 直接讀取 `~/.agents/.skill-lock.json` 作為本機安裝來源，MUST NOT 以 `npx skills list -g` 取代——因後者會掃描目錄並把 `sync.js` 同步管理的 `~/.claude/skills/`（如 `dir` 型與橋接 symlink）也列入，造成與 `npx skills` 共管下的誤報。

#### Scenario: 不使用 npx skills list -g
- **WHEN** `skills:diff` 判定本機已安裝清單
- **THEN** 系統 SHALL 以 `~/.agents/.skill-lock.json` 為準，MUST NOT 呼叫 `npx skills list -g`

### Requirement: skills:diff 差異回 EXIT_DIFF

系統 SHALL 在 `onlyInRepo` 或 `onlyInLocal` 任一非空時以 `EXIT_DIFF` 退出（供 CI 判讀）；兩者皆空（僅 `inBoth` 或全空）時以 `EXIT_OK` 退出。

#### Scenario: 存在單邊差異回 EXIT_DIFF
- **WHEN** `skills:diff` 發現有 skill 僅在一端
- **THEN** 系統 SHALL 以 `EXIT_DIFF` 退出

#### Scenario: 兩端一致回 EXIT_OK
- **WHEN** 本機與 repo 記錄的 skills 完全一致
- **THEN** 系統 SHALL 輸出「完全一致」並以 `EXIT_OK` 退出

### Requirement: skills 名稱與來源輸出前清洗以防注入

系統 SHALL 在輸出任何 skill 名稱與 source 到終端前經 `sanitizeForTerminal` 清洗，`skills:add` 收入時經 `validateSkillName`／`validateSkillSource` 驗證（名稱僅允許英數、底線、點、連字號），防止換行、ANSI escape 與控制字元造成 terminal log injection。

#### Scenario: 非法字元的 skill 名被拒
- **WHEN** `skills:add` 收到含控制字元或換行的名稱
- **THEN** 系統 SHALL 拋 `SyncError` 拒絕，MUST NOT 將其原樣寫入 lock 或輸出到終端
