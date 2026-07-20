## REMOVED Requirements

### Requirement: opencode 設定以獨立 area 同步

**Reason**: 整個 `opencode-sync` capability 移除。同步的兩個項目皆不再產生價值——`opencode/opencode.json` 僅含 `$schema` 一行、實質為空殼；`opencode/AGENTS.md` 與 `codex/AGENTS.md` 逐字相同（僅標題行不同），兩者又都是 `claude/CLAUDE.md` 扣掉 Claude Code 專屬段落後的副本。本 capability 賴以成立的設計前提「opencode 全域指示需獨立於 Claude、可與之分歧」從未在實務上發生。

**Migration**: 移除 `SYNC_AREAS.opencode` 資料列、`OPENCODE_HOME` 常數與 `SYNC_MANIFEST` 的兩列 opencode 項目。本機 `~/.config/opencode/` 完全不觸碰（照 `remove-mcp-sync` 先例，不代刪本機檔），現有裝置行為不變；`~/.config/opencode/AGENTS.md` 成為孤兒檔，README 註明使用者可自行 `rm`。新裝置 clone 後不會取得該檔，須自行複製一份或依賴 opencode 的 fallback 行為。本變更求零殘留，SHALL NOT 保留任何「opencode 不得復活」的回歸鎖或 spec 要求。

### Requirement: 同步 opencode 主設定與全域指示

**Reason**: 隨 `opencode` area 一併移除。主設定檔為空殼、`AGENTS.md` 為既有同步檔的重複副本，兩項同步皆無實質價值。

**Migration**: 刪除 repo 端 `opencode/` 目錄（含 `opencode.json` 與 `AGENTS.md`）。無資料遷移需求：`AGENTS.md` 的等價內容仍存在於 repo 的 `codex/AGENTS.md` 與 `claude/CLAUDE.md`，需要時可自其複製。

### Requirement: opencode 主設定檔名變體解析

**Reason**: `.json`／`.jsonc` 雙副檔名是 opencode 主設定檔特有的問題，Claude 與 Codex 的同步項目皆無此需求。opencode area 移除後 `variants` 機制成為零消費者，保留一個無住戶的特例抽象等於長期支付測試與文件維護成本。

**Migration**: 刪除 `resolveVariantLabel` 函式、`sync.js` 對它的 re-export、`SYNC_MANIFEST` 型別註記中的 `variants` 可選欄位，以及 `test/sync.test.js` 中對應的變體解析測試。`declarative-sync-manifest` capability 同步移除 `variants` 欄位的語義要求與 canonical label 解析 scenario，且不留「不得復活」的 SHALL NOT 要求。此處與 `homeLabel`／`homeRootFile` 的處置刻意不同——後兩者描述任何工具都可能遇到的通用佈局差異，故保留為 materializer 的通用能力並以合成 entry 維持覆蓋。若未來出現同樣有雙副檔名問題的工具，自本變更 commit 的父節點取回實作即可。

### Requirement: opencode 機密與執行期產物不在同步射程

**Reason**: 此要求描述的是 opencode area 存在時的射程邊界（`homeBase` 限定 `~/.config/opencode`，使 `~/.local/share/opencode`、`~/.cache/opencode`、`~/.local/state/opencode` 天生在射程外；設定家內的 `node_modules/`、`package.json`、`plugins/` 因未列入 manifest 而不被同步）。area 整個移除後，該邊界的前提消失，要求無所指涉。

**Migration**: 無。移除後系統對 `~/.config/opencode` 與所有 opencode 相關路徑皆不再讀取或寫入，射程保護由「完全不觸碰」以更強的形式取代。
