## MODIFIED Requirements

### Requirement: skills:diff 直讀原生 lock 檔以規避 npx 共管誤報

系統 SHALL 直接讀取 `~/.agents/.skill-lock.json` 作為本機安裝來源，MUST NOT 以 `npx skills list -g` 取代——lock 檔是「哪些 skill 由 `npx skills` 安裝」的唯一權威；`list -g` 會掃描目錄，把非 lock 登記的住戶（如手動放入的 skill、其他工具的探索 symlink）一併列入，造成誤報。

#### Scenario: 不使用 npx skills list -g
- **WHEN** `skills:diff` 判定本機已安裝清單
- **THEN** 系統 SHALL 以 `~/.agents/.skill-lock.json` 為準，MUST NOT 呼叫 `npx skills list -g`

#### Scenario: 自寫全域 skill 與外部 skill 同列
- **WHEN** `skills-lock.json` 同時登記本 repo 自寫的全域 skill（source 為本 repo）與外部 skill
- **THEN** `skills:diff` SHALL 以相同規則比對兩者，不因 source 為本 repo 而特殊處理
