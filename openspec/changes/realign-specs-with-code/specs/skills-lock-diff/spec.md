## MODIFIED Requirements

### Requirement: skills:diff 只輸出建議指令、不執行

系統 SHALL 對 `onlyInRepo`（repo 有、本機未裝）輸出 `npx skills add ... -g -y --skill <name>` 建議；對 `onlyInLocal`（本機有、repo 未記錄）同時輸出兩種選項——（A）`npm run skills:add -- <name> <source>` 加入 repo 紀錄、（B）`npx skills remove <name> -g -y` 從本機移除。系統 SHALL 只印出這些指令供人工執行，MUST NOT 代為執行。

建議指令的輸出 SHALL NOT 因來源資訊不全而整條缺席：`skills-lock.json` 中某項目缺少 `source` 欄位時，系統 SHALL 仍輸出建議指令並以佔位符（如 `<source>`）標示待補欄位，比照 `onlyInLocal` 分支既有作法。兩個分支對資訊不全的處理 SHALL 對稱——出現在狀態行的每個 skill SHALL 都有對應的下一步指令，MUST NOT 讓使用者看得到差異卻無從行動。

#### Scenario: repo 有本機未裝時建議安裝
- **WHEN** 某 skill 僅存在於 repo 的 `skills-lock.json`
- **THEN** 系統 SHALL 輸出對應的 `npx skills add` 指令，且不代為安裝

#### Scenario: 本機多裝時提供加入或移除兩選項
- **WHEN** 某 skill 僅存在於本機 lock
- **THEN** 系統 SHALL 同時輸出（A）加入 repo 與（B）從本機移除兩種建議指令

#### Scenario: lock 項目缺 source 仍輸出建議
- **WHEN** 某 skill 僅存在於 repo 的 `skills-lock.json`，但該項目缺少 `source` 欄位
- **THEN** 系統 SHALL 仍輸出 `npx skills add` 建議指令，並以 `<source>` 佔位符標示待補的來源
- **AND** 該 skill MUST NOT 只出現在狀態行而無任何建議指令
