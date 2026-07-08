## Context

同步工具目前以 `SYNC_AREAS`（area 資料表）+ `SYNC_MANIFEST`（同步項目宣告列）+ `materializeSyncItem`（依方向產生 `SyncItem`）三者驅動所有同步。既有兩個 area（`claude` → `~/.claude`、`codex` → `~/.codex`）的 `homeBase` 都是 `~/.<tool>` 直屬目錄，且每個同步項目的 `label` 是固定檔名。

opencode 的設定佈局有兩點與此不同：

1. **XDG 佈局**：設定家在 `~/.config/opencode`（非 `~/.opencode`），且機密（`auth.json`）與資料庫（`opencode.db`，55MB）分別落在 `~/.local/share/opencode`、`~/.cache/opencode`、`~/.local/state/opencode`——與設定家分屬不同根目錄。
2. **主設定檔名不唯一**：opencode 同時接受 `opencode.json` 與 `opencode.jsonc`，且設定家內混有插件執行期產物（`node_modules/`、`package.json`、`plugins/`），opencode 自身以 `.gitignore` 排除之。

本次範圍刻意最小：只鋪管線（主設定 + 全域指示兩個 `file` 型項目），子目錄留待有實際內容再加列。

## Goals / Non-Goals

**Goals:**
- 以既有宣告式架構新增 opencode area，驗證 area 抽象對非 `~/.<tool>` 的 `homeBase` 成立。
- 同步 `opencode.jsonc`（或 `.json`）主設定與獨立 `AGENTS.md`，雙向可用。
- 解決 `.json`/`.jsonc` 檔名變體的 materialize 對齊。
- 將 `opencode/` 納入 `safety:check` 兜底掃描。
- 保持核心引擎（`buildSyncItems`／`diffSyncItem`／`applySyncItem`／`runCommand` 的 switch）零改動。

**Non-Goals:**
- 不做 opencode 主設定的欄位級 merge 或裝置 key 黑名單（維持整檔 `file` 型；未來真踩到裝置衝突再升級，對稱於 settings.json 的演進）。
- 不同步 `agents/`、`commands/`、`modes/`、`skills/`、`themes/`、`tools/` 子目錄（本次無實際內容）。
- 不觸碰 `~/.local/share`／`~/.cache`／`~/.local/state` 下的 opencode 資料與機密。

## Decisions

### 決策 1：新 area `opencode` → `~/.config/opencode`

在 `SYNC_AREAS` 加一列 `opencode: { homeBase: path.join(HOME, '.config', 'opencode'), repoDir: 'opencode', prefix: 'opencode/' }`。`resolveSyncArea`／`materializeSyncItem` 無需改動即支援任意 `homeBase`。

**替代方案**：把 opencode 塞進 codex area 或 claude area——否決，語義混淆且 repo 目錄結構失去對稱。

### 決策 2：主設定採整檔 `file` 型 + `safety:check` 兜底

主設定列為 `{ area:'opencode', label:'<resolved>', type:'file' }`，不新增 `opencode-config` 型別。理由：使用者主設定目前近乎空檔、opencode 裝置 key 分類學尚未盤點，欄位 merge 為過早最佳化。機密風險由 `SAFETY_SCAN_DIRS` 加入 `opencode` 兜底（沿用既有 hard block/warning 規則，含 secret pattern、私鑰、HOME 路徑）。

**替代方案**：`opencode-config` 欄位 merge——否決為 non-goal，需 JSONC 保註解 parse/serialize 與裝置 key 全集，成本不匹配當前需求。

### 決策 3：檔名變體解析——單一 canonical basename 套用兩端

`materializeSyncItem` 對 opencode 主設定項目做「取實際存在副檔名」解析，產出**單一** canonical `label`，同時套用到本機端與 repo 端路徑（兩端同名，杜絕產生 `.json`／`.jsonc` 重複檔）。解析規則：

1. 蒐集候選：本機端 `~/.config/opencode/opencode.{jsonc,json}` 與 repo 端 `opencode/opencode.{jsonc,json}`。
2. 若任一端存在 `.jsonc` → canonical = `opencode.jsonc`；否則若存在 `.json` → `opencode.json`；皆不存在 → 預設 `opencode.jsonc`。
3. `.jsonc` 恆優先於 `.json`（與 opencode 慣例一致，且使用者現況即 `.jsonc`）。

實作上以 manifest 列的一個可選欄位（如 `variants: ['opencode.jsonc', 'opencode.json']` 或 `resolveLabel` 旗標）觸發解析，僅此列走變體邏輯，其餘列 `label` 行為不變——保證既有 area 產出等價（spec 明列此 scenario）。

**替代方案 A**：per-end 各自解析、兩端可不同名——否決，`SyncItem` 目前單一 `label` 衍生 src/dest，per-end 需擴充結構，且會製造雙檔歧義。
**替代方案 B**：寫死 `.jsonc`——否決，fork 者若用 `.json` 直接對不上（決策 C 使用者已選「取存在的那個」）。

### 決策 4：`AGENTS.md` 獨立同步

`{ area:'opencode', label:'AGENTS.md', type:'file' }`。opencode 缺此檔時會 fallback 讀 `~/.claude/CLAUDE.md`，但使用者選擇維護獨立一份，使 opencode 全域指示可與 Claude 分歧。

### 決策 5：排除靠「不列入」而非顯式 exclude

`node_modules/`、`package.json`、`plugins/` 等執行期產物不被同步，是因為 manifest 只列 `file` 型的兩個具名檔、未列任何 opencode `dir` 型項目——不需 `exclude` 機制。未來新增 opencode `dir`（如 `skills/`）時才需評估是否加 `exclude`。

## Risks / Trade-offs

- **[主設定整檔會搬裝置專屬 key]**（如 model/theme/provider）→ 緩解：使用者現況主設定近乎空；`safety:check` 兜底攔機密；日後衝突浮現再升級為欄位 merge（已列 non-goal 的演進路徑）。
- **[檔名雙變體 orphan]**：若某裝置本機為 `opencode.json` 但 canonical 解析為 `.jsonc`，`to-local` 會寫入 `.jsonc`，該裝置可能同時留存 `.json` 與 `.jsonc`，opencode 對兩者同存的優先序未文件化 → 緩解：canonical 規則讓 repo 端恆為單一檔名；於 README 註記「若裝置出現雙變體，請手動刪除非 canonical 的舊檔」。使用者現況（home 僅 `.jsonc`、repo 空）不觸發此風險。
- **[XDG_CONFIG_HOME 覆寫]**：少數使用者以 `$XDG_CONFIG_HOME` 或 `$OPENCODE_CONFIG_DIR` 改設定家位置 → 本次以 `~/.config/opencode` 為準（與多數環境一致）；若未來有需求再讓 `homeBase` 讀環境變數。
- **[safety text 掃描 opencode 子目錄]**：本次不同步 opencode 子目錄，故不需比照 `claude/skills/` 加入 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`；未來加 opencode `dir` 型鏡射目錄時須同步評估排除。

## Open Questions

- opencode 對 `opencode.json` 與 `opencode.jsonc` 同時存在時的實際優先序未見官方文件明述——canonical 規則以 `.jsonc` 優先為假設，若日後證實 opencode 以 `.json` 優先，需回頭對齊解析順序。
- `.example` 範本的確切命名（`opencode.jsonc.example` vs 既有 `CLAUDE.example.md` 的命名慣例）與 `init` 重置對變體檔名的處理，於 tasks 階段定案。
