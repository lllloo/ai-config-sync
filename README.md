# ai-config-sync

跨裝置同步 Claude Code / Codex 設定的私有 Git repo 工具。

**這是一個 GitHub Template**：點 [Use this template](https://github.com/) 建立自己的私有 repo，再執行 `npm run init` 清空作者範例後填入自己的設定。詳見下方「Fork 後初次設定」。

**同步項目**：`~/.claude/CLAUDE.md`、`~/.claude/settings.json`、`~/.claude/statusline.sh`、全域 agents、全域 skills、全域 rules、`~/.codex/AGENTS.md`、`~/.codex/config.toml`（過濾版）、`~/.codex/agents/`

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
| `init` | — |

### 旗標

| 旗標 | 說明 |
|------|------|
| `--dry-run` | 預覽操作，不實際寫入（適用 to-repo / to-local） |
| `--yes` | 略過互動確認（別名 `--force`）；非互動環境（CI / pipe）執行 to-local / init 時必加，否則會直接報錯而非卡住 |
| `--no-color` | 關閉色彩輸出（亦支援 `NO_COLOR` 環境變數；`FORCE_COLOR` 可強制開啟） |
| `--verbose` | 顯示詳細路徑與檔案大小 |
| `--version` | 顯示版本號（別名 `-v`） |
| `--help` | 顯示指令說明 |

> 不在白名單內的旗標（含 typo 如 `--dryrun`）會直接報錯，不會被靜默忽略——避免打錯字而略過 dry-run 預覽真寫入。

```bash
# 範例：預覽 to-repo 會做什麼，不實際寫入
node sync.js to-repo --dry-run

# 範例：顯示詳細差異資訊
node sync.js diff --verbose
```

## Fork 後初次設定

如果你是從 template 建立自己的 repo（而不是回到自己已有的設定 repo），執行以下流程清空作者範例：

```bash
# 1. 從 template 建立自己的 repo 後 clone
git clone <your-new-repo-url>
cd <your-new-repo>

# 2. 清空作者個人內容為空骨架（會互動確認，可加 --dry-run 預覽）
npm run init

# 3. 修改 package.json 的 name 與 description 為你自己的
# 4. 在主力機把本機現有設定推上 repo
npm run to-repo
git add . && git commit -m "init: my settings" && git push

# 5. 其他裝置 clone 後直接 to-local 即可
```

`npm run init` 會：
- 把 `claude/CLAUDE.md`、`codex/AGENTS.md`、`claude/settings.json`、`skills-lock.json` 重置為空骨架（由 `.example` 範本覆寫）
- 刪除 `claude/rules/` 下作者個人化規則檔
- **不會動** `claude/agents/`、`codex/agents/`、`claude/skills/`、`.agents/skills/`、`sync.js`、`test/`（這些對所有人都有用）

## 新裝置部署

如果你已經完成 Fork 後初次設定，第二台之後的機器只要：

```bash
git clone <your-repo-url>
cd <your-repo>
npm run to-local
```

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `sync.js` | 主 CLI 入口，實作同步／diff／skills／init 指令邏輯（無外部相依） |
| `safety-check.js` | `safety:check` 唯讀掃描模組，由 `sync.js` 注入共用工具（不獨立執行、不反向 require） |
| `codex-config.js` | Codex `config.toml` 過濾同步模組（TOML parse／serialize／merge 純函式與常數、load／get／apply 進出口），由 `sync.js` 注入共用工具（不獨立執行、不反向 require；diff 渲染留在 `sync.js`） |
| `test/sync.test.js` | 同步邏輯純函式單元測試（使用 Node.js 內建 `node:test`） |
| `test/settings.test.js` | settings.json 相關純函式單元測試 |
| `test/codex-config.test.js` | Codex config.toml 過濾同步測試 |
| `package.json` | 定義所有 npm 指令 |
| `claude/CLAUDE.md` | 對應 `~/.claude/CLAUDE.md` |
| `claude/settings.json` | 對應 `~/.claude/settings.json` |
| `claude/statusline.sh` | 對應 `~/.claude/statusline.sh` |
| `claude/agents/` | 對應 `~/.claude/agents/`（以 package 子目錄組織） |
| `claude/skills/` | 對應 `~/.claude/skills/` |
| `claude/rules/` | 對應 `~/.claude/rules/`（CLAUDE.md 的模組化拆分，支援 frontmatter `paths:` 做 path-specific scoping） |
| `codex/AGENTS.md` | 對應 `~/.codex/AGENTS.md`（Codex 全域指示，跨專案規則） |
| `codex/config.toml` | 對應 `~/.codex/config.toml` 的可攜欄位（過濾版） |
| `codex/agents/` | 對應 `~/.codex/agents/`（以 package 子目錄組織，`.toml` 格式；目前無 agent） |
| `skills-lock.json` | 全域 skills 清單（跨裝置 source of truth） |
| `claude/CLAUDE.example.md` | Fork 後 `npm run init` 用的空骨架範本 |
| `claude/settings.example.json` | 同上，設定檔範本（僅基本 permissions） |
| `codex/AGENTS.example.md` | 同上，Codex 全域指示範本 |
| `skills-lock.example.json` | 同上，空 skills 清單範本 |

## Exit Code

| Code | 說明 |
|------|------|
| `0` | 成功（diff 模式：無差異） |
| `1` | diff 模式：有差異；`safety:check`：只有 warning |
| `2` | 錯誤；`safety:check`：有 hard block |

## 注意事項

- `settings.json` 的 **top-level 採黑名單制**：預設同步 top-level 欄位，僅排除 `DEVICE_SETTINGS_KEYS` 明確黑名單（裝置偏好 `model`／`effortLevel`／`defaultShell`／`tui`／`autoUpdatesChannel`、平台綁定 `hooks`、憑證 helper `apiKeyHelper`／`awsCredentialExport`／`awsAuthRefresh`／`otelHeadersHelper`）。敏感命名 pattern（key／token／secret／credential／password／auth／cert／cookie／session／jwt／helper／refresh）**不再**讓 sync 自動剝除或中止；未列黑名單的 key 依一般 settings 差異同步，並由 `npm run safety:check` 以 warning 供人工審核
- `settings.json` 的 `env` 區塊 **全部依一般同步語意同步**：不再因 `DEVICE_ENV_KEYS` 或敏感命名 pattern 被剝除，也不在 to-local 特別保留本機 env key。`diff`／`status` 顯示層仍會把 env 值遮罩為 `***`，避免差異預覽印出值；但實際 repo 內容是否安全須由 `npm run safety:check` 與人工審核判斷
- **`npm run safety:check`** 是手動、唯讀、離線檢查：掃描 `claude/`、`codex/` 與 `skills-lock.json`，不掃 `test/`、`openspec/`、README 等非同步來源文件。hard block 包含已知 token 值樣式、私鑰片段、絕對 HOME 路徑、repo `claude/settings.json` 出現 `hooks` 或 credential helper 欄位；warning 包含 `claude/settings.json` 的 env key 清單與結構化設定中命中敏感命名 pattern 的 key path。輸出只列分類、檔案與欄位／key／line，不列 env 值、secret 原值或完整 HOME 路徑
- **同步流程不保證阻止機密寫入 repo**：`to-repo` 只做明確不同步欄位剝除與資料搬移；CLAUDE.md、rules、skills、statusline.sh 等仍為原樣鏡射。建議流程是 `npm run to-repo` 後、commit 前執行 `npm run safety:check` 與 `git diff`
- **`hooks` 不跨裝置同步**：hook command 多為平台綁定（PowerShell／終端跳脫序列），在 Windows 與 macOS 無法共用，故各裝置自行維護本機 `hooks`，repo 不攜帶。需在新裝置重建 hook 時手動設定
- `codex/config.toml` 只同步可攜欄位：`personality`、`web_search`、`tui.status_line`、`features.memories`、`features.goals`、`memories.generate_memories`、`memories.use_memories`、`plugins.*.enabled`
- `codex/config.toml` 會排除 `model`、`model_reasoning_effort`、`projects.*`、`marketplaces.*`、`windows`、`tui.model_availability_nux` 與未知欄位；to-local 時保留本機未受管理欄位
- **未分類欄位提示**：`diff`／`status`／`to-repo` 會列出本機 `config.toml` 中「白名單未涵蓋、也非已知 device section（`model_providers`／`mcp_servers`／`projects`／`profiles`／`history`／`shell_environment_policy`）」的欄位——這些**不會被同步**（白名單 fail-safe 不變），只是提示你判斷是否納入白名單（例如 Codex 改版新增的可攜欄位），可把清單貼給 Claude／Codex 討論。只印 key path、不印值，不洩漏；device section 因明顯含憑證／本機路徑而刻意不提示
- `.agents/skills/` 是本地 skill 實體目錄，已納入版控；Claude Code 靠 `.claude/skills` symlink 讀取，Codex 原生把 `.agents/skills`（專案層）與 `~/.agents/skills`（全域層）納入探索路徑、無需 symlink
- Claude agents 儲存於 `claude/agents/`，以 package 子目錄分組（目前為 `everything-claude-code/`）；Codex agents 儲存於 `codex/agents/`，同樣以 package 子目錄分組（目前無 agent），Codex CLI 會遞迴掃描子目錄
- Skills 不在自動同步範圍內，用 `npm run skills:diff` 查看差異；本機多裝者會列出 `npm run skills:add`（加入 repo）與 `npx skills remove`（從本機移除）兩種建議
- 所有檔案寫入（JSON、文字、目錄鏡射）皆透過底層 `writeFileSafe` 使用 atomic write（先寫同目錄暫存檔再 rename），避免中途斷電／中斷導致檔案損壞
- 每次 to-repo / to-local 操作會記錄到 `.sync-history.log`（已加入 .gitignore）；同步中途因錯誤中斷時，已寫入的變更仍會列出並記入 log（標記「因錯誤中斷」），不會無聲消失
