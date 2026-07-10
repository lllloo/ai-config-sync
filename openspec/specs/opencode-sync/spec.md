# opencode-sync Specification

## Purpose
提供 opencode 全域設定的跨裝置同步：以獨立的 `opencode` area 將本機端 `~/.config/opencode` 的主設定檔與全域指示 `AGENTS.md` 與私有 repo 的 `opencode/` 目錄雙向同步，並確保機密與執行期產物不在同步射程內。

## Requirements
### Requirement: opencode 設定以獨立 area 同步

系統 SHALL 提供 opencode 全域設定的跨裝置同步，方式為在 `SYNC_AREAS` 新增一筆 `opencode` 資料列，其本機端 base 為 `~/.config/opencode`、repo 端子目錄為 `opencode/`、顯示前綴為 `opencode/`。opencode area SHALL 不依賴任何針對 area 名稱的 imperative 條件分支，且 SHALL 與既有 `claude`／`codex` area 共用同一 materializer 與型別分派。

#### Scenario: opencode area 由資料表驅動

- **WHEN** `buildSyncItems` 處理 opencode area 的 manifest 列
- **THEN** 系統 SHALL 依 `SYNC_AREAS.opencode` 解析本機端 base 為 `~/.config/opencode`、repo 端 base 為 repo 的 `opencode/`
- **AND** 產出的 `SyncItem` 顯示前綴 SHALL 為 `opencode/`
- **AND** 系統 SHALL NOT 依賴針對 `opencode` 名稱的 imperative 分支

#### Scenario: 本機端 base 非 ~/.<tool> 直屬亦成立

- **WHEN** opencode area 的 `homeBase` 為 XDG 路徑 `~/.config/opencode`（非 `~/.opencode`）
- **THEN** materialize 產出的本機端路徑 SHALL 以該 `homeBase` 為根，正確組出 `~/.config/opencode/<label>`

### Requirement: 同步 opencode 主設定與全域指示

系統 SHALL 同步兩個 opencode 設定項目：主設定檔（`opencode.json`／`opencode.jsonc`，`file` 型整檔同步）與全域指示 `AGENTS.md`（`file` 型整檔同步）。主設定檔與 `AGENTS.md` 皆 SHALL 支援雙向同步（`to-repo` 與 `to-local`），流向依既有 `file` 型語意隨方向交換。

#### Scenario: 主設定檔整檔同步

- **WHEN** 使用者執行 `npm run to-repo` 或 `npm run to-local`
- **THEN** 系統 SHALL 將 opencode 主設定檔以整檔方式在本機端 `~/.config/opencode` 與 repo `opencode/` 之間同步
- **AND** 系統 SHALL NOT 對主設定檔做欄位級剝除或 merge（本次採整檔 `file` 型）

#### Scenario: 全域指示獨立同步

- **WHEN** repo 存在 `opencode/AGENTS.md`
- **AND** 使用者執行 `npm run to-local`
- **THEN** 系統 SHALL 將其同步至 `~/.config/opencode/AGENTS.md`
- **AND** 該檔 SHALL 獨立於 Claude 的 `~/.claude/CLAUDE.md`（不共用同一來源）

### Requirement: opencode 主設定檔名變體解析

系統 SHALL 支援 opencode 主設定檔的 `.json`／`.jsonc` 兩種副檔名變體。`materializeSyncItem` 產生 opencode 主設定項目時 SHALL 以實際存在的檔案決定 `label`，當兩種變體皆不存在時 SHALL 採預設變體 `opencode.jsonc`；當兩種變體同時存在時 SHALL 以 `.jsonc` 優先。此變體解析 SHALL NOT 改變既有 `claude`／`codex` area 任何項目的 materialize 產出。

#### Scenario: 僅存在其一時採實際變體

- **WHEN** 本機端僅存在 `~/.config/opencode/opencode.json`（無 `.jsonc`）
- **AND** 執行 `npm run to-repo`
- **THEN** materialize 產出的主設定項目 `label` SHALL 為 `opencode.json`

#### Scenario: 兩變體皆不存在時採預設

- **WHEN** 本機端與 repo 端皆不存在任何 opencode 主設定檔變體
- **THEN** materialize 產出的主設定項目 `label` SHALL 為預設 `opencode.jsonc`

#### Scenario: 兩變體同時存在時 .jsonc 優先

- **WHEN** 解析端同時存在 `.json` 與 `.jsonc` 兩個變體
- **THEN** materialize 產出的主設定項目 `label` SHALL 為 `opencode.jsonc`

#### Scenario: 不影響既有 area 產出

- **WHEN** 呼叫 `buildSyncItems('to-repo')` 或 `buildSyncItems('to-local')`
- **THEN** `claude`／`codex` area 所有項目的 `label`、`src`、`dest`、`type`、`prefix` SHALL 與新增 opencode 前完全相同

### Requirement: opencode 機密與執行期產物不在同步射程

系統 SHALL 確保 opencode 的機密與執行期產物不被同步。opencode area 的 `homeBase` SHALL 限定於 `~/.config/opencode`，因此位於 `~/.local/share/opencode`（含 `auth.json`、`opencode.db`）與 `~/.cache/opencode`、`~/.local/state/opencode` 的機密與資料天生不在射程內。設定家內的執行期產物（`node_modules/`、`package.json`、`package-lock.json`、`plugins/`）SHALL 因未列入 `SYNC_MANIFEST` 而不被同步。

#### Scenario: 資料目錄不被觸碰

- **WHEN** 使用者執行任一同步指令
- **THEN** 系統 SHALL NOT 讀取或寫入 `~/.local/share/opencode`、`~/.cache/opencode` 或 `~/.local/state/opencode`

#### Scenario: 插件執行期產物不被同步

- **WHEN** `~/.config/opencode` 內存在 `node_modules/`、`package.json` 或 `plugins/`
- **AND** 使用者執行 `npm run to-repo`
- **THEN** 系統 SHALL NOT 將這些項目同步進 repo `opencode/`
