## Why

`skills:add` 與 `skills:remove` 會**寫入** repo 的 `skills-lock.json`，其變更語義（引數解析的兩種形態、已存在時不覆寫的冪等、lock 檔缺失時初始化、移除缺項為 no-op、缺 lock 檔報錯、atomic write）目前只存在於程式碼與 CLAUDE.md，OpenSpec 沒有規格捕捉。現有 `skills-lock-diff` spec 只規範**唯讀比對**（`skills:diff`）與終端注入驗證；`core-sync-cli` 規範分派；`skills-module-boundary` 規範邏輯位置——三者都不規範這兩個指令**改動 lock 檔的契約**。這是本 repo 唯一會修改版控 manifest 的寫入路徑，值得有明確被依賴規格。此 change 延續 backfill 慣例，把既有且已測試的變更語義補進規格，不改任何程式碼。

## What Changes

- 新增一份 capability spec，把 `skills:add`／`skills:remove` 既有變更語義規格化：
  - **引數解析兩形態**（`parseSkillSource`）：`https://skills.sh/<org>/<repo>/<skill>` URL（解析出 `name=<skill>`、`source=<org>/<repo>`）與 `<name> <source>` 位置引數；引數不足或 URL 段數不足 SHALL 拋 `INVALID_ARGS`。
  - **`skills:add` 無覆寫冪等**：name 已存在時 SHALL 印既有 source 並保留不動、以 `EXIT_OK` 返回（更新來源須人工編輯），MUST NOT 靜默覆寫。
  - **lock 檔初始化與結構正規化**：`skills-lock.json` 不存在時以 `{version:1, skills:{}}` 初始化；`skills` 欄位缺失或型別錯誤（非物件／陣列）時正規化為 `{}`。新增項寫入形態為 `{source, sourceType:'github'}`。
  - **`skills:remove` 冪等與前置**：缺 name 引數或 name 格式非法 SHALL 拋 `INVALID_ARGS`；`skills-lock.json` 不存在 SHALL 拋 `FILE_NOT_FOUND`；name 不在 lock 中 SHALL 為 no-op 並以 `EXIT_OK` 返回。
  - **atomic write**：寫入經注入的 `writeJsonSafe`（先寫暫存檔再 rename），與同步核心一致。
  - 明確標示**不重新排序** key（沿用物件既有插入順序），避免規格誤導。
- 終端注入驗證（`validateSkillName`／`validateSkillSource`／`sanitizeForTerminal`）已由 `skills-lock-diff` spec 規範，本 spec **指涉而不重述**，只在 scenario 標明驗證作為前置。
- **不改任何程式碼、測試或既有 spec**——純規格回填。

## Capabilities

### New Capabilities
- `skills-lock-mutation`: `skills:add`／`skills:remove` 對 repo `skills-lock.json` 的變更契約——引數解析兩形態、add 無覆寫冪等、lock 檔初始化與結構正規化、remove 冪等與缺檔前置、atomic write，以及不重新排序 key 的語義。

### Modified Capabilities
<!-- 無。注入驗證仍歸 skills-lock-diff；本 change 為既有寫入語義的新增回填，不改現有需求。 -->

## Impact

- **規格**：新增 `openspec/specs/skills-lock-mutation/spec.md`（歸檔後）。與 `skills-lock-diff`（唯讀比對＋注入驗證）互補：一寫一讀，共享同一份 lock 檔契約。
- **程式碼**：無變更。`skills.js` 為 single source of truth。
- **測試**：無變更。`test/skills.test.js`（deps-bound helper 經 `createSkillsHandler` 注入測試）已涵蓋 `parseSkillSource`／驗證等，作為規格的可執行對照。
- **文件**：本 repo 唯一修改版控 manifest 的寫入路徑，自此有明確被依賴規格可指涉。
