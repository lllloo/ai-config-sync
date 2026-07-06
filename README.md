# ai-config-sync

跨裝置同步 Claude Code / Codex 設定的私有 Git repo 工具。

**這是一個 GitHub Template**：點 [Use this template](https://github.com/) 建立自己的私有 repo，再執行 `npm run init` 清空作者範例後填入自己的設定。詳見下方「Fork 後初次設定」。

**同步項目**：`~/.claude/CLAUDE.md`、`~/.claude/settings.json`、`~/.claude/statusline.sh`、全域 agents、全域 skills、全域 rules、`~/.codex/AGENTS.md`、`~/.codex/config.toml`（過濾版）、`~/.codex/agents/`

> **目錄命名**：
> - `claude/`（無點）— 要同步到 `~/.claude/` 的全域設定
> - `codex/`（無點）— 要同步到 `~/.codex/` 的全域設定（AGENTS.md、config.toml、agents）
> - `.claude/`、`.codex/` — 本 repo 專用的 Claude Code / Codex 本地設定，**不參與同步**
> - `.agents/skills/` — 本地 skill **實體目錄**（已納入版控），`.claude/skills` 與 `.codex/skills` 皆為 symlink 指向此處，跨工具共用

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
| `sync.js` | 主腳本，實作所有指令邏輯（無外部相依） |
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
| `1` | diff 模式：有差異（可用於 CI 判斷） |
| `2` | 錯誤 |

## 注意事項

- `settings.json` 的 **top-level 採黑名單混合制**：預設同步官方 top-level 欄位，僅排除兩類——`DEVICE_SETTINGS_KEYS` 黑名單（裝置偏好 `model`／`effortLevel`／`defaultShell`／`tui`／`autoUpdatesChannel`、平台綁定 `hooks`、憑證 helper `apiKeyHelper`／`awsCredentialExport`／`awsAuthRefresh`／`otelHeadersHelper`）與命中敏感命名 pattern（key／token／secret／credential／password／auth／cert／cookie／session／jwt／helper／refresh，不分大小寫）的 key。被排除者不進 repo、不入 diff；to-local 時保留本機原值。**風險承擔（明文）**：未知的裝置型新欄位會預設同步、可能跨裝置互踩，需人工加入黑名單——發現互踩靠一般 diff 的內容差異，發現 pattern 誤傷靠 diff **預設**列出的「未同步（敏感護欄排除）」key 清單（只列 key 名、不印值）。此行只列**意料之外**的排除——命中 pattern 但未明列於 `DEVICE_SETTINGS_KEYS` 的 key；明列的裝置鍵（`model`／`hooks`／`tui`／`autoUpdatesChannel` 等）是預期排除、不印，避免永久噪音稀釋救命訊號
- `settings.json` 的 `env` 區塊採**黑名單混合制**（與 top-level 對齊）：env key **預設同步**，僅排除列於 `DEVICE_ENV_KEYS` 黑名單者（`CLAUDE_CODE_USE_POWERSHELL_TOOL`、`ANTHROPIC_CUSTOM_HEADERS`、`HTTP_PROXY`／`HTTPS_PROXY`／`ALL_PROXY`，大小寫不敏感）與命中 `SENSITIVE_KEY_PATTERN`（key／token／secret／…）者；被排除者不進 repo、不入 diff，to-local 時保留本機原值。四層控制：① `DEVICE_ENV_KEYS` 黑名單 → ② key 名 pattern 剝除 → ③ 值層 `SECRET_VALUE_PATTERN` 掃描（to-repo fail-loud）→ ④ 明細 diff 對 env 值遮罩為 `***`（純讀取 diff 不外洩值）。**已承擔的殘餘風險（明文）**：黑名單無法枚舉機密 key 名，key 名乾淨＋值非已知前綴＋未列黑名單的機密（如 `DB_PASS=hunter2`、`postgres://u:pw@h`）仍會經 to-repo 寫入 repo／git history（永久）；④ 只擋 diff 顯示、擋不了寫入。緩解：機密改由 `apiKeyHelper`／本機憑證檔提供、to-repo 後檢視
- **值層防線**：收斂結果會被遞迴掃描——巢狀欄位名含敏感字、值命中已知機密前綴（`sk-`／Stripe `sk_live_`／`ghp_`／`AKIA`／Google `AIza`／SendGrid `SG.`／`npm_`／Slack `xox*`／JWT 等）或絕對家目錄路徑（`C:\Users\…`、`/home/…`、`/Users/…`）時觸發。行為依方向而異：**to-repo 實際寫入前中止並報錯**（訊息只含欄位路徑、不含值）；**diff 標記 `[!]` 暫不同步並續列其他項目**；**to-local 不受阻**（僅比對、不寫回 repo）。命中時請改寫該值（如絕對路徑改用 `~/`）或將該欄位加入 `DEVICE_SETTINGS_KEYS`
- **機密掃描僅涵蓋 `settings.json` 與 `codex/config.toml`**：CLAUDE.md、rules、skills、statusline.sh 等純文字檔為原樣鏡射、不經任何掃描，勿在其中存放金鑰／token
- **`hooks` 不跨裝置同步**：hook command 多為平台綁定（PowerShell／終端跳脫序列），在 Windows 與 macOS 無法共用，故各裝置自行維護本機 `hooks`，repo 不攜帶。需在新裝置重建 hook 時手動設定
- `codex/config.toml` 只同步可攜欄位：`personality`、`web_search`、`tui.status_line`、`features.memories`、`features.goals`、`memories.generate_memories`、`memories.use_memories`、`plugins.*.enabled`
- `codex/config.toml` 會排除 `model`、`model_reasoning_effort`、`projects.*`、`marketplaces.*`、`windows`、`tui.model_availability_nux` 與未知欄位；to-local 時保留本機未受管理欄位
- `.agents/skills/` 是本地 skill 實體目錄，已納入版控；`.claude/skills` 與 `.codex/skills` 以 symlink 共用同一份來源
- Claude agents 儲存於 `claude/agents/`，以 package 子目錄分組（目前為 `everything-claude-code/`）；Codex agents 儲存於 `codex/agents/`，同樣以 package 子目錄分組（目前無 agent），Codex CLI 會遞迴掃描子目錄
- Skills 不在自動同步範圍內，用 `npm run skills:diff` 查看差異；本機多裝者會列出 `npm run skills:add`（加入 repo）與 `npx skills remove`（從本機移除）兩種建議
- 所有檔案寫入（JSON、文字、目錄鏡射）皆透過底層 `writeFileSafe` 使用 atomic write（先寫同目錄暫存檔再 rename），避免中途斷電／中斷導致檔案損壞
- 每次 to-repo / to-local 操作會記錄到 `.sync-history.log`（已加入 .gitignore）；同步中途因錯誤中斷時，已寫入的變更仍會列出並記入 log（標記「因錯誤中斷」），不會無聲消失
