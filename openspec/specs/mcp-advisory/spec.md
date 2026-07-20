# mcp-advisory Specification

## Purpose
定義 Claude 與 Codex 兩端 MCP Server 定義的**諮詢式（advisory）同步**契約：`diff`／`status` 唯讀偵測本機受管區塊、`to-local` 只輸出可直接執行的官方 CLI 指令而永不寫入 `~/.claude.json` 或 `~/.codex/config.toml`；repo 可攜來源（`claude/mcp.json`／`codex/mcp.json`）只存非機密身分欄位，URL pathname／query 與 `args` 的憑證檢查為 fail closed 且與 `safety:check` 共用同一判準。本 capability 取代 `openspec/changes/archive/2026-07-19-sync-codex-mcp-config/specs/codex-mcp-sync/spec.md` 的寫入式行為，涵蓋兩端。
## Requirements
### Requirement: MCP 同步採諮詢式，永不寫入本機設定

系統 SHALL 以諮詢（advisory）方式同步 Claude 與 Codex 的 MCP Server 定義：`diff`／`status` 唯讀比對，`to-local` 只輸出官方 CLI 指令。系統 MUST NOT 寫入 `~/.claude.json` 或 `~/.codex/config.toml`，亦 MUST NOT 為 MCP 建立任何本機狀態檔。

本需求取代 `openspec/changes/archive/2026-07-19-sync-codex-mcp-config/specs/codex-mcp-sync/spec.md` 中「to-local 只合併受管 MCP sections」與「受管 state 支援殘留刪除」兩條 requirement 的行為。

#### Scenario: to-local 對 MCP 項目零檔案寫入

- **WHEN** 使用者執行 `node sync.js to-local` 且 repo 與本機的 MCP 定義存在差異
- **THEN** 系統 SHALL 輸出對應的 `claude mcp add --scope user ...`／`codex mcp add ...` 指令
- **AND** `~/.claude.json` 與 `~/.codex/config.toml` 的 mtime 與內容 SHALL 保持不變
- **AND** 系統 MUST NOT 建立任何暫存檔或狀態檔

#### Scenario: advisory 項目不納入確認閘門的寫入清單

- **WHEN** `to-local` 計算預覽並詢問確認
- **THEN** advisory 型項目的差異 SHALL 以「建議指令」呈現，MUST NOT 計入待寫入變更數
- **AND** 即使使用者於確認提示回答 `n`，建議指令 SHALL 仍可被輸出（因其無副作用）

#### Scenario: 兩端行為一致

- **WHEN** 使用者比較 Claude 與 Codex 的 MCP 同步行為
- **THEN** 兩者 SHALL 同為 advisory：唯讀偵測、輸出指令、不寫本機
- **AND** 系統 MUST NOT 對其中一端自動寫入而另一端僅提示

### Requirement: MCP 可攜來源只存非機密身分欄位

系統 SHALL 以 `claude/mcp.json` 與 `codex/mcp.json` 作為兩端 MCP 的 repo 來源，只保存可攜且非機密的欄位。Claude 端 SHALL 支援 `type` 為 `http`／`sse`／`stdio`；Codex 端維持既有 `transport` 欄位語意。任何 `env` 值、`headers`、`Authorization` 或其他憑證載體 MUST NOT 出現於 repo 來源；環境變數只能以諮詢性的 `envKeys`（僅 key 名）表達。

#### Scenario: 無法表達的 transport 為 fail closed

- **WHEN** 來源或本機出現 schema 未涵蓋的 `type`／`transport` 值
- **THEN** 系統 SHALL 拋出驗證錯誤並中止該項目處理
- **AND** 系統 MUST NOT 靜默丟棄該 Server，亦 MUST NOT 因此在 diff 回報「無差異」

#### Scenario: sse transport 被完整保留

- **WHEN** 本機存在 `type: "sse"` 的 MCP Server 且執行 `to-repo`
- **THEN** 該 Server SHALL 被完整寫入 repo 來源並保留其 transport
- **AND** 後續 `to-local` SHALL 產生對應的 `--transport sse` 指令

#### Scenario: 憑證欄位不進 repo

- **WHEN** `to-repo` 讀到本機 Server 帶有 `headers`、`Authorization` 或 `env` 值
- **THEN** 系統 SHALL 剝除這些欄位後才寫入 repo 來源
- **AND** repo 來源 MUST NOT 包含其值

### Requirement: URL pathname 與 args 的憑證檢查為 fail closed

系統 SHALL 對 `url` 的 **pathname 與 query** 以及 `args` 的每個元素執行憑證檢查，判準為「無法判定為安全即拒絕」，而非僅比對已知 secret pattern。此判準 SHALL 由同步驗證與 `safety:check` 共用，行為一致。

#### Scenario: path-embedded token 被拒絕

- **WHEN** 來源或待寫入 repo 的 Server URL 於 pathname 含高熵不可判定片段（如 `https://hooks.example.com/mcp/NjQ4MWZhZDgtY2Y...`）
- **THEN** 系統 SHALL 拒絕該項目並回報欄位路徑
- **AND** 錯誤訊息 MUST NOT 包含該片段的值
- **AND** 系統 MUST NOT 提供繞過旗標

#### Scenario: args 內挾帶的遠端 URL 一併檢查

- **WHEN** `stdio` 型 Server 的 `args` 某元素為含憑證的 URL
- **THEN** 系統 SHALL 以與 `url` 相同的判準拒絕
- **AND** 回報 SHALL 指出是第幾個 arg，但不輸出其值

#### Scenario: 誤擋時提供替代路徑

- **WHEN** 一個實際不含憑證的長路徑 URL 被判定為不安全
- **THEN** 錯誤訊息 SHALL 說明原因並指引改用 `envKeys` 或手動維護
- **AND** 系統 SHALL NOT 因此放寬判準

### Requirement: 唯讀 inspect 提供偵測能力

系統 SHALL 唯讀讀取本機 MCP 定義以供比對：Claude 端讀 `~/.claude.json` 的 top-level `mcpServers`，Codex 端讀 `~/.codex/config.toml` 的受管 `[mcp_servers.*]` section。其餘欄位與 section MUST NOT 被讀取、解析或輸出。

#### Scenario: 只讀受管區塊

- **WHEN** 系統為 diff 讀取本機設定
- **THEN** Claude 端 SHALL 只取 top-level `mcpServers`，Codex 端 SHALL 只取受管 `[mcp_servers.*]`
- **AND** OAuth token、`projects[].history`、Codex 的 profiles／providers 等 MUST NOT 被讀入或輸出

#### Scenario: 本機 Authorization header 被容忍但不外洩

- **WHEN** Codex 本機受管 section 含單行 inline `http_headers.Authorization`
- **THEN** 系統 SHALL 容忍其存在而不 fail closed
- **AND** 其值 MUST NOT 出現於 diff 輸出、建議指令或 repo 來源
- **AND** 比對是否相同時 SHALL 忽略該欄位

#### Scenario: 受管 section 出現未知 key 仍 fail closed

- **WHEN** Codex 受管 section 含 schema 未涵蓋的 key
- **THEN** 系統 SHALL fail closed 報錯
- **AND** 理由為比對結論不可信，SHALL NOT 輸出可能錯誤的建議指令

#### Scenario: 本機設定缺失或損壞不阻斷其他項目

- **WHEN** 本機設定檔不存在
- **THEN** 系統 SHALL 視為「無任何 MCP Server」正常回報差異
- **WHEN** 本機設定檔存在但無法解析
- **THEN** 系統 SHALL 回報該項目錯誤，但 MUST NOT 中止其他同步項目的 diff

#### Scenario: diff 輸出不顯示連線細節

- **WHEN** `diff`／`status` 回報 MCP 差異
- **THEN** 輸出 SHALL 為每個 Server 一行狀態，只含 Server 名與狀態
- **AND** URL、header、env 值 MUST NOT 出現於輸出

### Requirement: 本機額外 Server 只列出不刪除

系統 SHALL 將「本機有而 repo 沒有」的受管範圍外 Server 列為「本機額外」供參考，MUST NOT 輸出移除指令，亦 MUST NOT 執行任何刪除。刪除決策 SHALL 完全留給使用者，與 `skills-lock-diff` 的既有模式一致。

#### Scenario: repo 移除 Server 後不刪本機

- **WHEN** repo 來源移除了某個先前存在的 Server，而本機仍有該 Server
- **THEN** 系統 SHALL 於 diff 將其列為「本機額外」
- **AND** 系統 MUST NOT 輸出 `claude mcp remove`／`codex mcp remove` 指令
- **AND** 本機設定 SHALL 保持不變

#### Scenario: 不需要受管狀態檔

- **WHEN** 系統執行任何 MCP 相關指令
- **THEN** 系統 MUST NOT 讀取或建立 `~/.codex/.ai-config-sync-mcp-state.json` 或任何等價狀態檔
- **AND** 既有裝置上的該檔 SHALL 被視為孤兒檔而不自動刪除

### Requirement: 建議指令為可直接執行的完整形式

系統 SHALL 輸出可直接複製執行的單行指令，包含 transport、URL 或 command／args 等所有可從 repo 來源決定的參數。需人工補入的憑證 SHALL 以明確佔位或後續步驟提示表達，MUST NOT 以真實值填入。

#### Scenario: HTTP transport 指令完整

- **WHEN** repo 有 `type: http` 的 Server `supermemory` 而本機缺少
- **THEN** 系統 SHALL 輸出形如 `claude mcp add --transport http --scope user supermemory <url>` 的單行指令
- **AND** 該指令 SHALL 可直接貼上執行而無需修改

#### Scenario: 需憑證者附後續步驟

- **WHEN** 該 Server 依 `envKeys` 或已知需求需要憑證或登入
- **THEN** 系統 SHALL 於指令後附註需補的 env key 名或 `codex mcp login <name>` 之類後續步驟
- **AND** 系統 MUST NOT 輸出任何真實憑證值
