## ADDED Requirements

### Requirement: Codex MCP 使用獨立可攜來源

系統 SHALL 以 repo `codex/mcp.json` 作為受管 Codex MCP Server 的跨裝置 source of truth，格式 SHALL 為 `{version: 1, servers: {...}}`。每個 Server SHALL 只允許 `transport`、`url`、`enabled`；`transport` MUST 為 `streamable-http`、`url` MUST 為 HTTPS、`enabled` MUST 為 boolean，未知欄位 MUST 被拒絕。

#### Scenario: 載入合法來源

- **WHEN** `codex/mcp.json` 含合法的 version 1 與 Streamable HTTP Server
- **THEN** 系統 SHALL 載入該 Server 為受管 MCP 定義

#### Scenario: 拒絕未知或敏感欄位

- **WHEN** `codex/mcp.json` 的 Server 含 `headers`、`Authorization`、token、env、client secret 或其他 schema 外欄位
- **THEN** 系統 MUST 以錯誤中止，且 MUST NOT 將該值寫入 repo、本機設定或終端輸出

#### Scenario: 拒絕非 HTTPS 遠端

- **WHEN** 受管 Server URL 不是合法 HTTPS URL
- **THEN** 系統 MUST 拒絕該來源，MUST NOT 套用至本機

### Requirement: Supermemory 為首個預設啟用項目

repo SHALL 初始包含名稱 `supermemory`、URL `https://mcp.supermemory.ai/mcp`、`transport: streamable-http`、`enabled: true` 的受管定義。該定義 MUST NOT 包含 `x-sm-project`、API Key、token 或 authorization header。

#### Scenario: 新裝置取得 Supermemory 定義

- **WHEN** 新裝置取得 repo 並執行 `to-local`
- **THEN** 本機 Codex SHALL 取得預設啟用的 Supermemory MCP 定義
- **AND** 該定義 SHALL NOT 固定任何 `x-sm-project`

### Requirement: MCP 納入既有同步命令

系統 SHALL 讓 `diff`、`status`、`to-repo` 與 `to-local` 涵蓋 `codex/mcp.json` 與本機 `~/.codex/config.toml` 的受管 MCP 差異。MCP 同步項 SHALL 由 `SYNC_MANIFEST` 宣告，並由 `diffSyncItem`／`applySyncItem` 的明確 `mcp` case 分派。

#### Scenario: diff 回報 MCP 差異

- **WHEN** repo 受管 MCP 與本機投影不同
- **THEN** `diff` SHALL 回報 Codex MCP 有差異並以 exit code `1` 結束
- **AND** 輸出 SHALL 只列 Server 名與狀態，不顯示設定值

#### Scenario: status 同時涵蓋 MCP

- **WHEN** 使用者執行 `status`
- **THEN** 設定差異半場 SHALL 包含 MCP 同步項
- **AND** skills 差異半場 SHALL 維持既有行為

#### Scenario: dry-run 無寫入

- **WHEN** 使用者執行 `to-local --dry-run`
- **THEN** 系統 SHALL 預覽 MCP 新增、更新與刪除
- **AND** MUST NOT 修改 `config.toml` 或本機受管 state

### Requirement: to-local 只合併受管 MCP sections

`to-local` SHALL 將 repo 受管 Server 投影至本機 `~/.codex/config.toml` 的 `[mcp_servers.<name>]`，並 SHALL 保留所有非 MCP 設定、註解、空白與不受管 MCP 原文。系統 MUST NOT 以 repo 來源整檔取代 `config.toml`。

#### Scenario: 保留非 MCP 設定

- **WHEN** 本機 `config.toml` 同時含 personality、features、projects、hooks 或其他非 MCP sections
- **AND** 使用者執行 `to-local`
- **THEN** 這些非 MCP 內容 SHALL 原文保留

#### Scenario: 保留不受管 MCP

- **WHEN** 本機存在未列於 repo、亦未登記於受管 state 的其他 MCP Server
- **AND** 使用者執行 `to-local`
- **THEN** 該 Server SHALL 保持不變，MUST NOT 被 prune

#### Scenario: upsert 受管 MCP

- **WHEN** repo 含一個新受管 Server，或其可攜欄位與本機同名 section 不同
- **THEN** `to-local` SHALL 新增或更新該 section
- **AND** 成功後 SHALL 將名稱記錄於本機受管 state

#### Scenario: 保留受管 Server 的本機 Authorization header

- **WHEN** 本機受管 Server 含合法單行 `http_headers = { Authorization = "Bearer ..." }`
- **AND** repo 的 `url` 或 `enabled` 需要套用
- **THEN** `to-local` SHALL 更新可攜欄位並原文保留該本機 header
- **AND** MUST NOT 將 header 值輸出或寫入 repo

### Requirement: 受管 state 支援殘留刪除

系統 SHALL 在 `CODEX_HOME` 保存不進 repo 的 versioned state，記錄該裝置由本機制管理的 Server 名稱。當名稱仍在 state 但已從 repo 移除，`to-local` SHALL 刪除對應本機 section；不在 state 的本機 Server SHALL 保留。

#### Scenario: 刪除 repo 已移除的受管 Server

- **WHEN** `old-server` 登記於本機受管 state，但已不存在於 `codex/mcp.json`
- **AND** 使用者執行 `to-local`
- **THEN** 系統 SHALL 從本機 `config.toml` 刪除 `old-server` section
- **AND** SHALL 從 state 移除該名稱

#### Scenario: state 寫入失敗可見

- **WHEN** `config.toml` 已成功更新，但 state atomic write 失敗
- **THEN** 系統 SHALL 回報部分套用及已完成變更
- **AND** MUST NOT 將整次操作誤報為完整成功

### Requirement: to-repo 只讀回受管白名單欄位

`to-repo` SHALL 只從 repo 現有名稱或本機受管 state 登記的 MCP sections 讀回 `url` 與 `enabled`，並 deterministic 寫入 `codex/mcp.json`。未受管本機 Server SHALL NOT 被自動吸入 repo；合法的本機 `http_headers.Authorization` SHALL 被忽略並保留於本機，其他未知、重複或無法安全解析欄位 MUST 造成操作失敗，不得靜默捨棄。

#### Scenario: 更新受管來源

- **WHEN** 本機受管 Server 的合法 `url` 或 `enabled` 與 repo 不同
- **AND** 使用者執行 `to-repo`
- **THEN** 系統 SHALL 更新 `codex/mcp.json` 的對應可攜欄位

#### Scenario: 本機刪除受管 Server

- **WHEN** repo 或 state 將某名稱識別為受管，但本機已無該 section
- **AND** 使用者執行 `to-repo`
- **THEN** 系統 SHALL 從 repo 來源刪除該 Server 定義

#### Scenario: 不吸入本機未受管 Server

- **WHEN** 本機存在一個未受管 MCP Server
- **AND** 使用者執行 `to-repo`
- **THEN** 系統 SHALL 保留本機 Server，且 MUST NOT 將其加入 `codex/mcp.json`

### Requirement: MCP 合併解析 fail closed

系統 SHALL 正確辨識一般與引號形式的 `[mcp_servers.<name>]` section，並保留不受管原文。遇 malformed header、同名重複 section、array-of-tables、重複 key、無法解析的值或不能可靠決定 section 邊界時 MUST fail closed，MUST NOT 猜測重寫。

#### Scenario: 引號名稱安全處理

- **WHEN** 本機 MCP section 使用合法引號 key，且名稱可正規化為受管 Server
- **THEN** 系統 SHALL 正確辨識該 section，不得建立語意重複的第二份定義

#### Scenario: malformed TOML 不修改

- **WHEN** 本機 `config.toml` 含無法安全解析的 section header 或受管值
- **AND** 使用者執行 apply
- **THEN** 系統 MUST 以錯誤中止
- **AND** `config.toml` 與 state MUST 保持未修改

### Requirement: 憑證與登入狀態維持本機

系統 MUST NOT 同步或顯示 Codex MCP OAuth token、API Key、cookie、Authorization value 或 ChatGPT 登入狀態。系統 MAY 為保留受管 section 而將合法單行 `http_headers.Authorization` 視為 opaque 本機片段，但 MUST NOT 解析、正規化、比較或輸出其值。成功套用 MCP 定義 MUST NOT 被視為 Supermemory API Key 已設定；文件 SHALL 提醒新裝置各自加入本機 header。

#### Scenario: 套用後仍需本機 API Key

- **WHEN** 新裝置成功執行 `to-local`，但尚未加入 Supermemory API Key header
- **THEN** 系統 SHALL 將可攜設定套用視為成功，但 SHALL 明示仍需完成本機認證
- **AND** MUST NOT 宣稱 Supermemory 已可成功讀寫記憶

#### Scenario: diff 與錯誤不洩漏本機 header

- **WHEN** 本機受管 Server 含 Authorization header
- **AND** 使用者執行 `diff`、`status`、`to-repo` 或 `to-local`
- **THEN** 輸出 SHALL 只顯示 Server 名與可攜欄位狀態
- **AND** MUST NOT 顯示 header 名稱以外的值、Bearer token 或 API Key

#### Scenario: safety check 掃描 MCP 來源

- **WHEN** `codex/mcp.json` 含不合法或疑似機密欄位
- **AND** 使用者執行 `safety:check`
- **THEN** 系統 SHALL 以 hard block 回報檔案與欄位路徑
- **AND** MUST NOT 顯示原值

### Requirement: 維持 Codex config.toml 整檔不同步

系統 SHALL 維持 repo 不含 `codex/config.toml`，`SYNC_MANIFEST` MUST NOT 新增該整檔同步項。MCP 功能 SHALL 只透過 `codex/mcp.json` 與 section-level merge 實作。

#### Scenario: manifest 不恢復 config.toml

- **WHEN** 測試檢查 `SYNC_MANIFEST`
- **THEN** SHALL 找到 `codex/mcp.json` 的 MCP 同步項
- **AND** MUST NOT 找到 `codex/config.toml` 的 file、settings 或其他整檔同步項
