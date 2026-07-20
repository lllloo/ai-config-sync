# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

此 repo 是 Claude Code 跨裝置設定同步工具，透過私有 Git repo 讓多台裝置的 Claude Code 設定保持一致。

## 目錄命名（重要）

- **`claude/`**（無點）— 要同步到 `~/.claude/` 的全域設定內容（CLAUDE.md、settings.json、statusline.sh、rules），由 `sync.js` 管理。**全域 skill 不放這裡**（唯一落點為 `agents/skills/`，見下）。
- **`codex/`**（無點）— 要同步到 `~/.codex/` 的全域設定（`AGENTS.md` 與可攜 MCP 來源 `mcp.json`），由 `sync.js` 管理。`config.toml` **不做整檔同步、也永不被寫入**：MCP 為 advisory 型，只唯讀比對並輸出 `codex mcp add` 指令。
- **`opencode/`**（無點）— 要同步到 `~/.config/opencode/` 的全域設定（`opencode.jsonc` 主設定、`AGENTS.md` 全域指示），由 `sync.js` 管理。opencode 採 XDG 佈局，設定家在 `~/.config/opencode`（非 `~/.opencode`）。
- **`agents/`**（無點）— 要同步到 `~/.agents/` 的**跨工具全域** skill（`agents/skills/<name>/`），由 `sync.js` 的 `xtool-skills` 型管理。正典為 `~/.agents/skills/`（Codex 原生掃），apply 另於 `~/.claude/skills/<name>` 建 symlink 橋供 Claude Code 探索。與 `npx skills` **共管** `~/.agents/skills/`：非 prune、只認受管名字、撞名（`~/.agents/.skill-lock.json` 已登記）拒寫（見下方 Skills 管理）。
- **`.claude/`**（有點）— 本 repo 專用的 Claude Code 本地設定（`settings.json` 等），**不參與同步、不映射到 `~/.claude/`**。`.claude/skills` 是 symlink 指向 `../.agents/skills`。
- **Codex 本地 skill** — **不需建 `.codex/skills`**。Codex CLI 會自動探索 `.agents/skills`：專案層由 `repo_agents_skill_roots` 從 project root 逐層掃 `<dir>/.agents/skills`，全域層掃 `~/.agents/skills`（原始碼 `codex-rs/core-skills/src/loader.rs` 的 `skill_roots()`）。故本 repo 的 `.agents/skills` 對 Codex 直接生效，無需 symlink。
- **`.agents/skills/`** — 本地 skill **實體目錄**（已納入版控），跨工具（Claude Code / Codex）共用來源；遵循 [Agent Skills](https://agentskills.io) 開放標準。

新增同步項目：Claude 設定放 `claude/`、Codex 放 `codex/`、opencode 放 `opencode/`、**全域 skill 一律放 `agents/skills/<name>/`**（跨工具，唯一落點）；新增**本地** skill 一律放 `.agents/skills/<name>/`（有點）。勿誤放到 `.claude/` 或 `.codex/`。`agents/`（無點，同步）與 `.agents/`（有點，本地）是兩回事，勿混淆。

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
| `claude/settings.json` | `~/.claude/settings.json` | **top-level 採黑名單制**：預設同步，僅排除 `DEVICE_SETTINGS_KEYS` 黑名單（裝置偏好、平台綁定 `hooks`；只列本機實際存在的 key、不做預防性列名，憑證 helper 由 `safety:check` hard block 兜底；清單見 `sync.js` 常數與 README，有 drift-guard 測試把關）。敏感命名 key 與 `env` 全部依一般同步語意同步，安全審核改由 `safety:check`；`diff`／`status` 只輸出狀態行、不印設定內容。**首次出現的 top-level key** 由 `diff`／`to-repo` 印 key 名提示（`findNewSettingsTopKeys`，只比 key 集合差集），供人工查驗是否補列黑名單 |
| `claude/statusline.sh` | `~/.claude/statusline.sh` | 全文比對 |
| `agents/skills/` | `~/.agents/skills/` | **跨工具全域** skill（`xtool-skills` 型，全域 skill 唯一落點）。正典為 `~/.agents/skills/<name>/`（真實目錄，Codex 原生掃）；apply 另建 `~/.claude/skills/<name>` symlink 橋供 Claude 探索（官方支援、自動去重）。**非 prune、與 `npx skills` 共管**：只認 repo `agents/skills/` 登記的受管名字，不刪／不吸入 npx 住戶；撞名（`~/.agents/.skill-lock.json` 已登記）拒寫、`diff` 以 `conflict` 標示。dir→symlink 轉換內生於此型的 apply，**不依賴與其他 manifest 列的相對順序** |
| `claude/rules/` | `~/.claude/rules/` | 模組化全域規則（CLAUDE.md 的拆分檔），支援 frontmatter `paths:` 做 path-specific scoping |
| `codex/AGENTS.md` | `~/.codex/AGENTS.md` | Codex 全域指示（跨專案規則），全文比對 |
| `claude/mcp.json` | `~/.claude.json` 的 top-level `mcpServers`（**唯讀**） | `advisory` fixed-flow 型（`homeRootFile: '.claude.json'`）；repo 只存 `type: http`／`sse`／`stdio`、HTTPS `url` 或白名單 `command`＋`args`、諮詢性 `envKeys`。`to-local` 只輸出 `claude mcp add --scope user ...` 指令，**不寫入 `~/.claude.json`** |
| `codex/mcp.json` | `~/.codex/config.toml` 的受管 `[mcp_servers.*]`（**唯讀**） | `advisory` fixed-flow 型；repo 只存 `transport`／HTTPS `url`／`enabled`。`to-local` 只輸出 `codex mcp add` 指令，**不寫入 `config.toml`**。本機 `http_headers.Authorization` 解析時容忍、不讀值、不寫回 repo |
| `opencode/opencode.jsonc` | `~/.config/opencode/opencode.jsonc` | opencode 全域主設定，整檔 `file` 型同步。**XDG 佈局**：homeBase 為 `~/.config/opencode`。**檔名變體**：`.jsonc`／`.json` 由 manifest `variants` 欄位解析出兩端一致的 canonical label（`.jsonc` 優先），杜絕重複檔；機制見 `SYNC_MANIFEST`／`resolveVariantLabel` 註解 |
| `opencode/AGENTS.md` | `~/.config/opencode/AGENTS.md` | opencode 全域指示，`file` 型整檔同步，獨立於 Claude 的 `CLAUDE.md`（opencode 缺此檔時會 fallback 讀 `~/.claude/CLAUDE.md`，維護獨立一份可與 Claude 分歧） |

### 刻意不同步（勿加入 `buildSyncItems`）

- **`~/.codex/config.toml`** — 不進 repo、不做整檔同步，且**永不被本工具寫入**（advisory 收斂後連 section-level 投影也移除）。**不要新增 `codex/config.toml` 或整檔 manifest 列**，也**不要讓 `type: 'mcp'` 復活**（`sync.test.js` 兩條回歸鎖）。
- **`~/.codex/.ai-config-sync-mcp-state.json`** — 舊版投影同步的受管 state，**已完全不再讀寫**；升級後為孤兒檔，README 註明可手動 `rm`（不代刪：為清理而寫本機檔會與「不寫入本機」自相矛盾）。Supermemory API Key 留在 `config.toml` 的本機 Authorization header；OAuth／ChatGPT 登入狀態亦不同步。
- **`~/.claude.json`** — 含 OAuth token、專案級歷史與 MCP 設定，屬高風險敏感活檔，**永不被寫入**；唯一放寬處是唯讀讀取 top-level `mcpServers` 作比對。
- **opencode 機密與資料目錄** — `~/.local/share/opencode`（含 `auth.json`、`opencode.db`）、`~/.cache/opencode`、`~/.local/state/opencode`。因 opencode area 的 `homeBase` 鎖定 `~/.config/opencode`，這些分屬不同根目錄的機密與資料**天生不在同步射程**，無需顯式排除。
- **opencode 執行期產物** — `~/.config/opencode` 內的 `node_modules/`、`package.json`、`package-lock.json`、`plugins/`（插件執行期產物）。因 `SYNC_MANIFEST` 只列 `opencode.jsonc`／`AGENTS.md` 兩個具名 `file`、未列任何 opencode `dir` 型項目，這些**未列入即不被同步**（無需 `exclude` 機制）。未來新增 opencode `dir`（如 `skills/`）時才需評估 `exclude`。

## 架構重點

**主入口 + safety／toml-reader／skills／MCP 模組**：`sync.js` 為主 CLI 入口；`safety-check.js`、`toml-reader.js`、`skills.js`、`mcp.js`、`claude-mcp.js` 各自承載安全掃描、TOML 語句、skills 與兩端 MCP。六檔零外部相依、只用 Node.js 內建模組，功能模組不反向 require `sync.js`：

- `safety-check.js`：safety 專屬常數與掃描邏輯由本檔持有，測試直接 require 該模組（`sync.js` 不 re-export）。共用工具由 `sync.js` 經 `createSafetyChecker(deps)` 注入；TOML 解析改為**直接 require `toml-reader.js`**（純函式、零 IO，非 `sync.js` 故不違反反向 require 禁令）。text pattern 掃描排除外部套件文件目錄（`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`，整類 false positive）。**注入邊界、掃描分層與取捨的完整說明見該檔檔頭註解**。
- `toml-reader.js`：TOML 邏輯語句讀取器（`readTomlStatements`／`matchTomlHeader`／`scanTomlValueState`），純函式、零 IO、不被 `sync.js` 使用。唯一消費者是 `safety-check.js` 的 `.toml` 掃描——**section 歸屬正確性直接決定 hard block 判斷**，故 `test/toml-reader.test.js` 是安全防線的回歸網，不可刪。前身為 `codex-config.js` 的解析半部（config.toml 同步移除後，過濾／序列化／合併半部一併刪除）。
  - **header 解析為引號感知**（`findTomlHeaderEnd`）：TOML section 名可含帶 `]` 的引號 key（`[mcp_servers."a]b"]`）。用 `[^\]]+` 之類的 regex 會提前截斷、整行判為非 header，其下 key 誤掛前一 section，**機密 section 的 hard block 會靜默降級成 warning**。改動 header 解析須保住 `test/toml-reader.test.js` 與 `boundary.test.js` 的 F2 回歸測試。
  - **malformed header 為 fail-closed**：`[` 開頭但無法解析的行回傳 `{type:'section', name:null}`（不是 `other`），`safety-check.js` 據此 hard block 並清空 section。理由：section 名不可信時機密判斷失去依據，寧可擋下讓人工檢視，也不沿用前一 section 名而漏判。
- `skills.js`：skills 指令族（`skills:diff`／`skills:add`／`skills:remove`）的 lock 檔讀取、三向集合差、name/source 驗證、terminal 清洗與輸出格式化。**不反向 require `sync.js`**：共用常數與工具（`REPO_ROOT`、`LOCAL_SKILL_LOCK`、`EXIT_OK`／`EXIT_DIFF`、`SyncError`／`ERR`、`readJson`／`writeJsonSafe`、`printSectionDivider`／`printStatusLine`、`col`）以 `createSkillsHandler(deps)` DI 注入，`fs`／`path` 由本檔自 require。`sync.js` 以 lazy singleton（照 `_safetyChecker` 樣式）建立 handler、經 `runCommand` 三個 case 分派。**對外契約**為回傳的 `{ runSkillsDiff, runSkillsAdd, runSkillsRemove }`；deps-bound helper（`loadSkillsFromLock`／`validateSkillName`／`validateSkillSource`／`parseSkillSource`）一併附在回傳物件上，僅作 `sync.js` re-export 與單元測試 seam（`runCommand` 不使用）。純函式 `computeSkillsDiff`／`sanitizeForTerminal` 於模組層直接匯出。`isNpxManagedSkill`（Sync Core）與 `runStatus` 對 skills 的呼叫亦經此 singleton 轉接。
- `mcp.js`：MCP 來源 schema、**共用憑證判準**（`findUrlCredentialPaths`／`findArgsCredentialPaths`／`isSuspiciousToken`，兩端與 `safety:check` 共用）、Codex `config.toml` 的唯讀 section 解析與 `codex mcp add` 指令產生。`createMcpHandler(deps)` 注入的 `writeFileSafe` **只用於 repo 端**；本檔已無任何寫入 `config.toml` 的路徑（投影、state、Authorization surgical preservation 均已移除）。受管 section 的未知 key 仍 fail closed，理由是「比對結論不可信」而非「我們要重寫它」。
- `claude-mcp.js`：Claude MCP 來源 schema、`~/.claude.json` 的唯讀 inspect（`JSON.parse` 整檔，不需字元級掃描器）與 `claude mcp add` 指令產生。`createClaudeMcpHandler(deps)` 同樣只對 repo 端寫入。憑證判準自 `mcp.js` 取得（純函式，非 `sync.js`，不違反反向 require 禁令）。**本檔刻意不存在寫入 `~/.claude.json` 的程式路徑**——那是架構選擇而非紀律要求。

檔案結構採 section banner 分段，關鍵不變式：

- **所有函式 ≤ 60 行**（經 iter4/iter5 稽核強制）— 新增函式若超過需拆分。**唯一例外**：DI factory（`createSafetyChecker`／`createSkillsHandler`／`createMcpHandler`／`createClaudeMcpHandler`）為「注入依賴後包住一組短小巢狀閉包」的命名空間包裝，本體行數為閉包集合的總和、非單一邏輯流程，不受此限；其內部各閉包仍須 ≤ 60 行
- **指令分派（switch）**：`COMMANDS` 物件為 `{ alias, desc }`（名稱／別名／說明的單一來源）；`main()` 先檢查 `COMMANDS[cmd]` 是否存在，再由 `runCommand(cmd, opts)` 以明確 `switch` 分派到各 `runXxx`。**新增指令需同步改 `COMMANDS`（登錄名稱／別名／說明）與 `runCommand` 的 `switch`（接上 handler）**——刻意不走 handler 注入表，換取分派可讀性
- **宣告式同步項目 `SYNC_MANIFEST`**：一列 = 一路徑；可選 `homeLabel` 表示本機檔名不同於 repo `label`（`mcp.json → config.toml`），可選 `homeRootFile` 表示本機端在 `$HOME` 下、不套用 area `homeBase`（`~/.claude.json`）。`fixedFlow` 項目 src/dest 固定不交換，由 `settings`／`advisory` handler 依 direction 決定行為。
- **型別行為分派（switch）**：`SyncItem.type`（`file`／`settings`／`advisory`／`dir`／`xtool-skills`）由 `diffSyncItem`／`applySyncItem` 明確分派；`advisory` 經 `advisoryHandler(item)` 依 `item.area` 選 Claude／Codex handler，以每個 Server 產生狀態行，禁止輸出設定值。apply 回傳 `action: 'advice'`，`applySyncItems` 不計入 stats、`runToLocal` 不納入確認閘門。
- **Atomic write**：底層 `writeFileSafe` 先寫同目錄暫存檔（隨機尾碼 + `flag:'wx'` O_EXCL）再 rename（同檔系統避免 EXDEV），所有寫入路徑（`writeJsonSafe`、`writeTextSafe`、`copyFile`、`mirrorDir`）皆走此函式。提供**原子性**（避免半截損壞），但**不付 fsync 成本、不保證持久性**（設定檔對持久性需求低）。對稱的 `readFileSafe` 統一將讀取例外包成 `SyncError`（帶 path context），不讓裸 fs 例外穿透 `formatError`。diff 全程唯讀、只輸出狀態行，不產生任何暫存檔
- **統一錯誤處理**：`SyncError` class（`code` + `context`）+ 檔尾 `.catch(formatError)`，所有路徑經 `formatError`，**禁止**裸 `console.error + process.exit`
- **Exit code 語義**：`EXIT_OK=0`（成功或 diff 無差異）、`EXIT_DIFF=1`（diff 有差異，可用於 CI）、`EXIT_ERROR=2`
- **Relative path 遮罩**：`toRelativePath` 處理 REPO_ROOT 與 `$HOME` → `~/`，`logVerbosePaths` 與 `SyncError` context 的 path 顯示亦走此函式避免洩漏使用者名稱
- **Skills lock 為純資料 manifest**：`skills-lock.json` 不參與同步流程；`runSkillsDiff` 直接讀 `~/.agents/.skill-lock.json`（`npx skills` CLI 的原生 lock 檔）與 repo `skills-lock.json` 做集合比對，**只輸出建議指令、不執行安裝/移除**。刻意不用 `npx skills list -g`，因為它會掃目錄並把 `sync.js` 同步管理的 skill（`agents/skills/` 的受管名字，於 `~/.agents/skills/` 為正典、於 `~/.claude/skills/` 為 symlink 橋，如 `pen-design`、`mini-research`）也列入，造成誤報。本機多裝的 skills 會同時列出（A）`npm run skills:add` 加入 repo 與（B）`npx skills remove` 從本機移除兩種選項

**測試策略**：`test/mcp.test.js` 與 `test/claude-mcp.test.js` 覆蓋兩端 schema、憑證判準、唯讀解析與指令產生；advisory 的「零寫入」由整合測試以**內容 + mtime 雙重斷言**把關（只驗內容會漏掉「寫入相同內容」的情況）。`diff-integration.test.js`／`apply-integration.test.js` 的 `SYNC_RUNTIME_FILES` 與 `boundary.test.js` 的 `SAFETY_RUNTIME_FILES` 必須同時包含 `sync.js`、`safety-check.js`、`toml-reader.js`、`skills.js`、`mcp.js`、`claude-mcp.js`，不得依賴真實 HOME。既有 drift guards（commands、README、`config.toml` 整檔禁入）與「兩端 MCP 皆 advisory」「`type: 'mcp'` 不得復活」兩條 guard 均須保持通過。

## 修改守則

- **README.md 須同步更新**：新增/移除指令、改變同步項目、調整行為、新增旗標時必跟。指令別名表與黑名單常數清單已有 drift-guard 測試把關（漏改 README 會 fail），其餘敘述仍靠人工。
- **新增/調整 npm script 時須同步更新 README 的指令別名表、`COMMANDS` 物件與 `runCommand` 的 `switch`**（三者為指令名稱／別名／分派的來源；三條鏈皆有 drift-guard 測試把關）。
- **函式行數守則**：新增或重構後若某函式 > 60 行，需拆分。同步項目的宣告式資料改由 `SYNC_MANIFEST`／`SYNC_AREAS` 常數承載，`buildSyncItems`／`materializeSyncItem` 皆為小函式，無超行例外。
- **禁止新增外部相依**：所有功能必須使用 Node.js 內建模組，不得 `npm install` 任何套件。
- **settings.json top-level 採黑名單制**（`DEVICE_SETTINGS_KEYS`）：預設同步官方 top-level 欄位，僅排除黑名單列舉。敏感命名 key 不再被同步剝除或中止，改由 `safety:check` warning 供人工審核；`env` 區塊全部依一般同步語意同步，diff／status 不印任何設定內容。strip／preserve 由 `partitionSettingsTopLevel` 同源保證互補；增減黑名單欄位須改 `DEVICE_SETTINGS_KEYS` 常數與 README（drift-guard 測試把關）。
- **MCP 不得寫入本機**：`to-local` 對兩端 MCP 只能輸出建議指令。不要新增 `codex/config.toml` 或整檔 manifest 列，不要讓 `type: 'mcp'` 復活，也不要為了「順便清理」而刪除孤兒 state 檔。可攜欄位只能改兩份 `mcp.json` 的白名單 schema，並同步更新 validator、safety、測試與 README；OAuth／headers／env 值／token 不得加入 repo。本機 `http_headers.Authorization` 只可容忍其存在，不得解析、比較、輸出或寫回 repo。
- **憑證判準不得放寬**：`isSuspiciousToken` 的門檻與 fail-closed 語意是安全防線，不得為了通過某個合法長 URL 而加繞過旗標或例外清單；誤擋時改用 `envKeys` 或本機手動維護。
- **安全審核由 `npm run safety:check` 承擔**：唯讀、離線掃描 `claude/`、`codex/`、`opencode/`、`skills-lock.json`，不掃 `test/`、`openspec/`、README 等非同步來源文件。hard block（exit 2）：secret value pattern、私鑰片段、絕對 HOME 路徑、repo settings.json 出現 `hooks`／credential helper、repo 內任何 `.toml` 出現機密載體 section（`CODEX_CONFIG_HARD_BLOCK_SECTIONS`）；warning（exit 1）：settings.json env key 清單、敏感命名 key path、`.toml` 出現裝置狀態 section（`CODEX_CONFIG_DEVICE_WARN_SECTIONS`）；clean exit 0。輸出只列分類與位置，不輸出值。text 掃描排除外部套件文件目錄（取捨與分層見 `safety-check.js` 檔頭）；增減排除目錄與兩份 section 常數須改常數與 README（drift-guard 測試把關）。
- **構建規則**（來自全域 CLAUDE.md）：禁擅自執行 `npm run build`。
- **嚴禁洩漏敏感資訊到輸出**：`diff`／`status` 不得顯示 env 值，`safety:check` 不得顯示 secret 原值或完整 HOME 路徑。同步流程本身不再宣稱能阻止所有機密寫入 repo；`file`／`dir` 型項目仍原樣同步，commit 前須執行 `npm run safety:check` 與人工審核。
- **部分失敗可見度**：apply 中途拋例外時，`mirrorDir` 把已完成變更附掛到 `SyncError.context.partialChanges`，`applySyncItems` 補印、`warnPartialApply` 警告「已寫入 N 筆變更」——與 `handleSignal` 的訊號中斷警告互補，已寫入的檔案不得零可見度。操作歷史由 git 承載，不另寫 log 檔。

## Skills 管理

Skills 分兩層（**以目錄位置分類**，不加 per-skill flag）：

| 位置 | 路徑 | 說明 |
|---|---|---|
| 全域·跨工具（同步） | `agents/skills/<name>/SKILL.md` | `xtool-skills` 型同步到 `~/.agents/skills/`（Codex 原生掃）+ `~/.claude/skills/<name>` symlink 橋（Claude 探索）。與 `npx skills` 共管、非 prune、撞名拒寫（判準：`~/.agents/.skill-lock.json` 登記；**「claude 側 symlink 存在」不得作為訊號**——與本機制自身產物無法區分，會破壞幂等） |
| 本地（不同步） | `.agents/skills/<name>/SKILL.md` | 僅限本 repo 使用，跨工具共享（Codex 等） |

全域 skill 一律放 `agents/skills/`，對 Claude 與 Codex 同時可見——**無 Claude-only 全域層**（原 `claude/skills/` 同步層因無住戶已移除，見 `SYNC_MANIFEST` 回歸鎖）。

本地 skill 實體放在 `.agents/skills/`。**Claude Code 端**靠 `.claude/skills` symlink（→ `../.agents/skills`）讀取。**Codex 端無需 symlink**：Codex CLI 原生把 `.agents/skills`（專案層）與 `~/.agents/skills`（全域層）納入 skill 探索路徑，直接讀同一份實體。新增本地 skill 直接放進 `.agents/skills/<name>/SKILL.md` 即可。

**Windows clone 注意**：`.claude/skills` 這個 git symlink 在 Windows 需「開發者模式」或管理員權限才會還原為真正的 symlink，否則會 fallback 成內容為路徑字串的純文字檔，導致 Claude Code 找不到 skill。在 Windows 11 設定 → 系統 → 開發人員選項中開啟即可。（Codex 不受此影響：它直接讀 `.agents/skills` 實體目錄，不經 symlink。）

全域 skills 安裝狀態由 `skills-lock.json` 追蹤（`npm run skills:diff` 比對）。本地 skills 不需記錄於 `skills-lock.json`。

**日後若要恢復 Claude-only 全域 skill 層**（`claude/skills/`）：在 `SYNC_MANIFEST` 加回 `{ area: 'claude', label: 'skills', type: 'dir' }` 一列，並同步更新 `test/sync.test.js` 的 claude label 清單 drift-guard 與**「不得含 claude 區 skills／commands dir 列」回歸鎖**、README 同步項目表與本段兩層表。**加回前須先重新評估**：該列會連帶復活「`xtool-skills` 列須排在其之前」的順序不變式（claude mirror 的 prune-extras 語意會與 agents 端的 symlink 橋競爭），完整推理見 `openspec/changes/archive/2026-07-15-cross-tool-global-skills/` 的 design D5 與 `2026-07-17-remove-tenantless-sync-layers`。不得只塞回一列 manifest。`commands` 層同理，且另違反「一律使用 skill、不再新增 command」政策。

Skills 遵循 [Agent Skills](https://agentskills.io) 開放標準，可跨工具移植（Cursor、Gemini CLI、Codex 等）。新增 skill 一律使用此格式，不再新增 command。

## Agents 管理

**目前無任何同步的 agent，`SYNC_MANIFEST` 未列任何 agents 項**（Claude 端 `claude/agents/` 與 Codex 端 `codex/agents/` 目錄與同步項目均已移除，不做預防性保留）。原 `everything-claude-code`（`affaan-m/everything-claude-code`）agent 庫因實用價值低（多為特定技術棧的 reviewer、與 Claude Code 內建 agent 重疊）已整批移除；同時 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 也移除了 `claude/agents/`（豁免隨目錄一併撤除）。

日後若要恢復 Claude agent 同步：在 `SYNC_MANIFEST` 加回 `{ area: 'claude', label: 'agents', type: 'dir' }` 一列（以 package 子目錄組織），並同步更新 `test/sync.test.js` 的 claude label 清單 drift-guard、README 同步項目表與目錄命名表。若要恢復 Codex agent：加回 `{ area: 'codex', label: 'agents', type: 'dir' }`，原則為只抓 Claude 端已有同名 agent 的對應 `.toml`。Codex CLI 透過 `collect_agent_role_files` 遞迴掃描 `~/.codex/agents/` 下所有層級的 `.toml`（[原始碼參考](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/agent_roles.rs)），agent 識別以 TOML 內 `name` 欄位為準，與檔名/路徑無關。

## 注意事項

- `.DS_Store` 在 `.gitignore`；`.agents/skills/` 為本地 skill 實體目錄，**已納入版控**
- Skills 不在自動同步範圍，`skills-lock.json` 為各裝置參考清單（source of truth）
- 上游 `npx skills` 功能追蹤見 `UPSTREAM.md`（跨裝置還原、Claude Code symlink bug 等，修改 skills 流程前先查）
