# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

此 repo 是 Claude Code 跨裝置設定同步工具，透過私有 Git repo 讓多台裝置的 Claude Code 設定保持一致。

## 目錄命名（重要）

- **`claude/`**（無點）— 要同步到 `~/.claude/` 的全域設定內容（CLAUDE.md、settings.json、statusline.sh、agents、commands、skills、rules），由 `sync.js` 管理。
- **`codex/`**（無點）— 要同步到 `~/.codex/` 的全域設定（AGENTS.md、config.toml 過濾欄位、agents `.toml`），由 `sync.js` 管理。
- **`.claude/`**（有點）— 本 repo 專用的 Claude Code 本地設定（`settings.json` 等），**不參與同步、不映射到 `~/.claude/`**。`.claude/skills` 是 symlink 指向 `../.agents/skills`。
- **Codex 本地 skill** — **不需建 `.codex/skills`**。Codex CLI 會自動探索 `.agents/skills`：專案層由 `repo_agents_skill_roots` 從 project root 逐層掃 `<dir>/.agents/skills`，全域層掃 `~/.agents/skills`（原始碼 `codex-rs/core-skills/src/loader.rs` 的 `skill_roots()`）。故本 repo 的 `.agents/skills` 對 Codex 直接生效，無需 symlink。
- **`.agents/skills/`** — 本地 skill **實體目錄**（已納入版控），跨工具（Claude Code / Codex）共用來源；遵循 [Agent Skills](https://agentskills.io) 開放標準。

新增同步項目：Claude Code 放 `claude/`、Codex 放 `codex/`；新增本地 skill 一律放 `.agents/skills/<name>/`。勿誤放到 `.claude/` 或 `.codex/`。

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

**Fork / 初始化：**
- `npm run init` — 把作者個人資料重置為空骨架（從 `.example` 範本覆寫正式檔、刪除 `claude/rules/` 個人化規則）。**fork 後執行一次**，作者本人日常不需執行。支援 `--dry-run` 預覽

**全域旗標**（`node sync.js` 直接呼叫時可用）：`--dry-run`、`--yes`（別名 `--force`，略過互動確認；非互動環境執行 to-local／init 必加）、`--verbose`、`--version`、`--help`。**不在白名單內的旗標（含 typo 如 `--dryrun`）會拋 `INVALID_ARGS` 而非被靜默忽略**——避免打錯字略過 dry-run 真寫入。指令別名：`d`/`s`/`tr`/`tl`/`sd`/`sa`/`sr`（`init` 與 `safety:check` 無別名）。

## 同步項目與對應

| repo 路徑 | 本機路徑 | 備註 |
|-----------|----------|------|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | 全文比對 |
| `claude/settings.json` | `~/.claude/settings.json` | **top-level 採黑名單制：預設同步，僅排除 `DEVICE_SETTINGS_KEYS` 明確黑名單（裝置偏好 `model`／`effortLevel`／`defaultShell`／`tui`／`autoUpdatesChannel`、平台綁定 `hooks`、憑證 helper `apiKeyHelper`／`awsCredentialExport`／`awsAuthRefresh`／`otelHeadersHelper`）。`SENSITIVE_KEY_PATTERN` 不再參與同步剝除或中止；敏感命名 key 依一般 settings 差異同步，改由 `npm run safety:check` warning。`env` key 全部依一般同步語意同步，不再因 `DEVICE_ENV_KEYS` 或 pattern 被剝除／保留；明細 diff 對 env 值遮罩為 `***`（`maskEnvValuesForDisplay`）**。安全審核改由 `safety:check` 手動執行 |
| `claude/statusline.sh` | `~/.claude/statusline.sh` | 全文比對 |
| `claude/agents/` | `~/.claude/agents/` | 以 package 子目錄組織（如 `everything-claude-code/`） |
| `claude/commands/` | `~/.claude/commands/` | 目錄鏡射 |
| `claude/skills/` | `~/.claude/skills/` | 目錄鏡射 |
| `claude/rules/` | `~/.claude/rules/` | 模組化全域規則（CLAUDE.md 的拆分檔），支援 frontmatter `paths:` 做 path-specific scoping |
| `codex/AGENTS.md` | `~/.codex/AGENTS.md` | Codex 全域指示（跨專案規則），全文比對 |
| `codex/config.toml` | `~/.codex/config.toml` | 僅同步可攜欄位（`personality`、`web_search`、`tui.status_line`、`features.memories`、`features.goals`、`memories.generate_memories`、`memories.use_memories`、`plugins.*.enabled`）；裝置特定欄位與未知欄位保留本機值 |
| `codex/agents/` | `~/.codex/agents/` | Codex `.toml` agents，以 package 子目錄組織；Codex CLI 遞迴掃描子目錄載入（目前無 agent） |

### 刻意不同步（勿加入 `buildSyncItems`）

- **`~/.claude.json`** — 含 MCP server 設定與憑證、專案級狀態，屬高風險敏感檔，**永遠不同步**。

## 架構重點

**主入口 + safety 模組**：`sync.js` 為主 CLI 入口（同步／diff／skills／init 邏輯），`safety:check` 掃描與輸出獨立於 `safety-check.js`。兩檔零外部相依、只用 Node.js 內建模組。`safety-check.js` **不反向 require `sync.js`**：透過 `createSafetyChecker(deps)` 由 `sync.js` 注入共用工具（`REPO_ROOT`、`getFiles`、`readFileSafe`、`readJson`、`toRelativePath`、`maskHome`、`col`、`EXIT_*`）；`sync.js` 以 lazy singleton 建立 checker（避開 const 相依的 TDZ），`runSafetyCheck`／`runSafetyChecks` 僅為轉接。safety 專屬常數（`SENSITIVE_KEY_PATTERN` 等 pattern、掃描範圍）由 `safety-check.js` 持有並被 `sync.js` re-export，避免漂移。對外入口 `node sync.js safety:check` 與 `npm run safety:check` 不變。檔案結構採 section banner 分段，關鍵不變式：

- **所有函式 ≤ 60 行**（經 iter4/iter5 稽核強制）— 新增函式若超過需拆分
- **Data-driven dispatch**：`COMMANDS` 物件含 `handler`，`main()` 透過 `await COMMANDS[cmd].handler(opts)` 派發，**新增指令只需改 `COMMANDS`**
- **SyncItem 抽象 + 型別行為查表**：`buildSyncItems()` 產出宣告式 `SyncItem[]`；型別行為由 `SYNC_TYPE_HANDLERS`（`{ diff, apply, isDir }`）集中分派，`diffSyncItems` / `applySyncItems` / `buildFullDiffList` 三個消費端皆查表，**新增同步類型只需在 `SYNC_TYPE_HANDLERS` 加一筆**，不必逐處改 `if (type===...)`。方向相依的 codex 項目走 `buildSwapItem` 統一交換 src/dest
- **Atomic write**：底層 `writeFileSafe` 先寫同目錄暫存檔（隨機尾碼 + `flag:'wx'` O_EXCL）再 rename（同檔系統避免 EXDEV），所有寫入路徑（`writeJsonSafe`、`writeTextSafe`、`copyFile`、`mirrorDir`）皆走此函式。提供**原子性**（避免半截損壞），但**不付 fsync 成本、不保證持久性**（設定檔對持久性需求低）。diff 暫存檔走 `createTmpDiffFile`（os.tmpdir() 下隨機名 + O_EXCL，防共用 /tmp 的 symlink 攻擊 CWE-377/59）。對稱的 `readFileSafe` 統一將讀取例外包成 `SyncError`（帶 path context），不讓裸 fs 例外穿透 `formatError`
- **統一錯誤處理**：`SyncError` class（`code` + `context`）+ 檔尾 `.catch(formatError)`，所有路徑經 `formatError`，**禁止**裸 `console.error + process.exit`
- **Exit code 語義**：`EXIT_OK=0`（成功或 diff 無差異）、`EXIT_DIFF=1`（diff 有差異，可用於 CI）、`EXIT_ERROR=2`
- **Relative path 遮罩**：`toRelativePath` 處理 REPO_ROOT 與 `$HOME` → `~/`，`printFileDiff` 的 diff header 亦走此函式避免洩漏使用者名稱
- **Skills lock 為純資料 manifest**：`skills-lock.json` 不參與同步流程；`runSkillsDiff` 直接讀 `~/.agents/.skill-lock.json`（`npx skills` CLI 的原生 lock 檔）與 repo `skills-lock.json` 做集合比對，**只輸出建議指令、不執行安裝/移除**。刻意不用 `npx skills list -g`，因為它會掃目錄並把 `sync.js` 同步管理的 `~/.claude/skills/` skill（如 `ob`、`pen-design`）也列入，造成誤報。本機多裝的 skills 會同時列出（A）`npm run skills:add` 加入 repo 與（B）`npx skills remove` 從本機移除兩種選項

**測試策略**：`test/` 下分六個檔案（`sync.test.js` 純函式、`settings.test.js` 設定欄位與 `mergeSettingsBetween` 同步心臟、`codex-config.test.js` Codex config.toml 過濾、`diff-integration.test.js` diff 整合、`apply-integration.test.js` 沙箱化 to-local/to-repo 端到端 apply、`boundary.test.js` 邊界情境與安全防線），共用 helper 在 `test/helpers.js`。純函式測試含 `computeLineDiff`、`matchExclude`、`statusToStatsKey`、`parseSkillSource`、`parseArgs`、`toRelativePath`、`COMMANDS` 完整性。**破壞性 apply 與 direction-aware diff 走沙箱整合測試**：`apply-integration.test.js` 把 `sync.js` **與 `safety-check.js`**（`sync.js` require 之，缺檔即崩）複製進 tmp 當 repo（`__dirname`/`REPO_ROOT` 落 tmp）並以 `HOME` 沙箱化本機，雙向皆不觸碰真實 `~/.claude` 或真實 repo；`boundary.test.js` 的 `safety:check` sandbox 同樣兩檔並抄（`SAFETY_RUNTIME_FILES`）。若改純函式，**必須**同步更新 unit test，維持全數通過（視同 100% 覆蓋）。

## 修改守則

- **README.md 須同步更新**：新增/移除指令、改變同步項目、調整行為、新增旗標時必跟。
- **新增/調整 npm script 時須同步更新 README 的指令別名表與 `COMMANDS` 物件**，避免別名與 handler 漂移。
- **函式行數守則**：新增或重構後若某函式 > 60 行，需拆分（`buildSyncItems` 54 行為宣告式陣列，例外）。
- **禁止新增外部相依**：所有功能必須使用 Node.js 內建模組，不得 `npm install` 任何套件。
- **settings.json top-level 採黑名單制**（`DEVICE_SETTINGS_KEYS`）：預設同步官方 top-level 欄位，僅排除黑名單列舉（裝置偏好、平台綁定 `hooks`、憑證 helper）。`SENSITIVE_KEY_PATTERN` 不再作為同步剝除或中止條件；敏感命名 key 依一般 settings 差異同步，改由 `npm run safety:check` 以 warning 供人工審核。strip／preserve 由 `partitionSettingsTopLevel` 同源保證互補；增減黑名單欄位須改 `DEVICE_SETTINGS_KEYS` 常數與 README。
- **settings.json `env` 區塊全部依一般同步語意同步**：不再因 `DEVICE_ENV_KEYS` 或 `SENSITIVE_KEY_PATTERN` strip，也不在 to-local 特別保留本機 env key。`DEVICE_ENV_KEYS` 僅保留為既有 review 清單參考。diff／status 顯示層仍由 `maskEnvValuesForDisplay` 將 env 值遮罩為 `***`；這只保護輸出，不代表 repo 內容安全。
- **安全審核改由 `npm run safety:check`**：唯讀、離線掃描 `claude/`、`codex/`、`skills-lock.json`，不掃 `test/`、`openspec/`、README 等非同步來源文件。hard block：已知 secret value pattern、私鑰片段、絕對 HOME 路徑、repo `claude/settings.json` 出現 `hooks` 或 credential helper 欄位；warning：`claude/settings.json` env key 清單與結構化設定中命中 `SENSITIVE_KEY_PATTERN` 的 key path。輸出只列分類、檔案與欄位／key／line，不輸出 env 值、secret 原值或完整 HOME 路徑。exit code：clean 0、只有 warning 1、任一 hard block 2。
- **構建規則**（來自全域 CLAUDE.md）：禁擅自執行 `npm run build`。
- **嚴禁洩漏敏感資訊到輸出**：`diff`／`status` 不得顯示 env 值，`safety:check` 不得顯示 secret 原值或完整 HOME 路徑。同步流程本身不再宣稱能阻止所有機密寫入 repo；`file`／`dir` 型項目仍原樣同步，commit 前須執行 `npm run safety:check` 與人工審核。
- **部分失敗可見度**：apply 中途拋例外時，`mirrorDir` 把已完成變更附掛到 `SyncError.context.partialChanges`，`applySyncItems` 補印並經 `logPartialApply` 記入 `.sync-history.log`（標記「因錯誤中斷」）——與 `handleSignal` 的訊號中斷警告互補，已寫入的檔案不得零可見度。

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

### Codex（`codex/agents/`）

以 package 子目錄組織（對稱於 `claude/agents/`）。Codex CLI 透過 `collect_agent_role_files` 遞迴掃描 `~/.codex/agents/` 下所有層級的 `.toml`（[原始碼參考](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/agent_roles.rs)），agent 識別以 TOML 內 `name` 欄位為準，與檔名/路徑無關。

**目前 `codex/agents/` 無任何 agent**（原唯一上游 `VoltAgent/awesome-codex-subagents` 已隨 claude 端 awesome 一併下架）。日後若要新增，原則為只抓 Claude 端已有同名 agent 的對應 `.toml`（避免 codex 與 claude agents 失同步）。

## 注意事項

- `.sync-history.log`、`.DS_Store` 在 `.gitignore`；`.agents/skills/` 為本地 skill 實體目錄，**已納入版控**
- Skills 不在自動同步範圍，`skills-lock.json` 為各裝置參考清單（source of truth）
- 上游 `npx skills` 功能追蹤見 `UPSTREAM.md`（跨裝置還原、Claude Code symlink bug 等，修改 skills 流程前先查）
