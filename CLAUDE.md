# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

此 repo 是 Claude Code 跨裝置設定同步工具，透過私有 Git repo 讓多台裝置的 Claude Code 設定保持一致。

## 目錄命名（重要）

- **`claude/`**（無點）— 要同步到 `~/.claude/` 的全域設定內容（CLAUDE.md、settings.json、statusline.sh、agents、commands、skills、rules），由 `sync.js` 管理。
- **`codex/`**（無點）— 要同步到 `~/.codex/` 的全域設定（AGENTS.md、config.toml 過濾欄位），由 `sync.js` 管理。
- **`opencode/`**（無點）— 要同步到 `~/.config/opencode/` 的全域設定（`opencode.jsonc` 主設定、`AGENTS.md` 全域指示），由 `sync.js` 管理。opencode 採 XDG 佈局，設定家在 `~/.config/opencode`（非 `~/.opencode`）。
- **`.claude/`**（有點）— 本 repo 專用的 Claude Code 本地設定（`settings.json` 等），**不參與同步、不映射到 `~/.claude/`**。`.claude/skills` 是 symlink 指向 `../.agents/skills`。
- **Codex 本地 skill** — **不需建 `.codex/skills`**。Codex CLI 會自動探索 `.agents/skills`：專案層由 `repo_agents_skill_roots` 從 project root 逐層掃 `<dir>/.agents/skills`，全域層掃 `~/.agents/skills`（原始碼 `codex-rs/core-skills/src/loader.rs` 的 `skill_roots()`）。故本 repo 的 `.agents/skills` 對 Codex 直接生效，無需 symlink。
- **`.agents/skills/`** — 本地 skill **實體目錄**（已納入版控），跨工具（Claude Code / Codex）共用來源；遵循 [Agent Skills](https://agentskills.io) 開放標準。

新增同步項目：Claude Code 放 `claude/`、Codex 放 `codex/`、opencode 放 `opencode/`；新增本地 skill 一律放 `.agents/skills/<name>/`。勿誤放到 `.claude/` 或 `.codex/`。

## 執行環境

- **OS**：Windows 11（主力）/ macOS（次要）— 跨平台設計
- **Node.js**：>= 18（LTS），零外部相依，禁止新增 npm 套件
- **工具**：`node`、`npm`、`git` — 無 Python/pip 環境，不依賴

## 常用指令

**同步：**
- `npm run diff` — 純比較本機 vs repo，顯示差異（不寫任何東西）
- `npm run status` — 同時比較設定與 skills 差異（等同依序執行 `diff` + `skills:diff`）
- `npm run to-repo` — 本機 → repo（完成後顯示 git diff）
- `npm run to-local` — repo → 本機（先預覽，確認後才套用）
- `npm run safety:check` — 唯讀、離線檢查 repo 同步來源是否含 hard block 或需人工審核 warning

**Skills（獨立管理，不自動同步）：**
- `npm run skills:diff` — 比較本機已安裝 vs `skills-lock.json`，列出差異並提供安裝／移除指令
- `npm run skills:add -- <url>` 或 `npm run skills:add -- <name> <source>` — 新增 skill 記錄
- `npm run skills:remove -- <name>` — 從 `skills-lock.json` 移除 skill 記錄

**測試：**
- `npm test` — 執行 `test/*.test.js`（`node --test`，零相依，共用 helper 在 `test/helpers.js`）
- 單一測試：`node --test --test-name-pattern="<name>" test/<file>.test.js`

**全域旗標**（`node sync.js` 直接呼叫時可用）：`--dry-run`、`--yes`（別名 `--force`，略過互動確認；非互動環境執行 to-local 必加）、`--verbose`、`--version`、`--help`。**不在白名單內的旗標（含 typo 如 `--dryrun`）會拋 `INVALID_ARGS` 而非被靜默忽略**——避免打錯字略過 dry-run 真寫入。**npm run 傳旗標必須以 `--` 分隔**（`npm run to-repo -- --dry-run`）：不加 `--` 時旗標被 npm 攔截、傳不進 `sync.js`；`main()` 開頭的 `assertNoSwallowedNpmFlags` 會偵測 `npm_config_dry_run`／`npm_config_yes` 並拋 `INVALID_ARGS` fail fast，杜絕「以為在預覽、實際真寫入」。指令別名：`d`/`s`/`tr`/`tl`/`sd`/`sa`/`sr`（`safety:check` 無別名）。

## 同步項目與對應

| repo 路徑 | 本機路徑 | 備註 |
|-----------|----------|------|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | 全文比對 |
| `claude/settings.json` | `~/.claude/settings.json` | **top-level 採黑名單制**：預設同步，僅排除 `DEVICE_SETTINGS_KEYS` 黑名單（裝置偏好、平台綁定 `hooks`；只列本機實際存在的 key、不做預防性列名，憑證 helper 由 `safety:check` hard block 兜底；清單見 `sync.js` 常數與 README，有 drift-guard 測試把關）。敏感命名 key 與 `env` 全部依一般同步語意同步，安全審核改由 `safety:check`；`diff`／`status` 只輸出狀態行、不印設定內容 |
| `claude/statusline.sh` | `~/.claude/statusline.sh` | 全文比對 |
| `claude/agents/` | `~/.claude/agents/` | 以 package 子目錄組織（如 `everything-claude-code/`） |
| `claude/commands/` | `~/.claude/commands/` | 目錄鏡射 |
| `claude/skills/` | `~/.claude/skills/` | 目錄鏡射 |
| `claude/rules/` | `~/.claude/rules/` | 模組化全域規則（CLAUDE.md 的拆分檔），支援 frontmatter `paths:` 做 path-specific scoping |
| `codex/AGENTS.md` | `~/.codex/AGENTS.md` | Codex 全域指示（跨專案規則），全文比對 |
| `codex/config.toml` | `~/.codex/config.toml` | **section 級黑名單混合制**：預設同步各 section（含未知新 section／新 key），僅整段排除 `CODEX_CONFIG_DEVICE_SECTION_PREFIXES` 黑名單；top-level（`CODEX_CONFIG_TOP_KEYS`）與 `plugins.*`（`enabled`-only）為維持窄允許清單的兩個精確 carve-out。三分支集中在 `isPortableCodexConfigKey` 單一 predicate；第 2 層由 `safety:check` 對機密 section hard block 兜底；to-local 保留本機被排除 section。清單見 `codex-config.js` 常數與 README（有 drift-guard 測試把關），策略取捨見該檔檔頭註解 |
| `opencode/opencode.jsonc` | `~/.config/opencode/opencode.jsonc` | opencode 全域主設定，整檔 `file` 型同步。**XDG 佈局**：homeBase 為 `~/.config/opencode`。**檔名變體**：`.jsonc`／`.json` 由 manifest `variants` 欄位解析出兩端一致的 canonical label（`.jsonc` 優先），杜絕重複檔；機制見 `SYNC_MANIFEST`／`resolveVariantLabel` 註解 |
| `opencode/AGENTS.md` | `~/.config/opencode/AGENTS.md` | opencode 全域指示，`file` 型整檔同步，獨立於 Claude 的 `CLAUDE.md`（opencode 缺此檔時會 fallback 讀 `~/.claude/CLAUDE.md`，維護獨立一份可與 Claude 分歧） |

### 刻意不同步（勿加入 `buildSyncItems`）

- **`~/.claude.json`** — 含 MCP server 設定與憑證、專案級狀態，屬高風險敏感檔，**永遠不同步**。
- **opencode 機密與資料目錄** — `~/.local/share/opencode`（含 `auth.json`、`opencode.db`）、`~/.cache/opencode`、`~/.local/state/opencode`。因 opencode area 的 `homeBase` 鎖定 `~/.config/opencode`，這些分屬不同根目錄的機密與資料**天生不在同步射程**，無需顯式排除。
- **opencode 執行期產物** — `~/.config/opencode` 內的 `node_modules/`、`package.json`、`package-lock.json`、`plugins/`（插件執行期產物）。因 `SYNC_MANIFEST` 只列 `opencode.jsonc`／`AGENTS.md` 兩個具名 `file`、未列任何 opencode `dir` 型項目，這些**未列入即不被同步**（無需 `exclude` 機制）。未來新增 opencode `dir`（如 `skills/`）時才需評估 `exclude`。

## 架構重點

**主入口 + safety／codex-config 模組**：`sync.js` 為主 CLI 入口（同步／diff／skills 邏輯），`safety:check` 掃描與輸出獨立於 `safety-check.js`，Codex `config.toml` 過濾同步獨立於 `codex-config.js`。三檔零外部相依、只用 Node.js 內建模組。兩子模組皆 **不反向 require `sync.js`**：

- `safety-check.js`：safety 專屬常數與掃描邏輯由本檔持有，測試直接 require 該模組（`sync.js` 不 re-export）。TOML 解析復用 codex-config 的 `readCodexStatements`（單一解析邏輯，杜絕兩份平行 regex 漂移）；text pattern 掃描排除外部套件文件目錄（`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`，整類 false positive）。**注入邊界、掃描分層與取捨的完整說明見該檔檔頭註解**。
- `codex-config.js`：承載 Codex config 的 TOML parse／serialize／merge、可攜欄位判斷與 load／get／apply 進出口；確定性序列化（杜絕多裝置 ping-pong diff）、跨行語法讀取器、array-of-tables 一律不可攜。常數與純函式由模組持有，測試直接 require 該模組。`settings.json`／`config.toml` 的本機／repo 路徑統一由 `SYNC_AREAS` → `materializeSyncItem` 產出的 `item.src`／`item.dest` 供給（**路徑單一來源**，diff／merge 函式不自算路徑）；diff 渲染（`diffCodexConfigItem` 等）屬 diff 引擎、留在 `sync.js`。**序列化、跨行語法、風險承擔的完整說明見該檔檔頭註解**。

檔案結構採 section banner 分段，關鍵不變式：

- **所有函式 ≤ 60 行**（經 iter4/iter5 稽核強制）— 新增函式若超過需拆分。**唯一例外**：DI factory（`createSafetyChecker`／`createCodexConfigHandler`）為「注入依賴後包住一組短小巢狀閉包」的命名空間包裝，本體行數為閉包集合的總和、非單一邏輯流程，不受此限；其內部各閉包仍須 ≤ 60 行
- **指令分派（switch）**：`COMMANDS` 物件為 `{ alias, desc }`（名稱／別名／說明的單一來源）；`main()` 先檢查 `COMMANDS[cmd]` 是否存在，再由 `runCommand(cmd, opts)` 以明確 `switch` 分派到各 `runXxx`。**新增指令需同步改 `COMMANDS`（登錄名稱／別名／說明）與 `runCommand` 的 `switch`（接上 handler）**——刻意不走 handler 注入表，換取分派可讀性
- **宣告式同步項目 `SYNC_MANIFEST`**：所有同步項目由單一宣告式 `SYNC_MANIFEST`（一列 = 一路徑，欄位 `area`／`label`／`type`／可選 `fixedFlow`）定義；`buildSyncItems(direction)` 以 `materializeSyncItem` 依方向 map 產出 `SyncItem[]`（`resolveSyncArea` 對 `area` 解析 base 路徑與 `prefix`；`fixedFlow` 項目 src/dest 固定不隨方向交換，供 `settings.json`／`config.toml` 由 merge 函式內部決定流向）。**新增同步內容只需在 `SYNC_MANIFEST` 加一列**，不需改任何 builder 或 dispatch
- **型別行為分派（switch）**：`SyncItem.type`（`file`／`settings`／`codex-config`／`dir`）的 diff／apply 行為由 `diffSyncItem`／`applySyncItem` 兩個明確 `switch` 分派，`buildFullDiffList` 另以 `item.type === 'dir'` 特判摘要行呈現。**新增同步類型需改此兩處 `switch`（與 `buildFullDiffList` 的 dir 特判如涉及）**——同樣刻意不走 handler 查表
- **Atomic write**：底層 `writeFileSafe` 先寫同目錄暫存檔（隨機尾碼 + `flag:'wx'` O_EXCL）再 rename（同檔系統避免 EXDEV），所有寫入路徑（`writeJsonSafe`、`writeTextSafe`、`copyFile`、`mirrorDir`）皆走此函式。提供**原子性**（避免半截損壞），但**不付 fsync 成本、不保證持久性**（設定檔對持久性需求低）。對稱的 `readFileSafe` 統一將讀取例外包成 `SyncError`（帶 path context），不讓裸 fs 例外穿透 `formatError`。diff 全程唯讀、只輸出狀態行，不產生任何暫存檔
- **統一錯誤處理**：`SyncError` class（`code` + `context`）+ 檔尾 `.catch(formatError)`，所有路徑經 `formatError`，**禁止**裸 `console.error + process.exit`
- **Exit code 語義**：`EXIT_OK=0`（成功或 diff 無差異）、`EXIT_DIFF=1`（diff 有差異，可用於 CI）、`EXIT_ERROR=2`
- **Relative path 遮罩**：`toRelativePath` 處理 REPO_ROOT 與 `$HOME` → `~/`，`logVerbosePaths` 與 `SyncError` context 的 path 顯示亦走此函式避免洩漏使用者名稱
- **Skills lock 為純資料 manifest**：`skills-lock.json` 不參與同步流程；`runSkillsDiff` 直接讀 `~/.agents/.skill-lock.json`（`npx skills` CLI 的原生 lock 檔）與 repo `skills-lock.json` 做集合比對，**只輸出建議指令、不執行安裝/移除**。刻意不用 `npx skills list -g`，因為它會掃目錄並把 `sync.js` 同步管理的 `~/.claude/skills/` skill（如 `ob`、`pen-design`）也列入，造成誤報。本機多裝的 skills 會同時列出（A）`npm run skills:add` 加入 repo 與（B）`npx skills remove` 從本機移除兩種選項

**測試策略**：`test/` 下分六個檔案（`sync.test.js` 純函式、`settings.test.js` 設定欄位與 `mergeSettingsBetween` 同步心臟、`codex-config.test.js` Codex config.toml 過濾、`diff-integration.test.js` diff 整合、`apply-integration.test.js` 沙箱化 to-local/to-repo 端到端 apply、`boundary.test.js` 邊界情境與安全防線），共用 helper 在 `test/helpers.js`。drift-guard 測試涵蓋：`COMMANDS` ↔ `runCommand` dispatch、`COMMANDS` ↔ `COMMAND_ALIASES`、**README／package.json ↔ `COMMANDS`／黑名單常數**（`sync.test.js` 的 README drift-guard 區塊——指令別名表、`DEVICE_SETTINGS_KEYS`、`CODEX_CONFIG_DEVICE_SECTION_PREFIXES`／`CODEX_CONFIG_TOP_KEYS` 增減未跟 README 即 fail）。**破壞性 apply 與 direction-aware diff 走沙箱整合測試**：`apply-integration.test.js` 把 `sync.js` 與 `safety-check.js`、`codex-config.js` 三檔複製進 tmp 當 repo 並以 `HOME` 沙箱化本機，雙向皆不觸碰真實 `~/.claude` 或真實 repo；`boundary.test.js` 的 `safety:check` sandbox 同樣三檔並抄（`SAFETY_RUNTIME_FILES`）。若改純函式，**必須**同步更新 unit test，維持全數通過（視同 100% 覆蓋）。

## 修改守則

- **README.md 須同步更新**：新增/移除指令、改變同步項目、調整行為、新增旗標時必跟。指令別名表與黑名單常數清單已有 drift-guard 測試把關（漏改 README 會 fail），其餘敘述仍靠人工。
- **新增/調整 npm script 時須同步更新 README 的指令別名表、`COMMANDS` 物件與 `runCommand` 的 `switch`**（三者為指令名稱／別名／分派的來源；三條鏈皆有 drift-guard 測試把關）。
- **函式行數守則**：新增或重構後若某函式 > 60 行，需拆分。同步項目的宣告式資料改由 `SYNC_MANIFEST`／`SYNC_AREAS` 常數承載，`buildSyncItems`／`materializeSyncItem` 皆為小函式，無超行例外。
- **禁止新增外部相依**：所有功能必須使用 Node.js 內建模組，不得 `npm install` 任何套件。
- **settings.json top-level 採黑名單制**（`DEVICE_SETTINGS_KEYS`）：預設同步官方 top-level 欄位，僅排除黑名單列舉。敏感命名 key 不再被同步剝除或中止，改由 `safety:check` warning 供人工審核；`env` 區塊全部依一般同步語意同步，diff／status 不印任何設定內容。strip／preserve 由 `partitionSettingsTopLevel` 同源保證互補；增減黑名單欄位須改 `DEVICE_SETTINGS_KEYS` 常數與 README（drift-guard 測試把關）。
- **codex config.toml 採 section 級黑名單混合制**（`CODEX_CONFIG_DEVICE_SECTION_PREFIXES`）：見同步項目表與 `codex-config.js` 檔頭。**列名原則：只列本機實存與機密載體，不預防性列名**——機密載體（`model_providers`／`mcp_servers`）即使本機尚無也必須列（黑名單兼任 to-local 保留語意，移除會形成破壞性刪除迴圈，見 `codex-config.js` 檔頭）；裝置狀態 section（`profiles`／`history`／`shell_environment_policy`）不預列，由 `safety-check.js` 的 `CODEX_CONFIG_DEVICE_WARN_SECTIONS` warning 標示出現、發現再補列。**增減黑名單 section 須改常數與 README（drift-guard 測試把關）**；若新機密載體 section 出現，另須同步 `safety-check.js` 的 `CODEX_CONFIG_HARD_BLOCK_SECTIONS`。**top-level 翻黑名單的前置條件**：先盤出 Codex top-level 裝置 key 全集（`model`／`approval_policy`／`sandbox_mode` 等），另開 change 決策，不做半吊子翻轉。
- **安全審核由 `npm run safety:check` 承擔**：唯讀、離線掃描 `claude/`、`codex/`、`opencode/`、`skills-lock.json`，不掃 `test/`、`openspec/`、README 等非同步來源文件。hard block（exit 2）：secret value pattern、私鑰片段、絕對 HOME 路徑、repo settings.json 出現 `hooks`／credential helper、repo config.toml 出現機密載體 section；warning（exit 1）：settings.json env key 清單、敏感命名 key path、repo config.toml 出現裝置狀態 section（`CODEX_CONFIG_DEVICE_WARN_SECTIONS`）；clean exit 0。輸出只列分類與位置，不輸出值。text 掃描排除外部套件文件目錄（取捨與分層見 `safety-check.js` 檔頭）；增減排除目錄須改常數與 README。
- **構建規則**（來自全域 CLAUDE.md）：禁擅自執行 `npm run build`。
- **嚴禁洩漏敏感資訊到輸出**：`diff`／`status` 不得顯示 env 值，`safety:check` 不得顯示 secret 原值或完整 HOME 路徑。同步流程本身不再宣稱能阻止所有機密寫入 repo；`file`／`dir` 型項目仍原樣同步，commit 前須執行 `npm run safety:check` 與人工審核。
- **部分失敗可見度**：apply 中途拋例外時，`mirrorDir` 把已完成變更附掛到 `SyncError.context.partialChanges`，`applySyncItems` 補印、`warnPartialApply` 警告「已寫入 N 筆變更」——與 `handleSignal` 的訊號中斷警告互補，已寫入的檔案不得零可見度。操作歷史由 git 承載，不另寫 log 檔。

## Skills 管理

Skills 分兩層：

| 位置 | 路徑 | 說明 |
|---|---|---|
| 全域（同步） | `claude/skills/<name>/SKILL.md` | 同步到 `~/.claude/skills/`，跨裝置共用 |
| 本地（不同步） | `.agents/skills/<name>/SKILL.md` | 僅限本 repo 使用，跨工具共享（Codex 等） |

本地 skill 實體放在 `.agents/skills/`。**Claude Code 端**靠 `.claude/skills` symlink（→ `../.agents/skills`）讀取。**Codex 端無需 symlink**：Codex CLI 原生把 `.agents/skills`（專案層）與 `~/.agents/skills`（全域層）納入 skill 探索路徑，直接讀同一份實體。新增本地 skill 直接放進 `.agents/skills/<name>/SKILL.md` 即可。

**Windows clone 注意**：`.claude/skills` 這個 git symlink 在 Windows 需「開發者模式」或管理員權限才會還原為真正的 symlink，否則會 fallback 成內容為路徑字串的純文字檔，導致 Claude Code 找不到 skill。在 Windows 11 設定 → 系統 → 開發人員選項中開啟即可。（Codex 不受此影響：它直接讀 `.agents/skills` 實體目錄，不經 symlink。）

全域 skills 安裝狀態由 `skills-lock.json` 追蹤（`npm run skills:diff` 比對）。本地 skills 不需記錄於 `skills-lock.json`。

Skills 遵循 [Agent Skills](https://agentskills.io) 開放標準，可跨工具移植（Cursor、Gemini CLI、Codex 等）。新增 skill 一律使用此格式，不再新增 command。

## Agents 管理

### Claude Code（`claude/agents/`）

以 package 子目錄組織，目前唯一來源：

1. **`everything-claude-code/`** — 來自 `affaan-m/everything-claude-code`，上游 `agents/` 為扁平結構（無分類層級）

> `VoltAgent/awesome-claude-code-subagents`（原補充來源）已於 2026-06 下架移除；此 repo 的 agent 庫定位為「只收隔離審查／探索型 agent」，builder 類一律走 skill，不再以 agent 收錄。

**新增 agent 的方式**（用 `gh` 抓原始內容）：
```bash
# 從 everything-claude-code
gh api repos/affaan-m/everything-claude-code/contents/agents/<name>.md --jq '.content' | base64 -d > claude/agents/everything-claude-code/<name>.md
```

### Codex

**目前無任何 Codex agent，`codex/agents/` 未列 `SYNC_MANIFEST`**（原唯一上游 `VoltAgent/awesome-codex-subagents` 已隨 claude 端 awesome 一併下架；目錄與同步項目已移除，不做預防性保留）。日後若要新增：在 `SYNC_MANIFEST` 加回 `{ area: 'codex', label: 'agents', type: 'dir' }` 一列，以 package 子目錄組織（對稱於 `claude/agents/`），且原則為只抓 Claude 端已有同名 agent 的對應 `.toml`（避免 codex 與 claude agents 失同步）。Codex CLI 透過 `collect_agent_role_files` 遞迴掃描 `~/.codex/agents/` 下所有層級的 `.toml`（[原始碼參考](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/agent_roles.rs)），agent 識別以 TOML 內 `name` 欄位為準，與檔名/路徑無關。

## 注意事項

- `.DS_Store` 在 `.gitignore`；`.agents/skills/` 為本地 skill 實體目錄，**已納入版控**
- Skills 不在自動同步範圍，`skills-lock.json` 為各裝置參考清單（source of truth）
- 上游 `npx skills` 功能追蹤見 `UPSTREAM.md`（跨裝置還原、Claude Code symlink bug 等，修改 skills 流程前先查）
