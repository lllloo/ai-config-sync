# skills-lock-mutation Specification

## Purpose
定義 `skills:add`／`skills:remove` 對 repo `skills-lock.json`（本 repo 唯一修改版控 manifest 的寫入路徑）的變更契約：引數解析兩形態（`skills.sh` URL 與 `<name> <source>`）、`skills:add` 無覆寫冪等、lock 檔缺失時初始化與 `skills` 欄位結構正規化、`skills:remove` 對缺項為 no-op、缺 lock 檔拋 `FILE_NOT_FOUND`、所有寫入經 `writeJsonSafe` 為 atomic，並明確不重新排序 key。與 `skills-lock-diff`（唯讀比對＋終端注入驗證）互補一寫一讀；終端注入驗證的規範本體歸 `skills-lock-diff`，本規格指涉而不重述。
## Requirements
### Requirement: skills:add 引數解析支援兩種來源形態

系統 SHALL 由 `parseSkillSource` 解析 `skills:add` 的來源引數，支援兩種形態：（1）單一 `https://skills.sh/<org>/<repo>/<skill>` URL，解析出 `name` 為 `<skill>`、`source` 為 `<org>/<repo>`；（2）`<name> <source>` 兩個位置引數。未提供任何引數、URL 去除前綴後路徑段數少於 3、或只給一個非 URL 引數時，系統 SHALL 拋 `INVALID_ARGS` 並附用法提示。解析所得的 `name`／`source` SHALL 先經 `validateSkillName`／`validateSkillSource`（注入驗證，規範見 `skills-lock-diff`）通過後才採用。

#### Scenario: skills.sh URL 解析出 name 與 source
- **WHEN** 執行 `skills:add https://skills.sh/acme/tools/foo`
- **THEN** 系統 SHALL 解析出 `name` 為 `foo`、`source` 為 `acme/tools`

#### Scenario: 兩位置引數形態
- **WHEN** 執行 `skills:add foo acme/tools`
- **THEN** 系統 SHALL 以 `name` 為 `foo`、`source` 為 `acme/tools` 採用

#### Scenario: 引數不足或 URL 段數不足報錯
- **WHEN** 未提供引數，或提供的 skills.sh URL 去除前綴後路徑段數少於 3
- **THEN** 系統 SHALL 拋 `INVALID_ARGS`，MUST NOT 寫入 lock 檔

### Requirement: skills:add 為無覆寫冪等

系統對 `skills:add` SHALL 採無覆寫語義：當目標 `name` 已存在於 `skills-lock.json` 時，系統 SHALL 印出既有 `source` 與「須人工編輯以更新來源」提示、保留原紀錄不動，並以 `EXIT_OK` 返回；MUST NOT 靜默覆寫既有來源。當 `name` 不存在時，系統 SHALL 以 `{source, sourceType:'github'}` 形態寫入該筆並以 `EXIT_OK` 返回。

#### Scenario: 新 name 寫入
- **WHEN** 對不存在於 lock 的 `name` 執行 `skills:add`
- **THEN** 系統 SHALL 於 `skills.<name>` 寫入 `{source, sourceType:'github'}`，並輸出安裝指令建議

#### Scenario: 既有 name 不被覆寫
- **WHEN** 對已存在於 lock 的 `name` 執行 `skills:add`（即使 source 不同）
- **THEN** 系統 SHALL 保留既有紀錄不動、印出既有 source 與人工編輯提示、以 `EXIT_OK` 返回

### Requirement: lock 檔初始化與結構正規化

系統執行 `skills:add` 時，若 `skills-lock.json` 不存在 SHALL 以 `{version:1, skills:{}}` 初始化；若檔案存在但 `skills` 欄位缺失或型別錯誤（非物件、為 null 或為陣列），SHALL 於寫入前正規化為 `{}`，避免破壞既有其他欄位。系統 SHALL NOT 對 `skills` 物件的 key 重新排序，寫入後 key 沿用既有插入順序。

#### Scenario: lock 檔不存在時初始化
- **WHEN** `skills-lock.json` 不存在時執行 `skills:add`
- **THEN** 系統 SHALL 建立含 `version:1` 與新增 skill 的 lock 檔

#### Scenario: skills 欄位型別異常時正規化
- **WHEN** `skills-lock.json` 存在但 `skills` 欄位為陣列或非物件
- **THEN** 系統 SHALL 於寫入前將 `skills` 正規化為物件，不因異常型別中止

### Requirement: skills:remove 冪等且具缺檔前置檢查

系統對 `skills:remove` SHALL 要求提供 `name` 引數，缺引數或 `name` 格式非法時 SHALL 拋 `INVALID_ARGS`。當 `skills-lock.json` 不存在時 SHALL 拋 `FILE_NOT_FOUND`。當 `name` 不在 lock 中時 SHALL 為 no-op、印出提示並以 `EXIT_OK` 返回；當 `name` 存在時 SHALL 刪除該筆並以 `EXIT_OK` 返回，同時輸出從本機移除的建議指令。

#### Scenario: 移除存在的 skill
- **WHEN** 對存在於 lock 的 `name` 執行 `skills:remove`
- **THEN** 系統 SHALL 從 `skills` 刪除該 key 並輸出 `npx skills remove <name> -g -y` 建議

#### Scenario: 移除不存在的 skill 為 no-op
- **WHEN** 對不在 lock 中的 `name` 執行 `skills:remove`
- **THEN** 系統 SHALL 不修改 lock 檔、印出提示、以 `EXIT_OK` 返回

#### Scenario: 缺 lock 檔時報錯
- **WHEN** `skills-lock.json` 不存在時執行 `skills:remove`
- **THEN** 系統 SHALL 拋 `FILE_NOT_FOUND`

### Requirement: lock 檔寫入為 atomic

系統對 `skills-lock.json` 的所有寫入（`skills:add` 新增、`skills:remove` 刪除）SHALL 經注入的 `writeJsonSafe`（先寫同目錄暫存檔再 rename）完成，提供原子性避免半截損壞，與同步核心的寫入路徑一致。

#### Scenario: 變更經 atomic write 落盤
- **WHEN** `skills:add` 或 `skills:remove` 需寫入 lock 檔
- **THEN** 系統 SHALL 經 `writeJsonSafe` 以暫存檔加 rename 方式寫入，MUST NOT 就地半途覆寫

