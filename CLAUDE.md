# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

此 repo 是 Claude Code 跨裝置設定同步工具，透過私有 Git repo 讓多台裝置的 Claude Code 設定保持一致。

## 目錄命名（重要）

- **`claude/`**（無點）— 要同步到 `~/.claude/` 的全域設定內容（CLAUDE.md、settings.json、statusline.sh、agents、commands、skills、rules），由 `sync.js` 管理。
- **`codex/`**（無點）— 要同步到 `~/.codex/` 的全域設定（AGENTS.md、config.toml 過濾欄位、agents `.toml`），由 `sync.js` 管理。
- **`.claude/`**（有點）— 本 repo 專用的 Claude Code 本地設定（`settings.json` 等），**不參與同步、不映射到 `~/.claude/`**。`.claude/skills` 是 symlink 指向 `../.agents/skills`。
- **`.codex/`** — 對稱於 `.claude/` 的 Codex 本地設定，`.codex/skills` 同為 symlink 指向 `../.agents/skills`，與 Claude Code 共用同一份本地 skill 實體。
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

**Skills（獨立管理，不自動同步）：**
- `npm run skills:diff` — 比較本機已安裝 vs `skills-lock.json`，列出差異並提供安裝／移除指令
- `npm run skills:add -- <url>` 或 `npm run skills:add -- <name> <source>` — 新增 skill 記錄
- `npm run skills:remove -- <name>` — 從 `skills-lock.json` 移除 skill 記錄

**測試：**
- `npm test` — 執行 `test/*.test.js`（`node --test`，零相依，共用 helper 在 `test/helpers.js`）
- 單一測試：`node --test --test-name-pattern="<name>" test/<file>.test.js`

**Fork / 初始化：**
- `npm run init` — 把作者個人資料重置為空骨架（從 `.example` 範本覆寫正式檔、刪除 `claude/rules/` 個人化規則）。**fork 後執行一次**，作者本人日常不需執行。支援 `--dry-run` 預覽

**全域旗標**（`node sync.js` 直接呼叫時可用）：`--dry-run`、`--yes`（別名 `--force`，略過互動確認；非互動環境執行 to-local／init 必加）、`--verbose`、`--version`、`--help`。**不在白名單內的旗標（含 typo 如 `--dryrun`）會拋 `INVALID_ARGS` 而非被靜默忽略**——避免打錯字略過 dry-run 真寫入。指令別名：`d`/`s`/`tr`/`tl`/`sd`/`sa`/`sr`（`init` 無別名）。

## 同步項目與對應

| repo 路徑 | 本機路徑 | 備註 |
|-----------|----------|------|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | 全文比對 |
| `claude/settings.json` | `~/.claude/settings.json` | **top-level 採黑名單混合制：預設同步，僅排除 `DEVICE_SETTINGS_KEYS` 黑名單（裝置偏好 `model`／`effortLevel`／`defaultShell`／`tui`／`autoUpdatesChannel`、平台綁定 `hooks`、憑證 helper `apiKeyHelper`／`awsCredentialExport`／`awsAuthRefresh`／`otelHeadersHelper`）與命中 `SENSITIVE_KEY_PATTERN`（key／token／secret／credential／password／auth／cert／cookie／session／jwt／helper／refresh，不分大小寫）的 key；被排除者不進 repo、不入 diff，to-local 保留本機值。`env` 亦採黑名單混合制 `DEVICE_ENV_KEYS`（`CLAUDE_CODE_USE_POWERSHELL_TOOL`、`ANTHROPIC_CUSTOM_HEADERS`、`HTTP_PROXY`／`HTTPS_PROXY`／`ALL_PROXY`，大小寫不敏感）＋`SENSITIVE_KEY_PATTERN`：env key 預設同步，僅排除命中黑名單／pattern 者；乾淨名 env key（含未知新 key）預設進 repo。另有值層防線 `assertPortableSettingsSafe`（巢狀敏感 key 名／機密樣式值／絕對家目錄路徑；env 值掃描恆常適用；direction-aware——to-repo 寫入時 fail-loud 中止，diff 標記 `[!]` 暫不同步並續列其他項目，to-local 不受阻）；明細 diff 對 env 值遮罩為 `***`（`maskEnvValuesForDisplay`）**。diff 預設列出被排除的 top-level 欄位（只列意料之外的 key 名） |
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

**單檔 CLI 設計**：所有邏輯在 `sync.js`（~2700 行，零外部相依，只用 Node.js 內建模組）。檔案結構採 section banner 分段，關鍵不變式：

- **所有函式 ≤ 60 行**（經 iter4/iter5 稽核強制）— 新增函式若超過需拆分
- **Data-driven dispatch**：`COMMANDS` 物件含 `handler`，`main()` 透過 `await COMMANDS[cmd].handler(opts)` 派發，**新增指令只需改 `COMMANDS`**
- **SyncItem 抽象 + 型別行為查表**：`buildSyncItems()` 產出宣告式 `SyncItem[]`；型別行為由 `SYNC_TYPE_HANDLERS`（`{ diff, apply, isDir }`）集中分派，`diffSyncItems` / `applySyncItems` / `buildFullDiffList` 三個消費端皆查表，**新增同步類型只需在 `SYNC_TYPE_HANDLERS` 加一筆**，不必逐處改 `if (type===...)`。方向相依的 codex 項目走 `buildSwapItem` 統一交換 src/dest
- **Atomic write**：底層 `writeFileSafe` 先寫同目錄暫存檔（隨機尾碼 + `flag:'wx'` O_EXCL）再 rename（同檔系統避免 EXDEV），所有寫入路徑（`writeJsonSafe`、`writeTextSafe`、`copyFile`、`mirrorDir`）皆走此函式。提供**原子性**（避免半截損壞），但**不付 fsync 成本、不保證持久性**（設定檔對持久性需求低）。diff 暫存檔走 `createTmpDiffFile`（os.tmpdir() 下隨機名 + O_EXCL，防共用 /tmp 的 symlink 攻擊 CWE-377/59）。對稱的 `readFileSafe` 統一將讀取例外包成 `SyncError`（帶 path context），不讓裸 fs 例外穿透 `formatError`
- **統一錯誤處理**：`SyncError` class（`code` + `context`）+ 檔尾 `.catch(formatError)`，所有路徑經 `formatError`，**禁止**裸 `console.error + process.exit`
- **Exit code 語義**：`EXIT_OK=0`（成功或 diff 無差異）、`EXIT_DIFF=1`（diff 有差異，可用於 CI）、`EXIT_ERROR=2`
- **Relative path 遮罩**：`toRelativePath` 處理 REPO_ROOT 與 `$HOME` → `~/`，`printFileDiff` 的 diff header 亦走此函式避免洩漏使用者名稱
- **Skills lock 為純資料 manifest**：`skills-lock.json` 不參與同步流程；`runSkillsDiff` 直接讀 `~/.agents/.skill-lock.json`（`npx skills` CLI 的原生 lock 檔）與 repo `skills-lock.json` 做集合比對，**只輸出建議指令、不執行安裝/移除**。刻意不用 `npx skills list -g`，因為它會掃目錄並把 `sync.js` 同步管理的 `~/.claude/skills/` skill（如 `ob`、`pen-design`）也列入，造成誤報。本機多裝的 skills 會同時列出（A）`npm run skills:add` 加入 repo 與（B）`npx skills remove` 從本機移除兩種選項

**測試策略**：`test/` 下分六個檔案（`sync.test.js` 純函式、`settings.test.js` 設定欄位與 `mergeSettingsBetween` 同步心臟、`codex-config.test.js` Codex config.toml 過濾、`diff-integration.test.js` diff 整合、`apply-integration.test.js` 沙箱化 to-local/to-repo 端到端 apply、`boundary.test.js` 邊界情境與安全防線），共用 helper 在 `test/helpers.js`。純函式測試含 `computeLineDiff`、`matchExclude`、`statusToStatsKey`、`parseSkillSource`、`parseArgs`、`toRelativePath`、`COMMANDS` 完整性。**破壞性 apply 與 direction-aware diff 走沙箱整合測試**：`apply-integration.test.js` 把 `sync.js` 複製進 tmp 當 repo（`__dirname`/`REPO_ROOT` 落 tmp）並以 `HOME` 沙箱化本機，雙向皆不觸碰真實 `~/.claude` 或真實 repo。若改純函式，**必須**同步更新 unit test，維持全數通過（視同 100% 覆蓋）。

## 修改守則

- **README.md 須同步更新**：新增/移除指令、改變同步項目、調整行為、新增旗標時必跟。
- **新增/調整 npm script 時須同步更新 README 的指令別名表與 `COMMANDS` 物件**，避免別名與 handler 漂移。
- **函式行數守則**：新增或重構後若某函式 > 60 行，需拆分（`buildSyncItems` 54 行為宣告式陣列，例外）。
- **禁止新增外部相依**：所有功能必須使用 Node.js 內建模組，不得 `npm install` 任何套件。
- **settings.json top-level 採黑名單混合制**（`DEVICE_SETTINGS_KEYS` + `SENSITIVE_KEY_PATTERN`）：預設同步官方 top-level 欄位，僅排除黑名單列舉（裝置偏好、平台綁定 `hooks`、憑證 helper）與敏感命名 pattern 命中的 key。過濾方向的判準（跨工具過濾慣例）：**該區塊的 key 名集合是誰定義的**——結構性官方欄位（官方定義的有限集合）→ 黑名單；開放 key 空間（使用者任意定義、可含機密，如 provider 金鑰區塊）→ 白名單。**例外**：`env` 雖為開放 key 空間，仍依使用者決策翻為黑名單混合制（`DEVICE_ENV_KEYS`）以消除新增合法 key 的摩擦，代價是已承擔的安全邊界弱化（見下條）。strip／preserve 由單一分區函式 `partitionSettingsTopLevel` 同源保證互補（top-level 限定；env 子鍵是 `stripDeviceEnv` ↔ `extractDeviceValues` env 迴圈兩處對稱判斷）。增減黑名單欄位須改 `DEVICE_SETTINGS_KEYS` 常數與 README。**風險承擔（明文）**：未知裝置型新欄位會先同步互踩、再人工加黑名單；兩種訊號分工——互踩靠一般 value-diff 發現、pattern 誤傷靠 diff 預設輸出的 dropped 清單發現（`loadStrippedSettings` 回傳 `dropped`，diff 預設列出 key 名，但只列**未明列於 `DEVICE_SETTINGS_KEYS`** 的意料之外排除，明列裝置鍵不印以降噪）。此不變式依賴「repo settings.json 永遠為黑名單＋pattern 收斂版」，repo 來源檔不得保留被排除欄位。
- **settings.json `env` 區塊採黑名單混合制**（`DEVICE_ENV_KEYS` + `SENSITIVE_KEY_PATTERN`，**已承擔風險的邊界弱化**）：env key 經 `stripDeviceEnv` 收斂——命中 `DEVICE_ENV_KEYS`（裝置／平台綁定或值即憑證但名稱乾淨者，大小寫不敏感比對，見 `isDeviceEnvKey`）或 `SENSITIVE_KEY_PATTERN` 者 strip、不進 repo、不入 diff；其餘（含乾淨名未知 key）預設同步。to-local 保留本機命中黑名單/pattern 的 env 原值。**四層控制**：① `DEVICE_ENV_KEYS` → ② key 名 pattern strip → ③ `SECRET_VALUE_PATTERN` 值掃描（to-repo fail-loud）→ ④ 明細 diff env 值遮罩（`maskEnvValuesForDisplay`）。**殘餘風險（明文、不可再弱化）**：黑名單無法枚舉機密 key 名，key 名乾淨＋值非已知前綴＋未列 `DEVICE_ENV_KEYS` 的機密（`DB_PASS=hunter2` 等）會經 to-repo 進 repo／git history（永久）；④ 只擋 diff 顯示、擋不了寫入。增減 `DEVICE_ENV_KEYS` 須改常數與 README。若日後要收緊安全，降級路徑為回退白名單（見 change `env-blacklist` design 替代方案 A1）。
- **值層防線 `assertPortableSettingsSafe`（defense in depth）**：黑名單只查 top-level key 名，巢狀內容由此層把關——收斂結果進入 repo／diff 前遞迴掃描，巢狀 key 名命中 `SENSITIVE_KEY_PATTERN`（env 子樹豁免 key 掃描：其 key 名已由 `stripDeviceEnv` 用同一 pattern 處理，再掃是死碼；env **值**掃描恆常適用）、字串值命中機密前綴（`SECRET_VALUE_PATTERN`：`sk-`／Stripe `sk_live_`／`ghp_`／`AKIA`／`AIza`／JWT 等，前綴清單天生不可窮舉、只作補漏）或絕對家目錄路徑時觸發。**觸發行為 direction-aware**（`loadStrippedSettings` 的 `onSensitive` 參數）：to-repo 實際寫入前拋 `SyncError`（`SENSITIVE_CONTENT`）**fail-loud 中止而非靜默剝除**；diff／to-local 僅比對不寫回 repo，命中時標記 `[!]` 跳過該項並續行其餘比對（否則本機 `permissions.additionalDirectories` 這類合法含絕對路徑的官方欄位會讓整個指令罷工）。錯誤訊息與 diff 標記只含欄位路徑不含值。與 env 黑名單四層控制共同構成「輸出／log／diff 不得出現 API Key、token」不變式的防線（唯 to-repo 對乾淨名+乾淨值機密的寫入為已承擔的殘餘風險，見上條）。
- **構建規則**（來自全域 CLAUDE.md）：禁擅自執行 `npm run build`。
- **嚴禁洩漏敏感資訊**：輸出、log、diff 內容中不得出現 API Key、token 或完整使用者路徑。**涵蓋範圍（明文）**：結構化過濾（黑白名單＋值層防線）只作用於 `settings.json` 與 `codex/config.toml`；`file`／`dir` 型項目（CLAUDE.md、rules、skills、statusline.sh 等純文字檔）走 `copyFile`／`mirrorDir` 原樣同步、**不經任何機密掃描**——勿在這些檔案內存放金鑰／token（例如 statusline 腳本呼叫外部服務時，token 應改由環境變數或本機憑證檔提供）。
- **部分失敗可見度**：apply 中途拋例外時，`mirrorDir` 把已完成變更附掛到 `SyncError.context.partialChanges`，`applySyncItems` 補印並經 `logPartialApply` 記入 `.sync-history.log`（標記「因錯誤中斷」）——與 `handleSignal` 的訊號中斷警告互補，已寫入的檔案不得零可見度。

## Skills 管理

Skills 分兩層：

| 位置 | 路徑 | 說明 |
|---|---|---|
| 全域（同步） | `claude/skills/<name>/SKILL.md` | 同步到 `~/.claude/skills/`，跨裝置共用 |
| 本地（不同步） | `.agents/skills/<name>/SKILL.md` | 僅限本 repo 使用，跨工具共享（Codex 等） |

本地 skill 實體放在 `.agents/skills/`，`.claude/skills` 與 `.codex/skills` 皆為 symlink（→ `../.agents/skills`），讓 Claude Code 與 Codex 等 Agent Skills 相容工具共用同一份來源。新增本地 skill 直接放進 `.agents/skills/<name>/SKILL.md` 即可，不需另建 symlink。

**Windows clone 注意**：git symlink 在 Windows 需「開發者模式」或管理員權限才會還原為真正的 symlink，否則會 fallback 成內容為路徑字串的純文字檔，導致 Claude Code/Codex 找不到 skill。在 Windows 11 設定 → 系統 → 開發人員選項中開啟即可。

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
