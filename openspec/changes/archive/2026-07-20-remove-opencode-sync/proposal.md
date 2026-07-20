## Why

opencode 同步的兩個項目都不再產生價值：`opencode.json` 是只含 `$schema` 一行的空殼，而 `opencode/AGENTS.md` 與 `codex/AGENTS.md` **逐字相同（僅標題行不同）**、且兩者都是 `claude/CLAUDE.md` 扣掉 Claude Code 專屬「檢視低污染慣例」一段後的副本。當初 `add-opencode-sync` 設計此 area 的理由是「維護獨立一份可與 Claude 分歧」，但該分歧從未發生——同步機制實際上在跨裝置搬運重複資料，並為此扛著一組僅 opencode 使用的 `variants` 檔名變體解析機制。

## What Changes

- **BREAKING**：移除 repo 端 `opencode/` 目錄（`opencode.json`、`AGENTS.md`），opencode 全域設定不再跨裝置同步
- 移除 `sync.js` 的 `OPENCODE_HOME` 常數、`SYNC_AREAS.opencode` 一列、`SYNC_MANIFEST` 的兩列 opencode 項目
- 移除 `resolveVariantLabel` 函式與 manifest 的 `variants` 可選欄位（移除 opencode 後成為零消費者；`.json`／`.jsonc` 雙副檔名是 opencode 特有問題，不保留為通用能力）
- 移除 `safety-check.js` 的 `SAFETY_SCAN_DIRS` 中 `'opencode'` 項
- 更新測試：`test/sync.test.js`（34 處命中）、`test/boundary.test.js`（7 處命中），刪除所有 opencode 專屬測試
- 更新 `README.md` 同步項目表、`CLAUDE.md` 目錄命名與同步對應段落
- 更新 `ROADMAP.md` 的 `--area` 旗標提案動機（分區工具由三個減為兩個）

**刻意不做**：

- **不觸碰本機 `~/.config/opencode/`**。照 `remove-mcp-sync` 先例，本機檔留為孤兒檔、由 README 註明使用者可自行 `rm`；為清理而寫本機檔會與「不寫入本機」原則自相矛盾。此決定也使本變更不依賴「opencode 缺 `AGENTS.md` 時 fallback 讀 `~/.claude/CLAUDE.md`」這項未經驗證的行為
- **不留任何回歸鎖**。刻意不比照 `config.toml`／`mcp`／`advisory` 的「不得復活」鎖法——本變更求零殘留，`opencode` 與 `variants` 字樣不應繼續存在於測試與 spec 中。代價是日後若有人加回 opencode area 或 `variants` 欄位，不會被測試擋下
- **不動 `codex/AGENTS.md`**。它與被移除的 `opencode/AGENTS.md` 內容相同、面臨同樣的重複問題，但屬獨立議題，不納入本變更範圍

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `opencode-sync`：整個 capability 移除。其四項要求（獨立 area 同步、主設定與全域指示同步、檔名變體解析、機密與執行期產物不在射程）全數失效
- `declarative-sync-manifest`：移除 `variants` 可選欄位及其 canonical label 解析要求；原「`variants` SHALL 有實際 manifest 使用者」一句連同對應 scenario 刪除。`homeLabel`／`homeRootFile` 保留現狀不受影響
- `safety-check`：掃描來源目錄由 `claude`／`codex`／`opencode`／`agents` 減為 `claude`／`codex`／`agents`；移除「掃描 opencode 同步來源」scenario 與要求敘述中的 `opencode/AGENTS.md` 舉例

## Impact

- **程式碼**：`sync.js`（area 表、manifest、materializer、`resolveVariantLabel`、re-export）、`safety-check.js`（`SAFETY_SCAN_DIRS`）
- **測試**：`test/sync.test.js`、`test/boundary.test.js`；既有 drift-guard（README 同步項目表、label 清單）須同步更新才會通過
- **文件**：`README.md`、`CLAUDE.md`、`ROADMAP.md`
- **repo 檔案**：刪除 `opencode/` 目錄
- **使用者影響**：現有裝置的 opencode 設定原封不動、行為無變化；新裝置 clone 後不會取得 `~/.config/opencode/AGENTS.md`，須自行處理（fallback 生效則吃 `~/.claude/CLAUDE.md`，否則手動複製一次）
- **相依**：無新增或移除外部相依（本專案零外部相依）
