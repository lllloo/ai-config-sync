## Context

`~/.claude.json` 是 Claude Code 的主狀態檔：本機實測為 76 KB、60 個 top-level key，內含 OAuth session token、`machineID`、`projects[].history`、`tipsHistory` 與各式 cache，且 **Claude Code 執行期持續寫入**。user-scope MCP Server 定義以 top-level `mcpServers` 存於同一檔。

先前提案 `sync-claude-mcp-config`（分支 `origin/claude-mcp-sync`，**不採用**）以字元級掃描器對該檔做 member 級 splice。實作品質不低——經沙箱實測，跳脫字元、字串內括號、CRLF、BOM、巢狀深度、未受管 member 的逐字保留與幂等性均正確。但對抗式審查確認 4 項缺陷：

| # | 缺陷 | 後果 |
|---|---|---|
| 1 | `isSafeHttpsUrl` 不檢查 URL **pathname**；`validateStdioArgs` 不檢查 args 內的遠端 URL | path-embedded token（Zapier／Composio／Smithery 主流認證方式）被寫入 repo；`safety:check` 因共用同一 validator 亦不擋 |
| 2 | `repoServers[m.name]` 對 `toString`／`constructor` 等名稱取到繼承函式 | 未受管 member 的 `command`／`args` 被靜默摧毀，且 `diff` 報 `[✓]`、`to-local` 報 0 變更 |
| 3 | `projectToRepo` 對非 http/stdio 的 `type` 靜默丟棄 | 合法的 `sse` server 被吞掉，repo 變空 → 下次 `to-local` 刪除本機 member |
| 4 | `locateMcpServers` 無 top-level 重複 key 偵測 | 掃描器取第一個、`JSON.parse` 取最後一個，寫到 Claude Code 永遠不讀的區塊 |

缺陷 2、3、4 的共同性質是**靜默**——使用者在 `diff` 看不到，卻發生了寫入或資料遺失。這比缺陷本身更嚴重，因為它繞過了本 repo 的 preview-then-confirm 契約。

關鍵事實：`claude mcp add --scope user` 與 `codex mcp add` **皆存在且功能完整**（http／sse／stdio、`--header`、`-e env`、OAuth）。splice 是在重造官方能力。

## Goals / Non-Goals

**Goals**

- 新裝置能一眼看出「缺哪些 MCP Server」，並取得可直接貼上執行的指令
- `~/.claude.json` 與 `~/.codex/config.toml` **永不被本工具寫入**——缺陷 2、3、4 在架構層消失，而非靠測試防守
- repo 內絕不出現憑證，含 URL pathname 與 `args` 挾帶者（修補缺陷 1）
- 與 `skills-lock-diff` 的既有模式一致
- **兩端心智模型一致**：Claude 與 Codex 的 MCP 行為相同，不需要記憶「哪一端會自動寫、哪一端只給指令」

**Non-Goals**

- 不代執行 `claude mcp add`（不 spawn 子行程、不代管憑證輸入、不偵測 Claude 是否執行中）
- 不同步 project-scope（`.mcp.json`）或 local-scope（`projects[path].mcpServers`）MCP
- 不合併 `claude/mcp.json` 與 `codex/mcp.json` 為單一來源（見 Open Questions）
- 不追求「一鍵完成」：補憑證與驗證連線本就是人工步驟
- 不主動刪除既有裝置上的 `config.toml` 受管 section 或孤兒 state 檔（見 Migration Plan）

## Decisions

### D1：採 advisory（諮詢式）而非 projection（投影式）

**選擇**：`to-local` 對 Claude MCP 輸出 CLI 指令，不寫檔。

**理由**：

1. **官方 CLI 是更正確的實作**。`claude mcp add` 知道正確的寫入時機、支援 `sse`、處理 OAuth 註冊流程。我們手寫的 splice 永遠在追趕 Claude Code 的內部格式。
2. **爆炸半徑不對稱**。寫壞 `~/.claude.json` 的代價是登出與掉專案歷史；不寫則代價為零。
3. **本 repo 已有先例且已成規格**。`openspec/specs/skills-lock-diff/spec.md` 的「skills:diff 只輸出建議指令、不執行」是同一判斷。
4. **原提案本就不是全自動**。其 proposal 自陳「②使其可用（補憑證、關閉 Claude、驗證連線）純 README workflow」——使用者無論如何都要手動跑一輪，故 advisory 的額外人工成本近乎零。
5. **內在矛盾消解**。原方案的 `to-local` 需先關閉 Claude Code 才安全（整檔改寫、無 mtime 重檢），但使用者通常正是在 Claude Code 內執行 `npm run to-local`。`claude mcp add` 無此限制。

**替代方案**：
- *保留 splice 並修 4 個缺陷* — 否決。修完仍留下「對活檔整檔改寫、無鎖」的根本問題，且需長期維護一個與 Claude Code 內部格式耦合的掃描器。
- *spawn `claude mcp add` 子行程代執行* — 否決。憑證需互動輸入，代執行會把本工具拉進憑證處理，違反「憑證不進本工具射程」；且失敗處理與 OAuth 流程複雜度高。

### D2：保留唯讀 inspect，只砍寫入半部

**選擇**：`diff`／`status` 仍讀取 `~/.claude.json` 的 top-level `mcpServers` 做集合比對。

**理由**：讀是安全的，危險的只有寫。砍掉 inspect 會讓 `diff` 失去偵測能力，使用者無從得知這台機器缺什麼。原分支 514 行中真正有價值的正是 inspect 半部。

**邊界**：只讀 top-level `mcpServers`，其餘欄位不讀取、不解析、不輸出。JSON 以 `JSON.parse` 整檔解析即可——**唯讀不需要字元級掃描器**，因為不必保留原始 bytes。這使 `locateMcpServers`／`scanObjectMembers`／`rebuildMcpServers` 全部不需要，缺陷 2、3、4 隨之消失。

### D3：缺陷 1 的修法為 fail closed 白名單，而非 pattern 黑名單

**選擇**：`url` 的 pathname 與 `args` 每個元素，若含**無法判定為安全**的高熵片段即拒絕，而非僅比對已知 secret pattern。

**理由**：`looksLikeSecret` 只匹配 vendor-prefixed 形狀（`sk-`、`ghp_`、`eyJ`…），對 Zapier 的 `NjQ4MWZhZDgt...` 這類 opaque token 完全無效。黑名單在此必然漏接。實作上採「路徑片段長度 + 字元集熵」啟發式，判不出來就擋——寧可誤擋讓人工確認，也不可漏放憑證。

**取捨**：會誤擋部分合法的長路徑 URL。緩解：錯誤訊息明示「若確認此 URL 不含憑證，請改用 `envKeys` 或手動維護」，不提供繞過旗標。

### D4：不再需要受管狀態檔

原方案的 `~/.claude/.ai-config-sync-mcp-state.json` 存在唯一理由是「repo 移除項目時要知道刪本機哪個 member」。advisory 不刪任何東西，故不需要。repo 有而本機沒有 → 輸出 add 指令；本機有而 repo 沒有 → 僅列為「本機額外」供參考，**不輸出 remove 指令**（與 `skills:diff` 同時列出兩種選項的做法一致，但刪除決策留給使用者）。

### D5：`sse` 納入 schema

原方案 schema 只認 http／stdio 是缺陷 3 的根因。`claude mcp add --transport sse` 是合法用法，schema 必須涵蓋。任何無法表達的 `type` 一律 **fail closed 報錯**，絕不靜默丟棄。

### D6：Codex 端一併收斂為 advisory

**選擇**：`codex/mcp.json` 由 `mcp`（TOML section 投影寫入）改為 advisory 型，`to-local` 輸出 `codex mcp add` 指令，不再寫 `~/.codex/config.toml`。

**理由**：

1. **不對稱的唯一支撐點太弱**。`codex mcp add` 存在且功能完整，故「Codex 沒有官方 CLI」不成立；剩下的理由只有爆炸半徑分級（`config.toml` 不含 OAuth token 與 projects 歷史，Codex 亦不持續寫入該檔）。這說明 Codex 端**風險較低**，不說明它**需要**自動寫入。
2. **淨減量可觀，且刪掉的正是最脆弱的部分**。不再重寫 `config.toml` 後，以下整組機制失去存在理由：`projectToLocal`／`appendManagedSections`／`removeRanges`（TOML 文字重組）、`~/.codex/.ai-config-sync-mcp-state.json`（含 schema、序列化、partialChanges 附掛）、以及本機 `http_headers.Authorization` 的 surgical preservation（含 TOML basic-string codec）。最後這項的存在理由字面上就是「我們要重寫這個檔案但不能弄丟使用者的憑證」——不再重寫，需求即消失。
3. **保留的是有價值的半部**。`parseMcpConfig`／`collectSectionRanges`／`diffServerSets`／`projectToRepo` 全數保留，偵測能力不減。

**邊界（與 Claude 端的差異）**：Claude 端唯讀可用 `JSON.parse` 整檔解析；Codex 端**仍需 TOML section 解析**，因為要從 `config.toml` 中辨識受管 `[mcp_servers.*]` 並讀出可攜欄位。但唯讀不需保留原始 bytes，故只需 `parseMcpConfig` 一半的能力——range 收集仍用於定位 section 邊界，`removeRanges`／重組則不再需要。

**`parseMcpConfig` 的 fail-closed 語意保留但降級**：原本受管 section 出現未知 key 時 fail closed，理由是「我們要重寫它，看不懂就不能動」。改為唯讀後，看不懂的 key 不再有寫入風險，但仍 fail closed——因為看不懂代表**比對結論不可信**，此時報錯讓人工檢視，優於輸出一份可能錯誤的 add 指令。本機 `http_headers.Authorization` 維持容忍（不 fail closed、不輸出值、不寫回 repo）。

**替代方案**：
- *Codex 維持現況，只改 Claude* — 否決（本 change 的原始範圍）。留下兩套心智模型與一整組只服務於「安全改寫活檔」的機制，而該機制的維護成本並不因風險較低而降低。
- *兩端合併為單一 `mcp.json` 來源* — 本次不做，見 Open Questions 2。收斂型別與合併來源是兩件獨立的事，後者需先處理 transport 命名差異。

## Risks / Trade-offs

- **[使用者體驗退步：從自動寫入變成手動貼指令]** → 緩解：指令輸出為可直接複製的完整單行；且原方案本就要求手動補憑證，實際多出的步驟極小。
- **[誤擋合法 URL（D3 的必然代價）]** → 緩解：錯誤訊息指明原因與替代路徑；`safety:check` 與同步驗證共用同一判準，行為一致可預期。
- **[Codex 端功能退步：既有的自動寫入被移除]** → 這是本 change 唯一真正的能力損失。緩解：`diff` 的偵測能力完全保留，使用者仍能看出缺什麼；補上的成本是每台裝置每個 Server 貼一次指令，而 Supermemory 本就需要手動補 API key，實際多出的步驟接近零。
- **[`diff` 讀取本機設定失敗（檔不存在／malformed）]** → 緩解：檔不存在視為「無任何 MCP」正常回報；malformed 報錯但**不阻斷其他同步項目**的 diff（唯讀失敗不應讓整個 `status` 失效）。
- **[既有裝置的 `config.toml` 受管 section 從此不再更新，可能與 repo 悄悄分歧]** → 緩解：`diff` 仍逐 Server 比對並回報差異，分歧會被看見；差異的修正手段從「跑 to-local」變成「跑 add 指令」，不會靜默。

## Migration Plan

**Claude 端**：無資料遷移。`origin/claude-mcp-sync` 分支不合併，本 change 直接在 `main` 上實作。

**Codex 端**（既有裝置有實際狀態，需明確處理）：

1. `~/.codex/config.toml` 現有的受管 `[mcp_servers.*]` section **原地保留、不動**。它們本來就是可用的設定，移除同步機制不代表要移除設定。
2. `~/.codex/.ai-config-sync-mcp-state.json` 成為孤兒檔。**不自動刪除**——本 change 的核心承諾是「不寫本機」，為了清理而破例寫（刪）本機檔會自相矛盾。README 註明可手動 `rm`。
3. 升級後首次 `npm run diff`：若本機 section 與 repo 一致，回報無差異，使用者無感；若不一致，回報差異並於 `to-local` 給出 `codex mcp add` 指令。

**Rollback**：移除 `SYNC_MANIFEST` 中的兩列 advisory 項即可，無本機狀態殘留（D4 的附帶好處——advisory 天然無副作用可回滾）。若需退回 Codex 自動寫入，須還原 `mcp.js` 的投影半部與 state 檔機制（git revert 可達），且既有裝置的 `config.toml` 因步驟 1 未被破壞，可直接接回。

## Open Questions

1. **`claude/mcp.json` 與 `codex/mcp.json` 是否該合併為單一來源？** 兩者的 server 集合高度重疊（目前皆只有 supermemory）。合併可去重，但需處理 transport 命名差異（Claude 用 `type`、Codex 用 `transport`）與 CLI 旗標差異。本次維持各自獨立——收斂型別與合併來源是兩件獨立的事。
2. **孤兒 state 檔是否該由 `safety:check` 或 `diff` 提示存在？** 目前只在 README 註明。若日後發現使用者普遍未清理，可加一行唯讀提示（仍不自動刪）。
3. **`openspec/specs/` 缺 `codex-mcp-sync`**。該 spec 只存在於 `openspec/changes/archive/2026-07-19-sync-codex-mcp-config/`，未 sync 進主 specs。本 change 因此無法對它做 delta，改以新的 `mcp-advisory` capability 統一承載兩端契約（見 proposal 的 Capabilities 註）。archive spec 中被取代的行為於本次 spec delta 明確標示，避免日後誤以為仍有效。
