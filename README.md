# ai-config-sync

跨裝置同步 Claude Code / Codex 設定的私有 Git repo 工具。

**同步項目**（依工具對應）：

| 功能 | Claude Code（`~/.claude/`） | Codex（`~/.codex/`） | opencode（`~/.config/opencode/`） | 說明 |
|------|------------------------------|------------------------|--------------------------------------|------|
| 全域指示／規則 | `claude/CLAUDE.md` | `codex/AGENTS.md` | `opencode/AGENTS.md` | 全文比對；三者各自獨立，opencode 缺此檔時才 fallback 讀 Claude 的 CLAUDE.md |
| 主設定檔 | `claude/settings.json` | `codex/config.toml` | `opencode/opencode.jsonc` | Claude／Codex 為過濾版（黑名單排除裝置／機密欄位），opencode 整檔同步（支援 `.json`／`.jsonc` 檔名變體，`.jsonc` 優先） |
| Statusline | `claude/statusline.sh` | — | — | 全文比對，Codex／opencode 無對應機制 |
| Agent 定義 | `claude/agents/` | `codex/agents/` | — | 皆以 package 子目錄組織；Codex 為 `.toml` 格式（目前無 agent），opencode 無同步項目 |
| Command 定義 | `claude/commands/` | — | — | 目錄鏡射，僅 Claude Code 有此同步項目。本 repo 慣例已改用 skill（見下方全域 Skill），不再新增 command，故目前為空目錄；`sync.js` 仍原樣支援此路徑 |
| 全域 Skill | `claude/skills/` | — | — | 目錄鏡射，僅 Claude Code 有全域 skill 同步。**與 `npx skills`（`skills-lock.json`）是兩套不同機制**：`claude/skills/` 是 repo 自帶、Git 版控的 skill 原始檔，由 to-repo/to-local 直接鏡射；`skills-lock.json` 追蹤的是外部 `npx skills` CLI 安裝的 skill，不受 sync.js 管理，只能用 `npm run skills:diff` 比對後手動執行建議指令。兩者最終都落在 `~/.claude/skills/`，但誰在管完全不同 |
| 本地 Skill | `.agents/skills/`（經 `.claude/skills` symlink 讀取） | `.agents/skills/`（原生探索，無需 symlink） | — | 跨工具共用同一份實體目錄，不參與 to-repo/to-local 同步 |
| 規則拆分 | `claude/rules/` | — | — | CLAUDE.md 模組化拆分，支援 frontmatter `paths:` scoping，僅 Claude Code 有此機制 |

> **目錄命名**：
> - `claude/`（無點）— 要同步到 `~/.claude/` 的全域設定
> - `codex/`（無點）— 要同步到 `~/.codex/` 的全域設定（AGENTS.md、config.toml、agents）
> - `.claude/`、`.codex/` — 本 repo 專用的 Claude Code / Codex 本地設定，**不參與同步**
> - `.agents/skills/` — 本地 skill **實體目錄**（已納入版控）。Claude Code 靠 `.claude/skills` symlink 讀取；Codex 原生把 `.agents/skills` 納入探索路徑、無需 symlink

## 使用方式

```bash
# 比較本機 vs repo 差異（不寫任何東西）
npm run diff

# 同時比較設定與 skills 差異
npm run status

# 本機設定 → repo（上傳）
npm run to-repo

# repo 設定 → 本機（套用，會先預覽再確認）
npm run to-local

# 檢查 repo 同步來源是否含高風險內容或需人工審核項目（唯讀、不連網）
npm run safety:check

# 比較本機 vs repo 的 skills 差異（不自動同步）
# 本機多裝者會同時列出 (A) 加入 repo 與 (B) 從本機移除 兩種建議指令
npm run skills:diff

# 新增 skill 到 skills-lock.json
npm run skills:add -- https://skills.sh/<org>/<repo>/<skill>
npm run skills:add -- <name> <source>

# 從 skills-lock.json 移除 skill
npm run skills:remove -- <name>

# 執行單元測試（node:test，零外部相依）
npm test

# 執行單一測試
node --test --test-name-pattern="<name>" test/<file>.test.js
```

### 指令別名

可直接用 `node sync.js` 搭配簡寫：

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
| `--yes` | 略過互動確認（別名 `--force`）；非互動環境（CI / pipe）執行 to-local 時必加，否則會直接報錯而非卡住 |
| `--no-color` | 關閉色彩輸出（亦支援 `NO_COLOR` 環境變數；`FORCE_COLOR` 可強制開啟） |
| `--verbose` | 顯示詳細路徑與檔案大小 |
| `--version` | 顯示版本號（別名 `-v`） |
| `--help` | 顯示指令說明（別名 `-h`） |

> 不在白名單內的旗標（含 typo 如 `--dryrun`）會直接報錯，不會被靜默忽略——避免打錯字而略過 dry-run 預覽真寫入（此保護僅在旗標實際到達 `sync.js` 時有效，見下）。

> **npm run 傳旗標必須以 `--` 分隔**：`npm run to-repo --dry-run` 的 `--dry-run` 會被 npm 攔截成自家 config、根本傳不進 `sync.js`。`sync.js` 會偵測 npm 吞掉的 `--dry-run`／`--yes`（`npm_config_*` 環境變數）並**直接報錯中止**，不會靜默以真寫入模式執行；正確寫法是 `npm run to-repo -- --dry-run`。

```bash
# 範例：預覽 to-repo 會做什麼，不實際寫入
node sync.js to-repo --dry-run
npm run to-repo -- --dry-run   # 經 npm run 必須加 -- 分隔

# 範例：顯示詳細差異資訊
node sync.js diff --verbose
```

## Fork 後初次設定

Fork 或複製本 repo 給自己用時，repo 內容是作者的個人設定；在你的主力機直接執行 `npm run to-repo` 就會以本機設定覆蓋（`claude/rules/` 下不屬於你的規則檔請手動刪除），改好 `package.json` 的 name / description 後 commit push 即可。

## 新裝置部署

如果你已經完成 Fork 後初次設定，第二台之後的機器只要：

```bash
git clone <your-repo-url>
cd <your-repo>
npm run to-local
```

## 檔案說明

> 各同步項目（`claude/`、`codex/`、`opencode/` 下的檔案）對應關係見上方「同步項目」表；此處僅列工具本體。

| 檔案 | 說明 |
|------|------|
| `sync.js` | 主 CLI 入口，實作同步／diff／skills 指令邏輯（無外部相依） |
| `safety-check.js` | `safety:check` 唯讀掃描模組，由 `sync.js` 注入共用工具（不獨立執行、不反向 require） |
| `codex-config.js` | Codex `config.toml` 過濾同步模組（TOML parse／serialize／merge 純函式與常數、load／get／apply 進出口），由 `sync.js` 注入共用工具（不獨立執行、不反向 require；diff 渲染留在 `sync.js`） |
| `test/sync.test.js` | 同步邏輯純函式單元測試（使用 Node.js 內建 `node:test`） |
| `test/settings.test.js` | settings.json 相關純函式與 `mergeSettingsBetween` 同步心臟測試 |
| `test/codex-config.test.js` | Codex config.toml 過濾同步測試 |
| `test/diff-integration.test.js` | diff 整合測試 |
| `test/apply-integration.test.js` | 沙箱化 to-local/to-repo 端到端 apply 測試 |
| `test/boundary.test.js` | 邊界情境與安全防線測試（含 `safety:check` sandbox） |
| `test/helpers.js` | 各測試檔共用的 helper |
| `package.json` | 定義所有 npm 指令 |
| `skills-lock.json` | 全域 skills 清單（跨裝置 source of truth） |

## Exit Code

| Code | 說明 |
|------|------|
| `0` | 成功（diff 模式：無差異） |
| `1` | diff 模式：有差異；`safety:check`：只有 warning |
| `2` | 錯誤；`safety:check`：有 hard block |

## 注意事項

- `settings.json` 的 **top-level 採黑名單制**：預設同步 top-level 欄位，僅排除 `DEVICE_SETTINGS_KEYS` 明確黑名單（裝置偏好 `model`／`tui`／`autoUpdatesChannel`、平台綁定 `hooks`）。黑名單只列本機實際存在的 key、不做預防性列名——憑證 helper（`apiKeyHelper` 等）若日後出現會照常同步進 repo，由 `safety:check` 的 hard block 攔下。敏感命名 pattern（key／token／secret／credential／password／auth／cert／cookie／session／jwt／helper／refresh）**不再**讓 sync 自動剝除或中止；未列黑名單的 key 依一般 settings 差異同步，並由 `npm run safety:check` 以 warning 供人工審核
- `settings.json` 的 `env` 區塊 **全部依一般同步語意同步**：不再因舊 env review 清單（`CLAUDE_CODE_USE_POWERSHELL_TOOL`、`ANTHROPIC_CUSTOM_HEADERS`、proxy 類）或敏感命名 pattern 被剝除，也不在 to-local 特別保留本機 env key。`diff`／`status` 只輸出項目狀態行、不印任何設定內容（env 值不會出現在輸出）；實際 repo 內容是否安全須由 `npm run safety:check` 與人工審核判斷
- **`npm run safety:check`** 是手動、唯讀、離線檢查：掃描 `claude/`、`codex/`、`opencode/` 與 `skills-lock.json`，不掃 `test/`、`openspec/`、README 等非同步來源文件。secret／私鑰／HOME 路徑的 **text pattern 掃描另排除外部套件文件目錄**（`claude/agents/`、`claude/skills/`、`codex/agents/`）——這些是原樣鏡射的第三方 agent／skill 文件，為說明偵測規則本就含 token／路徑樣式，掃它們會製造整類誤判（排除只作用於 text 掃描，結構化 `.json`／`.toml` 的 hard block 不受影響）。取捨：套件文件若真含機密不再被 text pattern 攔，可接受（公開上游、本 repo 不編輯），真正機密載體與使用者手改的設定來源仍全覆蓋。hard block 包含已知 token 值樣式、私鑰片段、絕對 HOME 路徑、repo `claude/settings.json` 出現 `hooks` 或 credential helper 欄位、repo `codex/config.toml` 出現機密載體 section（`model_providers.*`／`mcp_servers.*`，只印 section 路徑不印值，為 section 黑名單同步層之外的第 2 層防線）；warning 包含 `claude/settings.json` 的 env key 清單與結構化設定中命中敏感命名 pattern 的 key path。輸出只列分類、檔案與欄位／key／line，不列 env 值、secret 原值或完整 HOME 路徑
- **同步流程不保證阻止機密寫入 repo**：`to-repo` 只做明確不同步欄位剝除與資料搬移；CLAUDE.md、rules、skills、statusline.sh 等仍為原樣鏡射。建議流程是 `npm run to-repo` 後、commit 前執行 `npm run safety:check` 與 `git diff`
- **`hooks` 不跨裝置同步**：hook command 多為平台綁定（PowerShell／終端跳脫序列），在 Windows 與 macOS 無法共用，故各裝置自行維護本機 `hooks`，repo 不攜帶。需在新裝置重建 hook 時手動設定
- `codex/config.toml` 採 **section 級黑名單混合制**：預設同步各 section，僅整段排除 `model_providers.*`、`mcp_servers.*`、`projects.*`、`profiles.*`、`history`、`shell_environment_policy`、`tui.model_availability_nux`（機密／本機路徑／裝置狀態）。未知新 section／新 key 預設同步（含 Codex 未來新增，如新的 `features.*` flag）；to-local 時保留本機被排除 section 不受影響
- **兩個精確 carve-out**（維持窄允許清單，非破壞一致性）：
  - **top-level 只同步 `personality`、`web_search`**：Codex top-level 尚有 `model`／`approval_policy`／`sandbox_mode` 等裝置 key 且隨版本增生，缺權威 schema 無法安全反列，故此層刻意不翻黑名單。**翻轉的前置條件**是先盤出 top-level 裝置 key 全集，另開 change 決策
  - **`plugins.*` 只同步 `enabled`**：plugin 名為半開放集合、plugin section 可能載憑證／本機路徑（開放 key 空間），維持逐 key 精度
- **黑名單制的風險承擔**：Codex 未來在保留 section（`tui`／`features`／`memories`）新增「裝置型且非機密」的 key，會先跨裝置互踩、再由人工加入排除清單——此為黑名單制固有成本，由 diff 的 value 可見性緩解（新 key 首次出現即在 diff 顯示）。top-level／plugins 因維持允許清單不承擔此風險
- **opencode 採 XDG 佈局**：設定家為 `~/.config/opencode`（非 `~/.opencode`），機密（`auth.json`）與資料庫（`opencode.db`）落在 `~/.local/share`／`~/.cache`／`~/.local/state`，與設定家分屬不同根目錄，故天生不在同步射程；設定家內的執行期產物（`node_modules/`、`package.json`、`package-lock.json`、`plugins/`）因未列入同步清單，也不會被同步
- **opencode 主設定檔名變體**：opencode 同時接受 `opencode.json` 與 `opencode.jsonc`；同步時以兩端實際存在者為 canonical `label`（`.jsonc` 優先、皆不存在採預設 `opencode.jsonc`），repo 端恆為單一檔名。**雙變體 orphan 提醒**：若某裝置本機原為 `opencode.json` 而 canonical 解析為 `.jsonc`，`to-local` 會寫入 `.jsonc`，該裝置可能同時留存 `.json` 與 `.jsonc`——請手動刪除非 canonical 的舊檔，避免 opencode 讀到過期設定
- `.agents/skills/` 是本地 skill 實體目錄，已納入版控；Claude Code 靠 `.claude/skills` symlink 讀取，Codex 原生把 `.agents/skills`（專案層）與 `~/.agents/skills`（全域層）納入探索路徑、無需 symlink
- **Windows clone 注意**：`.claude/skills` 這個 git symlink 在 Windows 需開啟「開發者模式」（設定 → 系統 → 開發人員選項）或以管理員權限 clone，否則會 fallback 成內容為路徑字串的純文字檔，導致 Claude Code 找不到 skill。Codex 不受影響，因為它直接讀 `.agents/skills` 實體目錄
- Claude agents 儲存於 `claude/agents/`，以 package 子目錄分組（目前為 `everything-claude-code/`）；Codex agents 儲存於 `codex/agents/`，同樣以 package 子目錄分組（目前無 agent），Codex CLI 會遞迴掃描子目錄
- Skills 不在自動同步範圍內，用 `npm run skills:diff` 查看差異；本機多裝者會列出 `npm run skills:add`（加入 repo）與 `npx skills remove`（從本機移除）兩種建議
- 所有檔案寫入（JSON、文字、目錄鏡射）皆透過底層 `writeFileSafe` 使用 atomic write（先寫同目錄暫存檔再 rename），避免中途斷電／中斷導致檔案損壞
- 同步中途因錯誤中斷時，已寫入的變更仍會逐項列出並警告「已寫入 N 筆變更」，不會無聲消失；操作歷史由 git 本身承載（to-repo 完成後即顯示 git status）
