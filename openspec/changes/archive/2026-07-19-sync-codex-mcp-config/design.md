## Context

本專案目前以 `SYNC_MANIFEST` 管理 `repo ↔ 使用者家目錄` 的跨裝置同步；Codex 僅同步 `AGENTS.md`，`~/.codex/config.toml` 因同時承載偏好、專案信任、provider、MCP 與機密相關欄位而於 2026-07 刻意移出同步範圍。這項決策仍然正確，但造成 MCP Server 在每台新電腦都需手動重建。

Codex 將 MCP 定義放在 `[mcp_servers.<name>]`。新需求不是恢復整份 `config.toml`，而是建立一份 repo 端的窄 JSON schema，僅將受管 MCP 的可攜欄位雙向投影至本機 TOML。首個住戶為 Supermemory，預設全域啟用、不加 `x-sm-project`；實機驗證後改採每台裝置本機靜態 API Key header，因 Supermemory OAuth callback 缺少 Codex 要求的 issuer。

既有約束：Node.js >= 18、零外部相依、函式 ≤ 60 行、atomic write、統一 `SyncError`、diff 不顯示設定值、`safety:check` 不洩漏機密、README 與測試須同步更新。

## Goals / Non-Goals

**Goals:**

- 讓 `codex/mcp.json` 成為受管 Codex MCP 的跨裝置 source of truth。
- 讓既有 `diff`／`status`／`to-repo`／`to-local` 自然涵蓋 MCP。
- 只改動本機 `config.toml` 的受管 MCP sections，保留所有其他內容及不受管 MCP。
- repo 移除受管 Server 後，能在各裝置安全刪除對應的舊 section。
- 任何 OAuth token、API Key 或 authorization value 都不得進 repo 或輸出。
- 新電腦套用後只需各自加入本機 API Key header。

**Non-Goals:**

- 不恢復 `codex/config.toml` 整檔同步。
- 不同步 Codex OAuth／ChatGPT 登入狀態。
- 不支援 stdio、SSE、Claude Code、OpenCode、MCP Registry 或 MCPB。
- repo v1 不支援 `http_headers`、`env_http_headers`、bearer token、client secret、`x-sm-project` 或 tool policy；唯一例外是本機受管 section 可 opaque 保留單行 `http_headers.Authorization`，不得投影回 repo。
- 不自動執行瀏覽器 OAuth，也不因 `to-local` 成功就宣稱 MCP 已可用。
- 不刪除未由本機受管狀態登記的其他 MCP Server。

## Decisions

### D1：repo 來源為 `codex/mcp.json`，不使用 TOML fragment

**選擇**：新增 `codex/mcp.json`：

```json
{
  "version": 1,
  "servers": {
    "supermemory": {
      "transport": "streamable-http",
      "url": "https://mcp.supermemory.ai/mcp",
      "enabled": true
    }
  }
}
```

**理由**：來源放在既有 `codex/`（無點）區，符合本 repo 的工具歸屬；JSON 可用既有安全讀寫工具與嚴格 schema 驗證，不必讓 repo 出現含 `[mcp_servers.*]` 的 TOML，也不需放寬現有 `.toml` hard block。

**替代方案**：

- `codex/config.toml`：會推翻「整檔不同步」政策並重新引入裝置欄位／機密 section 過濾，拒絕。
- `codex/mcp.toml`：雖接近原生格式，但會與現行「repo 任何 `.toml` 的 MCP section 為 hard block」衝突，且仍需解析／重寫 TOML，沒有實質簡化。
- repo 根目錄 `mcp.json`：失去工具歸屬，且 v1 只有 Codex，拒絕預先抽象跨工具 schema。

### D2：v1 schema 採最小白名單

**選擇**：每個 Server 只允許 `transport`、`url`、`enabled`；`transport` 必須為 `streamable-http`、`url` 必須為 HTTPS、`enabled` 必須為 boolean，未知欄位一律拒絕。Server 名只允許英數、底線、點與連字號。

**理由**：Supermemory 只需 URL 與 OAuth discovery。以最小白名單確保 `Authorization`、token、headers、env 或 client secret 無法混入；日後每增加一種欄位，都必須另行定義可攜性與安全語意。

**替代方案**：直接映射 Codex 全部 `mcp_servers` schema。其欄位包含靜態 header、env 與認證選項，安全面過大，不適合作為第一版。

### D3：以 `homeLabel` 擴充 manifest，MCP 為 direction-aware fixed-flow 型別

**選擇**：`SYNC_MANIFEST` 新增：

```js
{
  area: 'codex',
  label: 'mcp.json',
  homeLabel: 'config.toml',
  type: 'mcp',
  fixedFlow: true,
}
```

`materializeSyncItem` 以 `label` 組 repo path、以 `homeLabel ?? label` 組本機 path；`src`／`dest` 固定為本機 `config.toml`／repo `mcp.json`，實際資料方向由 MCP merge 函式處理，對稱現有 `settings` 型。

**理由**：維持 manifest 為同步項目的單一來源，也讓「repo 檔名與本機檔名不同」成為明確資料，而非在 builder 寫 Codex 特例。`diffSyncItem`／`applySyncItem` 依專案慣例各新增明確 `case 'mcp'`。

### D4：獨立 `mcp.js` 模組，沿用 DI 邊界

**選擇**：新增 `mcp.js`，由 `sync.js` 以 lazy `createMcpHandler(deps)` 注入路徑、atomic JSON／文字寫入、`SyncError` 與顯示工具；`mcp.js` 不反向 require `sync.js`。純函式直接匯出供 `test/mcp.test.js` 測試。

`mcp.js` 可直接 require 純函式 `toml-reader.js`，利用 section header 的 line metadata 找出完整 `[mcp_servers.*]` 範圍；遇 malformed header、重複同名 section、array table 或無法安全歸屬的語法時 fail closed，不猜測重寫。

**理由**：MCP 的 schema、TOML section 投影、state 與安全驗證是一組獨立責任；塞回 `sync.js` 會破壞現有模組邊界。沿用 `safety-check.js`／`skills.js` 的 DI 模式也便於沙箱測試。

### D5：受管名稱由本機 state 記錄，採非 prune 共管

**選擇**：在 `CODEX_HOME` 保存 `.ai-config-sync-mcp-state.json`：

```json
{
  "version": 1,
  "managedServers": ["supermemory"]
}
```

- `to-local` upsert repo 現有名稱。
- state 中存在但 repo 已移除的名稱視為 stale managed，從本機 TOML 刪除。
- 不在 state、也不在 repo 的本機 MCP 一律保留。
- 首次套用時，repo 同名 section 被採納為受管並依 repo 可攜定義更新；其他名稱不動。
- config 寫入成功後才 atomic 更新 state；state 寫入失敗須回報部分套用。

**理由**：只以 repo 當前名稱無法辨識「已從 repo 移除的舊受管項目」，而 prune 全部本機 MCP 會誤刪其他工具或使用者自行管理的 Server。此模型對稱 `xtool-skills` 的受管名字／非 prune 哲學，但 state 是裝置狀態，故不進 Git。

### D6：`to-local` 只替換受管 sections，保留原始其餘 TOML

**選擇**：以原始行範圍移除目前與 stale 的受管 `[mcp_servers.<name>]` sections，再在檔尾以 deterministic serializer 加入 repo 投影；其他 top-level、section、註解、空白及不受管 MCP 原文保留。若無語意變更，不寫檔。

**理由**：不需要完整 TOML parse／serialize，也避免格式化使用者整份設定。排序以 Server 名穩定輸出，字串使用安全 TOML quoted-key／basic-string encoder。

### D7：`to-repo` 只讀回既有受管名稱的白名單欄位

**選擇**：`to-repo` 以 repo 當前名稱與 state 受管名稱為邊界，從本機 TOML 擷取 `url`／`enabled` 並序列化回 JSON。受管 section 缺失代表刪除 repo 定義；含未知 key、重複 key、非 HTTPS URL 或無法解析的值時拒絕，不靜默丟棄。

本機新出現但從未受管的 MCP 只在 diff 顯示為「本機未受管」，不自動吸入 repo；新增來源需明確編輯 `codex/mcp.json`，避免把含憑證的任意 Server 帶回。

### D8：Supermemory API Key 完全留在本機，Server 預設啟用

**選擇**：來源不保存 `auth` 或 header。Supermemory 定義 `enabled: true`，且不帶 `x-sm-project`；每台裝置在本機受管 section 加入 `http_headers = { Authorization = "Bearer sm_..." }`。同步器只辨識這個本機專屬欄位並原文保留，永不把值寫回 repo 或輸出。

**理由**：實機已驗證 static Bearer header 可完成 initialize、tools/list、whoAmI 與 memory save；OAuth 則因 provider callback issuer 不相容而無法登入。此方案保留「未來電腦預設開啟」與憑證不進 Git的邊界。特定 repo 若日後需要隔離或停用，可在其 trusted `.codex/config.toml` 放完整 project-scoped override；不屬本 change 管理。

### D10：本機 Authorization 採 surgical preservation

**選擇**：受管 section 允許零或一個單行 `http_headers` key，且只接受 inline table 中唯一的 `Authorization` basic string。解析器只驗證結構並保存該 key 的完整 raw line；`sameServer`、diff 與 repo serializer 完全忽略其值。`to-local` 更新 `url`／`enabled` 時將 raw line原樣附回；可攜欄位無差異時整個 section 不寫入。

**理由**：不把 secret 納入資料模型、正規化或顯示，也不因可攜設定更新而刪除本機認證。拒絕 multiline、額外 header、重複 key 與非 basic-string 形式，讓窄 parser 保持 fail closed。這是本機 overlay，不是 repo schema 擴充。

### D9：安全檢查與輸出均 fail closed

**選擇**：同一份 `validateMcpManifest` 純函式由同步流程與 `safety:check` 使用。下列情況 hard block／`SyncError`：未知欄位、控制字元、非 HTTPS URL、疑似認證欄位、manifest 格式錯誤、TOML 無法安全解析。diff、preview、錯誤 context 只顯示 Server 名與欄位路徑，不顯示 URL 以外的任何原值；v1 無 credential value 可輸出。

**理由**：安全規則不可只存在於 commit 前掃描；同步 apply 本身也必須拒絕不合 schema 的來源。`safety:check` 仍保有第二道獨立閘門。

## Risks / Trade-offs

- **[窄 TOML writer 仍可能遇到合法但少見語法]** → 只處理明確白名單 key 與普通 table；重複／malformed／array-table 一律 fail closed，測試覆蓋引號 section 名、多行值與 CRLF。
- **[config 已寫入但 state 寫入失敗]** → config 先寫、state 後寫；附掛 partialChanges 並明確警告。重跑仍會 upsert repo 現有名稱，不會損壞設定。
- **[本機受管 section 含 v1 不支援欄位]** → 除窄允許的 `http_headers.Authorization` 外，`to-repo` 仍拒絕而非剝除；避免資料無聲遺失。
- **[新電腦看得到 Server 但尚未認證]** → README 明示每台裝置需加入本機 API Key header；不把 config 已落地誤報為認證完成。
- **[全域啟用造成跨專案記憶混用]** → v1 明確不設 `x-sm-project`，屬已接受取捨；個別 repo 可自行 project override，未來若要自動 scope 另開 change。
- **[未受管本機 MCP 不會自動跨裝置]** → diff 顯示未受管項，但不自動吸入；安全優先於便利性。

## Migration Plan

1. 加入 `codex/mcp.json` 與 Supermemory 定義。
2. 在沙箱跑完整測試，確認 repo 既有同步項行為不變。
3. 在實機先執行 `npm run to-local -- --dry-run`，確認只新增／更新 Supermemory MCP 與本機 state。
4. 執行 `npm run to-local` 套用；若本機已有 Supermemory，同名 section被採納為受管並收斂到 repo 定義。
5. 在本機受管 section 加入 Supermemory API Key header、重開 Codex，再以 `whoAmI`／`recall` 確認連線。
6. 新電腦部署沿用 `git pull → npm run to-local → 本機加入 API Key header → 重開 Codex → 工具驗證`。

**Rollback**：在仍有新版工具時先從 `codex/mcp.json` 移除 Supermemory並跑 `to-local`，讓 state 驅動刪除受管 section；再 revert change。若程式碼已先回滾，可用 `codex mcp remove supermemory` 手動移除；OAuth credential 另以 `codex mcp logout supermemory` 清除。

## Open Questions

（無；v1 的工具、transport、repo 欄位、本機認證 overlay、安全邊界、預設啟用與 project scope 均已收斂。）
