# ai-config-sync

跨裝置同步 Claude Code / Codex 設定的私有 Git repo 工具。一台機器設定好，其他機器一鍵套用。

零外部相依，只用 Node.js 內建模組（需 Node ≥ 18）。

## 運作方式

本機設定與私有 Git repo 之間雙向同步，repo 再帶到其他裝置：

```
本機 ~/.claude ~/.codex
   │  ▲
   │  │ to-local（套用，會先預覽）
   │  │
   ▼  │ to-repo（上傳本機設定）
 私有 Git repo（claude/ codex/ agents/）──push/clone──▶ 其他裝置
```

- **不碰本機敏感活檔**：`~/.claude.json` 與 `~/.codex/config.toml` 皆**永不被本工具寫入或讀取**。見 [刻意不同步](#刻意不同步)。
- **commit 前把關**：`npm run safety:check` 唯讀掃描 repo 是否誤帶機密，見 [安全檢查](#安全檢查-safetycheck)。

## 快速開始

```bash
npm run diff        # 看本機 vs repo 差在哪（唯讀，不寫入）
npm run to-repo     # 本機 → repo（上傳你的設定）
npm run to-local    # repo → 本機（套用，會先預覽再確認）
```

## 同步項目

每個項目對應到各工具的全域設定路徑（`—` 表示該工具無對應項目）：

| 項目 | Claude Code<br>`~/.claude/` | Codex<br>`~/.codex/` |
|------|------|------|
| 全域指示／規則 | `CLAUDE.md` | `AGENTS.md` |
| 主設定檔 | `settings.json` | —（見 [建議設定](#codex-建議設定手動套用)） |
| Statusline | `statusline.sh` | — |
| 跨工具全域 Skill | `agents/skills/`（見下） | `agents/skills/`（見下） |
| 規則拆分 | `rules/` | — |
| 本地 Skill | `.agents/skills/`（共用） | `.agents/skills/`（共用） |

`agents/skills/` 對應本機 `~/.agents/skills/`（正典真實目錄）：

| repo 路徑 | 本機路徑 | 備註 |
|-----------|----------|------|
| `agents/skills/<name>/` | `~/.agents/skills/<name>/` | 正典真實目錄，Codex 原生掃描；apply 另於 `~/.claude/skills/<name>` 建 symlink 橋供 Claude Code 探索（官方支援、自動去重） |

補充說明：

- **全域指示**兩者各自獨立（`CLAUDE.md` 與 `AGENTS.md` 內容可分歧）。
- **主設定檔**：Claude 為黑名單過濾版（排除裝置欄位，見 [settings.json 同步行為](#settingsjson-同步行為)）。
- **MCP Server 目前不在同步範圍**：舊有的諮詢式同步已整批移除，待重新設計。請以 `claude mcp add`／`codex mcp add` 於各裝置手動維護。見 [刻意不同步](#刻意不同步)。
- **Agent 定義**目前不在同步範圍：Claude／Codex 皆未列 agents 同步項目（原 `everything-claude-code` agent 庫已整批移除）。日後要恢復再於 `SYNC_MANIFEST` 加回。
- **Command 定義**不在同步範圍：本 repo 已改用 skill、不再新增 command，`SYNC_MANIFEST` 未列 `commands` 同步項（有回歸鎖把關）。
- **兩種 Skill 分層**：
  - `agents/skills/`（跨工具全域）— repo 自帶、Git 版控、`xtool-skills` 型同步進 `~/.agents/skills/`（Codex 原生掃）並於 `~/.claude/skills/<name>` 建 symlink 橋（Claude 探索）。**全域 skill 的唯一落點**；不加 per-skill flag。
  - `.agents/skills/`（本地）— 已版控、跨工具共用、**不參與** to-repo／to-local；Claude Code 靠 `.claude/skills` symlink 讀取，Codex 原生探索（見 [刻意不同步](#刻意不同步) 的 Windows 注意）。
- **`agents/skills/` 與 `npx skills` 共管 `~/.agents/skills/`**：`xtool-skills` 為**非 prune**、只認 repo `agents/skills/` 登記的「受管名字」——對 `~/.agents/skills/` 內的 npx 住戶一律不刪、不吸回 repo。撞名守門：upsert 前若 `<name>` 已登記於 `~/.agents/.skill-lock.json`（npx 安裝必登記，本機制永不登記），即判為碰撞、拒絕覆寫並印 warning，`diff` 階段以 `conflict` 狀態標示。**已知取捨**：手動複製進 `~/.agents/skills/`、未登記 lock 的同名目錄無 ownership 標記可辨，會被視為受管而覆寫。
- **Claude 探索點的第二道守門**：`~/.claude/skills/<name>` 若是真實目錄（舊機制產物），to-local 會把它轉成 symlink——轉換含遞迴刪除，故轉換前先比對「該目錄內是否有 repo 沒有對應來源的檔案」。有的話（例如你自己在 `~/.claude/skills/` 手寫、剛好與受管 skill 同名的 skill）一律拒絕刪除、跳過並印 warning，`diff` 同樣以 `conflict` 標示。判準是**路徑存在性**而非內容比對：本機同名檔內容較舊屬正常遷移，會照 to-local 語意覆蓋。
- **全域 Skill 與 `npx skills` 是兩套機制**：`agents/skills/` 是 repo 自帶、Git 版控、由 to-repo／to-local 同步的 skill；`skills-lock.json` 追蹤的是外部 `npx skills` CLI 安裝的 skill，不受 `sync.js` 管理，只能用 `npm run skills:diff` 比對後手動套用建議。
- **規則拆分** `claude/rules/` 是 `CLAUDE.md` 的模組化拆分，支援 frontmatter `paths:` scoping。

### 目錄命名

| 目錄 | 用途 |
|------|------|
| `claude/`、`codex/`、`agents/`（無點） | **要同步**到各工具全域設定的內容（`agents/` ↔ `~/.agents/`） |
| `.claude/`、`.codex/`（有點） | 本 repo 專用的**本地**設定，**不參與同步** |
| `.agents/skills/` | 本地 skill 實體目錄（已版控） |

## 指令

### 常用指令

```bash
npm run diff          # 比較本機 vs repo（唯讀）
npm run status        # 同時比較設定與 skills 差異
npm run to-repo       # 本機 → repo（上傳）
npm run to-local      # repo → 本機（套用，先預覽再確認）
npm run safety:check  # 掃描 repo 是否含機密或需人工審核項目（唯讀、離線）
```

Skills 獨立管理，不隨設定自動同步：

```bash
npm run skills:diff                     # 比較本機 vs repo skills，列出建議指令
npm run skills:add -- <url>             # 記錄一個 skill（也可 <name> <source>）
npm run skills:remove -- <name>         # 從 skills-lock.json 移除記錄
```

`skills:diff` 對本機多裝的 skill 會同時列出 (A) `npm run skills:add`（加入 repo）與 (B) `npx skills remove`（從本機移除）兩種建議。

測試：

```bash
npm test                                                    # 全部單元測試（node:test）
node --test --test-name-pattern="<name>" test/<file>.test.js  # 單一測試
```

### 指令別名

`node sync.js` 可搭配簡寫：

| 指令 | 別名 |
|------|------|
| `diff` | `d` |
| `status` | `s` |
| `to-repo` | `tr` |
| `to-local` | `tl` |
| `safety:check` | — |
| `skills:diff` | `sd` |
| `skills:add` | `sa` |
| `skills:remove` | `sr` |

### 旗標

| 旗標 | 說明 |
|------|------|
| `--dry-run` | 預覽操作，不實際寫入（適用 to-repo / to-local） |
| `--yes` | 略過互動確認（別名 `--force`）；非互動環境（CI／pipe）執行 to-local 時必加，否則報錯而非卡住 |
| `--no-color` | 關閉色彩輸出（亦支援 `NO_COLOR`；`FORCE_COLOR` 可強制開啟） |
| `--verbose` | 顯示詳細路徑與檔案大小 |
| `--version` | 顯示版本號（別名 `-v`） |
| `--help` | 顯示指令說明（別名 `-h`） |

不在白名單內的旗標（含 typo 如 `--dryrun`）會**直接報錯**，不會被靜默忽略——避免打錯字略過 dry-run 而真寫入。

> **經 `npm run` 傳旗標必須加 `--` 分隔**：`npm run to-repo --dry-run` 的 `--dry-run` 會被 npm 攔成自家 config、傳不進 `sync.js`。`sync.js` 偵測到被 npm 吞掉的 `--dry-run`／`--yes`（`npm_config_*` 環境變數）會**直接報錯中止**，不會靜默以真寫入模式執行。正確寫法：
>
> ```bash
> npm run to-repo -- --dry-run   # ← 加 -- 分隔
> node sync.js to-repo --dry-run # 直接呼叫則不需要
> ```

## 部署

### Fork 後初次設定

Fork 或複製本 repo 時，內容是作者的個人設定。在你的主力機執行 `npm run to-repo` 即以本機設定覆蓋（`claude/rules/` 下不屬於你的規則檔請手動刪除），改好 `package.json` 的 name／description 後 commit、push 即可。

### 新裝置部署

第二台之後的機器：

```bash
git clone <your-repo-url>
cd <your-repo>
npm run to-local
```

## Codex 建議設定（手動套用）

`~/.codex/config.toml` **不做整檔同步、也不被本工具寫入**：下列偏好由各裝置手動設定。新裝置上不調偏好也不會壞——只是行為回到 Codex 預設。

| 偏好 | 建議值 | 說明 |
|------|--------|------|
| 回應風格 | `pragmatic` | 務實直接。預設不套用風格；另可選 `friendly`，或對話中用 `/personality` 臨時切換 |
| 網頁搜尋 | `live` | 即時搜尋。預設 `cached`（只查 OpenAI 索引、不連外）；另有 `indexed` 與 `disabled` |
| 記憶功能 | 開啟（`features.memories`） | 預設關閉；開啟後跨對話記憶自動運作 |
| 狀態列 | 顯示五項 | 設定鍵 `tui.status_line`，值為 `[ "model-with-reasoning", "project-name", "git-branch", "five-hour-limit", "weekly-limit" ]`。預設只顯示模型與當前目錄 |

其餘常見欄位**值等同 Codex 現行預設，不必寫進設定檔**：目標追蹤（`features.goals`）已 stable 且預設開啟；記憶生成／使用開關（`memories.generate_memories`／`memories.use_memories`）預設就開；各 `[plugins."…"]` 的 `enabled` 預設為 `true`。

> 預設值依 [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference) 與 codex-rs 原始碼（`PluginConfig` 的 `default_enabled`、`DEFAULT_STATUS_LINE_ITEMS`）查核，可能隨版本變動。

**切勿把 `config.toml` 放進 repo**：它可能含 `model_providers.*`／`mcp_servers.*` 等機密載體與 `projects.*` 的絕對家目錄路徑。`npm run safety:check` 會對 repo 內任何 `.toml` 的機密 section 直接 hard block（exit 2）擋下。

## 安全檢查 safety:check

`npm run safety:check` 是手動、唯讀、離線的檢查，掃描 `claude/`、`codex/`、`agents/` 與 `skills-lock.json`（不掃 `test/`、`openspec/`、README 等非同步來源）。輸出只列**分類、檔案與欄位／key／行號**，不列 env 值、secret 原值或完整 HOME 路徑。

**它不是同步流程的一部分，也不保證能阻止機密寫入 repo**。`to-repo` 只做明確不同步欄位的剝除與資料搬移，`CLAUDE.md`、rules、skills、`statusline.sh` 等皆原樣鏡射。建議流程：`npm run to-repo` 後、commit 前，跑 `npm run safety:check` 與 `git diff` 人工複核。

**Hard block（exit 2）** — 明顯高風險，應擋下：

- 已知 token 值樣式、私鑰片段、絕對 HOME 路徑（含 JSON 內跳脫的 Windows 路徑 `C:\\Users\\…`）
- `claude/settings.json` 出現 `hooks` 或 credential helper 欄位
- repo 內任何 `.toml` 出現機密載體 section（`model_providers.*`／`mcp_servers.*`），只印 section 路徑不印值
- repo 內任何 `.toml` 出現**無法解析的結構**，只印行號不印值（fail closed——結構解不出來時 section 歸屬不可信，機密判斷失去依據）：
  - 無法解析的 section header（如 `[mcp_servers` 未閉合）
  - 未閉合的 TOML value（如 `notify = [` 之後直接接下一個 section header）
  - section 名含無法解碼的跳脫序列

**Warning（exit 1）** — 需人工審核，不自動阻斷：

- `claude/settings.json` 的 env key 清單
- 結構化設定中命中敏感命名 pattern 的 key path
- `.toml` 出現裝置狀態 section（`profiles.*`／`history`／`shell_environment_policy`）

**text pattern 掃描的排除**：secret／私鑰／HOME 路徑的字串掃描支援排除清單（`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES`），**目前為空——三個同步來源目錄全部受掃描**。

排除的用途是原樣鏡射的上游套件文件：那類文件為說明偵測規則本就含 token／路徑樣式，掃它們會製造整類誤判。但**排除粒度必須是該 package 的具體子目錄**（如 `agents/skills/<pkg>/references/`），不得是同步來源根——清單曾誤列 `agents/skills/`，而那是三個來源根之一的全部內容且其下 skill 皆為本 repo 手寫，等於整棵跨工具全域 skill 樹不受掃描。排除只作用於 text 掃描，結構化 `.json`／`.toml` 的 hard block 不受影響。

**輸出遮罩**：issue 的 detail（section 名、key path）除本機 HOME 遮罩外，另套通用家目錄遮罩——設定檔可能來自別台裝置，其 section 名內嵌的是**那台**裝置的家目錄（如 `[mcp_servers."C:\Users\<他人>\srv"]`），單靠本機 HOME 字串比對抓不到。

## 同步行為細節

### settings.json 同步行為

**top-level 採黑名單制**：預設同步所有 top-level 欄位，僅排除 `DEVICE_SETTINGS_KEYS` 明確黑名單——裝置偏好 `model`／`tui`／`autoUpdatesChannel` 與平台綁定的 `hooks`。

- **只列本機實存 key、不預防性列名**：憑證 helper（`apiKeyHelper` 等）若日後出現會照常同步進 repo，交由 `safety:check` 的 hard block 攔下，而非事先寫進黑名單。
- **敏感命名 pattern 不再自動處理**：key／token／secret／credential 等命名不再讓 sync 剝除或中止；未列黑名單者依一般差異同步，由 `safety:check` 以 warning 供人工審核。
- **首次出現的 top-level key 會被點名查驗**：`diff`／`to-repo` 發現本機某 key 為 repo 端尚無（首次進入同步範圍）時，額外印出 key 名提示人工確認是否屬裝置偏好、該補進 `DEVICE_SETTINGS_KEYS`。只比 key 集合差集、只印 key 名不印值。首次建 repo 時全數列出屬預期的初始化查驗。

### env 區塊

`settings.json` 的 `env` 全部依一般同步語意同步——不因命名 pattern 被剝除，也不在 to-local 特別保留本機 env key。`diff`／`status` 只輸出狀態行、**不印任何設定內容**（env 值不會出現在輸出）；repo 內容是否安全須由 `safety:check` 與人工審核判斷。

### hooks 不跨裝置同步

hook command 多為平台綁定（PowerShell／終端跳脫序列），Windows 與 macOS 無法共用，故 `hooks` 由各裝置自行維護、repo 不攜帶。新裝置需重建 hook 時手動設定。

### 原子寫入與中斷可見度

- 所有檔案寫入（JSON、文字、目錄鏡射）皆透過底層 `writeFileSafe` 使用 atomic write（先寫同目錄暫存檔再 rename），避免中途斷電／中斷導致檔案損壞。
- 同步中途因錯誤中斷時，已寫入的變更會逐項列出並警告「已寫入 N 筆變更」，不會無聲消失。操作歷史由 git 承載（to-repo 完成後即顯示 git status）。

## 刻意不同步

- **`~/.codex/config.toml`** — 不進 repo，且**永不被本工具寫入或讀取**。偏好、projects、providers 與所有 MCP section 皆保持本機。`safety:check` 仍對 repo 內任何 `.toml` 的機密 section hard block——該防線與 MCP 是否同步無關，擋的是「人工把 config.toml 複製進 repo 備份」。
- **MCP Server 定義（兩端）** — 目前**完全不在同步範圍**，待重新設計。請用 `claude mcp add --scope user ...`／`codex mcp add ...` 於各裝置手動維護。舊版曾留下的 `~/.codex/.ai-config-sync-mcp-state.json` 為孤兒檔，可自行 `rm`（本工具不代刪——為了清理而破例寫本機檔會與「不寫入本機」的承諾自相矛盾）。OAuth／ChatGPT 登入狀態同樣不在同步範圍。
- **`~/.claude.json`** — 含 OAuth token、專案級歷史與 MCP 設定，屬高風險敏感活檔，**永不被本工具寫入或讀取**（MCP 同步移除後，連唯讀比對的程式路徑也不存在）。

### Skills 與 Agents

- Skills 不在自動同步範圍，用 `npm run skills:diff` 查看差異。
- `.agents/skills/` 是本地 skill 實體目錄，已版控；Claude Code 靠 `.claude/skills` symlink 讀取，Codex 原生把 `.agents/skills`（專案層）與 `~/.agents/skills`（全域層）納入探索路徑、無需 symlink。
- **Windows clone 注意**：`.claude/skills` 這個 git symlink 在 Windows 需開啟「開發者模式」（設定 → 系統 → 開發人員選項）或以管理員權限 clone，否則會 fallback 成內容為路徑字串的純文字檔，導致 Claude Code 找不到 skill。Codex 不受影響（直接讀實體目錄）。
- Agents 目前不在同步範圍：Claude／Codex 皆未列 agents 同步項目（原 `everything-claude-code` agent 庫已整批移除），日後有需要再於 `SYNC_MANIFEST` 加回。

## 專案檔案

各同步內容（`claude/`、`codex/` 下的檔案）見上方 [同步項目](#同步項目)；此處僅列工具本體。

| 檔案 | 說明 |
|------|------|
| `sync.js` | 主 CLI 入口，實作同步／diff 核心與 command dispatch（無外部相依） |
| `safety-check.js` | `safety:check` 唯讀掃描模組，由 `sync.js` 注入共用工具（不獨立執行、不反向 require） |
| `toml-reader.js` | TOML 邏輯語句讀取器（純函式、零 IO），由 `safety-check.js` 直接 require，供 `.toml` 掃描正確歸屬 section |
| `skills.js` | skills 指令族（`skills:diff`／`skills:add`／`skills:remove`）模組，由 `sync.js` 經 `createSkillsHandler(deps)` 注入共用工具（不獨立執行、不反向 require） |
| `test/sync.test.js` | 同步邏輯純函式單元測試（`node:test`） |
| `test/settings.test.js` | settings.json 純函式與 `mergeSettingsBetween` 同步心臟測試 |
| `test/toml-reader.test.js` | TOML 讀取器測試（`safety:check` section 歸屬的回歸網） |
| `test/skills.test.js` | skills 模組純函式與 deps-bound helper 測試（經 `createSkillsHandler` 注入） |
| `test/diff-integration.test.js` | diff 整合測試 |
| `test/apply-integration.test.js` | 沙箱化 to-local／to-repo 端到端 apply 測試 |
| `test/boundary.test.js` | 邊界情境與安全防線測試（含 `safety:check` sandbox） |
| `test/helpers.js` | 各測試檔共用 helper |
| `package.json` | 定義所有 npm 指令 |
| `skills-lock.json` | 全域 skills 清單（跨裝置 source of truth） |

## Exit Code

| Code | 說明 |
|------|------|
| `0` | 成功（diff 模式：無差異） |
| `1` | diff 模式：有差異；`safety:check`：只有 warning |
| `2` | 錯誤；`safety:check`：有 hard block |
