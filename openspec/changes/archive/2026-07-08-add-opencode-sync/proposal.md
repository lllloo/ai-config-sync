## Why

opencode（sst/opencode）是使用者第三個常用的 AI coding 工具，其全域設定（`~/.config/opencode/`）目前完全不在跨裝置同步範圍內。既有 `SYNC_AREAS`／`SYNC_MANIFEST` 宣告式架構已預留「新增工具 area 只需加一筆資料」的擴充點，正好承接。此外 opencode 的機密（`auth.json`、`opencode.db`）天生落在 `~/.local/share/opencode` 與 `~/.cache`，與設定家 `~/.config/opencode` 分屬不同根目錄，只要 area 鎖定設定家即天生隔離機密，同步風險比 `~/.claude.json` 那類混合檔低。

## What Changes

- 新增 `SYNC_AREAS.opencode` 資料列：`homeBase = ~/.config/opencode`、`repoDir = opencode/`、`prefix = opencode/`。此為第一個 `homeBase` 非 `~/.<tool>` 直屬的 area（XDG 佈局），驗證 area 抽象對任意 base 路徑成立。
- 新增兩列 `SYNC_MANIFEST`（先鋪管線，僅設定檔與全域指示）：
  - `opencode.jsonc`（`type: file`）— 主設定，整檔同步。
  - `AGENTS.md`（`type: file`）— opencode 全域指示，獨立於 Claude 的 `CLAUDE.md`。
- `materializeSyncItem` 新增「取實際存在副檔名」解析：`opencode.jsonc` 與 `opencode.json` opencode 兩者皆讀，materialize 時以實際存在者為準（`.jsonc` 優先）。此為 opencode 專屬的檔名變體行為。
- `safety-check` 的 `SAFETY_SCAN_DIRS` 加入 `opencode`，作為整檔 `file` 同步的機密兜底掃描。
- 配套：`opencode.jsonc`／`AGENTS.md` 的 `.example` 骨架 + `init` 重置涵蓋；README 與 CLAUDE.md 同步項目表補列；測試涵蓋 `materializeSyncItem` 對 opencode area 的產出。
- **刻意不納入**：子目錄（`agents/`、`commands/`、`modes/`、`skills/`、`themes/`、`tools/`）留待有實際內容時再加列；`node_modules/`、`package.json`、`plugins/`（插件執行期產物）因未列入 manifest 天生不被同步。

## Capabilities

### New Capabilities
- `opencode-sync`: opencode 全域設定的跨裝置同步——新 area、`opencode.jsonc`／`AGENTS.md` 兩個 file 型同步項目、`.json`/`.jsonc` 檔名變體解析，以及「機密目錄（`~/.local/share`／`~/.cache`）與執行期產物（`node_modules`／`plugins`）不在同步射程」的邊界保證。

### Modified Capabilities
- `safety-check`: 掃描範圍擴充，將 `opencode/` 納入 `SAFETY_SCAN_DIRS`，使 opencode 整檔同步來源受既有 hard block／warning 規則覆蓋。

## Impact

- **程式碼**：`sync.js`（`SYNC_AREAS`、`SYNC_MANIFEST`、`materializeSyncItem` 副檔名解析、`init` 重置清單）、`safety-check.js`（`SAFETY_SCAN_DIRS`）。
- **範本／文件**：新增 `opencode/opencode.jsonc.example`、`opencode/AGENTS.example.md`；更新 `README.md` 同步項目表與 `CLAUDE.md` 同步對應表。
- **測試**：`test/sync.test.js`（materialize opencode area 等價、副檔名變體解析）、`test/boundary.test.js`（safety sandbox 掃 opencode）。
- **相依**：無新增外部相依（維持零相依）。
- **待解子問題**（design 處理）：`opencode.jsonc` 兩端副檔名不一致時的對齊規則；`.json` 與 `.jsonc` 同時存在時 opencode 的優先序與同步端的去重策略。
