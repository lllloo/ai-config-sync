## Context

`sync.js` 目前把兩端 MCP 同步實作為 `advisory` 型別：`SYNC_MANIFEST` 兩列（`claude/mcp.json → ~/.claude.json`、`codex/mcp.json → ~/.codex/config.toml`）、`diffSyncItem`／`applySyncItem` 各一個 `case 'advisory'`、`advisoryHandler(item)` 依 area 選 `mcp.js` 或 `claude-mcp.js`，以及 `collectAdvisories`／`printAdvisories` 與 `runToLocal` 中把 advisory 排除於寫入閘門外的分支。

兩個 handler 模組合計約 720 行，承載 MCP schema 驗證、共用憑證判準、Codex `config.toml` 的唯讀 section 解析、`~/.claude.json` 唯讀 inspect 與官方 CLI 指令產生。`safety-check.js` 另有 `scanMcpManifestSafety` 對兩份 repo 來源做結構化掃描。

而兩份 repo 來源目前皆為 `{"version": 1, "servers": {}}`——機制完整但無住戶。

本變更是**純移除**，不引入替代機制。重新設計會是後續獨立的 change。

## Goals / Non-Goals

**Goals:**

- 讓 `sync.js` 的型別集合收斂為 `file`／`dir`／`settings`／`xtool-skills`，`advisory` 概念完全消失。
- 刪除 `mcp.js`、`claude-mcp.js` 與兩份 repo 來源檔，不留半套骨架。
- 保住 `.toml` 機密 section hard block 與 `toml-reader.js`，並在測試與文件中把「此防線與 MCP 同步無關」講清楚。
- 保住「`~/.claude.json` 與 `~/.codex/config.toml` 永不被寫入」——移除後連唯讀讀取路徑也不存在，這個不變式只會更強。

**Non-Goals:**

- 不設計新的 MCP 同步機制，不預留 hook、flag 或空殼模組。
- 不刪除、不清理任何本機檔案（含孤兒 `~/.codex/.ai-config-sync-mcp-state.json`）。
- 不改動 skills、settings、opencode 三條同步線的任何行為。
- 不放寬 `safety:check` 的其餘任何判準。

## Decisions

### D1：純刪除，不留 deprecation 期

移除 `advisory` 型別與兩列 manifest，而非保留型別但清空 manifest。

**理由**：留著沒有住戶的型別分派會讓下一輪重新設計被既有形狀綁架——新設計若不是 advisory 形狀，留下的 case 反而是負債。repo 來源為空表示無使用者受影響，沒有需要過渡期的對象。

**替代方案**：保留 `advisory` 型別、只移除兩列 manifest。否決：留下無法被觸發的程式碼路徑，測試覆蓋會隨之腐爛，且違反本 repo「不做預防性保留」的既有慣例（見 CLAUDE.md 的 agents 移除先例）。

### D2：`toml-reader.js` 與 `.toml` hard block 保留

`toml-reader.js` 的唯一消費者是 `safety-check.js` 的 `.toml` 掃描，該掃描的職責是「阻止人工把含機密的 `config.toml` 放進 repo」，與是否同步 MCP 無關。

**理由**：這條路徑本來就不經 `mcp.js`；移除 MCP 同步後，repo 內出現 `.toml` 的風險反而**沒有降低**（人仍可能手動複製 `~/.codex/config.toml` 進來備份）。刪掉它是拿掉一條與本次變更無因果關係的防線。

**落實**：在 `safety-check` delta spec 新增一條 scenario 明確鎖住「MCP 同步移除後此防線仍有效」，避免日後有人把 `toml-reader.js` 誤判為 MCP 遺留物而清掉。`test/toml-reader.test.js` 與 `boundary.test.js` 的 F2 引號感知回歸測試一併保留。

### D3：憑證判準隨模組刪除，但以 spec 註記其原則

`isSuspiciousToken`／`findUrlCredentialPaths`／`findArgsCredentialPaths` 位於 `mcp.js`，移除後唯一消費者（MCP 同步與 `safety:check` 的 MCP 掃描）都不在了。

**理由**：沒有呼叫端的安全函式不是防線，是死碼。但「fail closed、不得加繞過旗標」是本 repo 的既有原則，不因實作刪除而失效——故在 `mcp-advisory` 的 REMOVED requirement 的 Migration 欄位明文記下：重新設計若要在 repo 端存放 URL 或 args，SHALL 重建等價判準。

**替代方案**：把三個純函式搬進 `safety-check.js` 保留。否決：`safety:check` 移除 MCP 掃描後無處呼叫，等同把死碼換個檔案放。

### D4：測試分兩類處理

- **整體刪除**：`test/mcp.test.js`、`test/claude-mcp.test.js`（模組已不存在）。
- **就地清理**：`test/sync.test.js` 的 manifest label 清單與兩條 MCP drift-guard、`test/boundary.test.js` 的 `SAFETY_RUNTIME_FILES` 與五條 MCP safety 測試、`test/diff-integration.test.js`／`test/apply-integration.test.js` 的 `SYNC_RUNTIME_FILES` 與 advisory 零寫入斷言。

其中 `test/sync.test.js` 的「兩端 MCP 皆為 advisory」與「`type: 'mcp'` 不得復活」兩條 guard：前者刪除、後者**保留並擴充**為「`advisory` 與 `mcp` 型別皆不得存在」。理由是後者是防止寫入本機的回歸鎖，語意在移除後依然成立且更該把關。

`test/boundary.test.js` 中純 `.toml` 掃描的測試（引號包裝 section、malformed header、header 內部空白等）**全部保留**——它們測的是 `safety-check.js` + `toml-reader.js`，不觸及 `mcp.js`。

### D5：`homeRootFile` 欄位的去留

`homeRootFile` 是為 `~/.claude.json` 引入的 manifest 欄位，移除後無使用者。

**決定**：保留 `materializeSyncItem` 中的 `homeRootFile` 支援，但在 `declarative-sync-manifest` delta spec 加 scenario 鎖住「manifest 不含使用該欄位的列」。

**理由**：與 D1 的「不留死碼」看似衝突，但性質不同——`advisory` 是一整條分派路徑加兩個模組，`homeRootFile` 是 materializer 內一行三元判斷，且它是通用的路徑解析能力（任何 `$HOME` 直屬檔案都會用到），不綁定 MCP。若連它也刪，`declarative-sync-manifest` spec 的對應 requirement 也要改寫，變更面積擴大而收益為零。

## Risks / Trade-offs

- **[重新設計時重蹈覆轍]** → 憑證 fail-closed 原則與「永不寫入 `~/.claude.json`／`config.toml`」的理由記在 REMOVED requirement 的 Migration 欄位與歸檔的 change 中，新設計啟動時先讀 `openspec/changes/archive/` 的 MCP 相關三份 change。

- **[誤刪 `toml-reader.js`]** → D2 的 spec scenario 加上 `test/toml-reader.test.js` 保留，任何嘗試移除都會 fail。

- **[drift-guard 漏改導致測試綠燈但文件過時]** → README 指令別名表與黑名單常數已有 drift-guard 把關，但同步項目表為人工維護。tasks 明列 README／CLAUDE.md 兩份文件的具體段落。

- **[部分刪除留下 dangling require]** → `safety-check.js` 頂部兩行 `require('./mcp.js')`／`require('./claude-mcp.js')` 若漏改，`npm run safety:check` 會直接 crash。tasks 把「全庫 grep `mcp` 收斂到零命中（測試 fixture 與 archive 除外）」列為驗收步驟。

## Migration Plan

1. 先刪測試檔與清理測試引用（讓紅燈明確指向待改的實作點）。
2. 改 `sync.js`、`safety-check.js`，刪 `mcp.js`、`claude-mcp.js` 與兩份 `mcp.json`。
3. `npm test` 全綠 + `npm run safety:check` clean exit 0 + `npm run status` 正常輸出。
4. 更新 README／CLAUDE.md。
5. 歸檔本 change，`openspec/specs/mcp-advisory/` 隨之移除。

**Rollback**：本 change 為單一 commit，`git revert` 即可完整還原（無本機狀態變更、無資料遷移）。

## Open Questions

無。重新設計的方向（是否再做 MCP 同步、採什麼形狀）刻意留給後續獨立的 change 決定，不在本次範圍。
