## 1. 測試先行清理

- [x] 1.1 刪除 `test/mcp.test.js` 與 `test/claude-mcp.test.js`
- [x] 1.2 `test/sync.test.js`：刪除 `type: 'mcp'` 的 materialize 測試（約 L257）、從 claude／codex label 清單 drift-guard 移除 `mcp.json`（約 L370-371）、刪除「兩端 MCP 皆為 advisory」guard（約 L561）
- [x] 1.3 `test/sync.test.js`：把「投影寫入型 mcp 不得復活」guard 擴充為「`advisory` 與 `mcp` 型別皆不得存在於 `SYNC_MANIFEST`」，並加斷言 manifest 不含 `label: 'mcp.json'` 或 `homeRootFile: '.claude.json'` 的列（對應 declarative-sync-manifest delta spec）
- [x] 1.4 `test/boundary.test.js`：移除 `require('../mcp.js')`（L46）、「MCP 本機 header fail closed」測試（L107-118）、五條 MCP safety 掃描測試（L939-1030 區間），並從 `SAFETY_RUNTIME_FILES`（L892）移除 `mcp.js`／`claude-mcp.js`
- [x] 1.5 `test/boundary.test.js`：確認純 `.toml` 掃描測試（引號包裝 section、malformed header、header 內部空白、F2 引號感知回歸）全數保留未動
- [x] 1.6 `test/diff-integration.test.js`：從 `SYNC_RUNTIME_FILES`（L21）移除兩個 MCP 模組，刪除 Codex／Claude MCP 的 diff 測試區塊（L133 起）
- [x] 1.7 `test/apply-integration.test.js`：從 `SYNC_RUNTIME_FILES` 移除兩個 MCP 模組，刪除 advisory 零寫入（內容 + mtime 雙重斷言）與建議指令輸出相關測試
- [x] 1.8 加一條回歸測試：`safety:check` 對含 `[mcp_servers.foo]` 的 repo `.toml` 仍回報 hard block exit 2（鎖住 D2，確保 toml 防線與 MCP 同步脫鉤）

## 2. 移除實作

- [x] 2.1 `sync.js`：刪除 `require('./mcp.js')` 與 `require('./claude-mcp.js')`（L17-18）
- [x] 2.2 `sync.js`：從 `SYNC_MANIFEST` 移除兩列 MCP（L1110-1115，含註解），並更新 `SyncItem.type` JSDoc（L113）與 manifest 說明註解（L1095）為 `file`／`settings`／`dir`／`xtool-skills`
- [x] 2.3 `sync.js`：刪除整個「Section: MCP Handler」區塊（`mcpHandler`／`claudeMcpHandler`／`advisoryHandler` 與 `_mcpHandler`／`_claudeMcpHandler` singleton，約 L1710-1735）
- [x] 2.4 `sync.js`：移除 `diffSyncItem`（L1540）與 `applySyncItem`（L1558）的 `case 'advisory'`
- [x] 2.5 `sync.js`：移除 `diffSyncItems` 中 advisory 的錯誤隔離分支（L1575-1576）與 `applySyncItems` 的 advisory 不計入 stats 分支（L1602）
- [x] 2.6 `sync.js`：移除 `buildFullDiffList` 的 advisory 前綴去重分支（L1770）
- [x] 2.7 `sync.js`：刪除 `collectAdvisories`（L2010 起）與 `printAdvisories`（L2025 起）
- [x] 2.8 `sync.js`：`runToLocal` 移除 `writeDiffs`／`hasAdvisory` 分流（L2096-2103），恢復為直接以 `diffResults` 判斷是否有待套用變更
- [x] 2.9 `safety-check.js`：刪除 `require('./mcp.js')`／`require('./claude-mcp.js')`（L42-43）、`scanMcpManifestSafety`（L178 起）與兩條 rel 路徑分派（L236-237）
- [x] 2.10 `safety-check.js`：確認 `CODEX_CONFIG_HARD_BLOCK_SECTIONS`（含 `mcp_servers`）與 `toml-reader.js` 的 require 保留未動，並補註解說明此防線與 MCP 同步無關
- [x] 2.11 刪除 `mcp.js`、`claude-mcp.js`、`claude/mcp.json`、`codex/mcp.json`

## 3. 驗證

- [x] 3.1 `npm test` 全綠
- [x] 3.2 `npm run safety:check` 無 hard block（實際為 exit 1：repo 既有 4 個 env key warning，與 HEAD 對照完全相同，非本次迴歸。原任務寫「clean exit 0」為規劃時的錯誤期望）
- [x] 3.3 `npm run status` 正常輸出，且不出現任何 MCP 相關行或「MCP 建議指令」區塊
- [x] 3.4 `npm run to-local -- --dry-run` 正常預覽，確認確認閘門邏輯未因移除 advisory 分流而破損
- [x] 3.5 全庫 `grep -rn -i "mcp" --include="*.js" --include="*.json"`（排除 `openspec/changes/archive/`、`agents/skills/`）收斂到僅剩 `safety-check.js` 的 `mcp_servers` section 常數與 `toml-reader.js`／`test/toml-reader.test.js`／`test/boundary.test.js` 的 toml 註解與測試字串
- [x] 3.6 確認 `~/.claude.json` 與 `~/.codex/config.toml` 的 mtime 在整輪驗證後未變動

## 4. 文件更新

- [x] 4.1 `README.md`：同步項目表移除兩列 MCP，移除 advisory／MCP 建議指令的說明段落與相關輸出範例
- [x] 4.2 `CLAUDE.md`：目錄命名段移除 `codex/mcp.json` 與 config.toml advisory 描述；同步項目表移除兩列 MCP
- [x] 4.3 `CLAUDE.md`：架構重點段刪除 `mcp.js`／`claude-mcp.js` 兩個模組條目與「六檔零外部相依」的檔數描述，型別分派清單移除 `advisory`
- [x] 4.4 `CLAUDE.md`：修改守則的「MCP 不得寫入本機」與「憑證判準不得放寬」兩條改寫為「本工具不同步 MCP；`~/.claude.json` 與 `~/.codex/config.toml` 永不被寫入或讀取」，保留 `.toml` hard block 的守則
- [x] 4.5 `CLAUDE.md`：測試策略段移除 `test/mcp.test.js`／`test/claude-mcp.test.js` 與 advisory 雙重斷言描述，更新 `SYNC_RUNTIME_FILES`／`SAFETY_RUNTIME_FILES` 應含的檔案清單
- [x] 4.6 `CLAUDE.md`：「刻意不同步」段保留 `~/.codex/config.toml` 與 `~/.claude.json` 兩條並更新理由敘述（不再提 advisory），孤兒 state 檔說明保留
- [x] 4.7 `toml-reader.js` 檔頭註解：說明其消費者為 `safety-check.js` 的 `.toml` 掃描，與已移除的 MCP 同步無關（避免日後誤刪）

## 5. 收尾

- [x] 5.1 `openspec validate --change remove-mcp-sync` 通過
- [x] 5.2 commit（繁體中文訊息，`feat!:` 或 `refactor!:` 標註 BREAKING）
- [x] 5.3 歸檔 change：`openspec archive remove-mcp-sync`，確認 `openspec/specs/mcp-advisory/` 已移除、`declarative-sync-manifest` 與 `safety-check` 主 spec 已套用 delta
