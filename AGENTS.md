# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex) when working with code in this repository.

## 同步核心

**repo 是最終要的版本。** AI 只提「repo 要怎麼改」，使用者確認後改 repo、commit，再由 repo 套回本機。寫入方向只有「確認後改 repo → repo 套回本機」一條；本機未被採納的改動會在套回時被 repo 版覆蓋。

## 專案概述

此 repo 是 AI 工具（Claude Code、Codex、Gemini/Antigravity）的跨裝置設定同步工具，透過公開 Git repo 讓多台裝置的全域設定保持一致。使用者向說明與行為細節見 `README.md`，本檔只記 AI 需要的流程與守則。

- **執行環境**：Windows 11（主力）／macOS（次要），跨平台設計；Node.js >= 18，**零外部相依、禁止新增 npm 套件**；無 Python 環境。
- **四個原始檔**：`sync.js`（CLI 入口）、`safety-check.js`（安全掃描）、`toml-reader.js`（TOML 讀取）、`skills.js`（skills 指令族）。

## 目錄命名（重要）

- **`claude/`／`codex/`／`gemini/`**（無點）— 同步到 `~/.claude/`／`~/.codex/`／`~/.gemini/` 的全域設定，由 `sync.js` 管理。新增同步項目依工具放對應目錄。
- **`skills/`（勿建立）** — 全域 skill 住在獨立 repo [lllloo/skills](https://github.com/lllloo/skills)，經 `npx skills add lllloo/skills -g --skill <name>` 安裝；本 repo 只在 `skills-lock.json` 記安裝清單。`sync.js` 永不寫入 `~/.agents/skills/`、`~/.claude/skills/`、`~/.gemini/config/skills/`（測試有回歸鎖）。
- **`.claude/`**（有點）— 本 repo 專用的本地設定落點，**不參與同步**；目前只有已 gitignore 的執行期產物。
- **`.agents/skills/`（目前無）** — 本地 skill 層。要新增時建 `.agents/skills/<name>/SKILL.md`，並補 `.claude/skills` → `../.agents/skills` symlink 供 Claude Code 讀取；Codex 會自動探索，不需 symlink。勿放到 `.claude/` 或 `.codex/`。

## 常用指令

AI 一律以 `node sync.js <指令>` 執行，免去 npm 的 `--` 分隔陷阱（`npm run` 傳旗標不加 `--` 會被 npm 吞掉，`assertNoSwallowedNpmFlags` 會 fail fast）。

- 同步：`diff`、`status`（`diff` + `skills:diff`）、`to-repo`、`to-local`、`to-win-local`（僅 WSL，repo → Windows 家目錄）、`safety:check`
- Skills：`skills:diff`、`skills:add`、`skills:remove`
- 旗標：`--dry-run`、`--yes`（非互動 to-local 必加）、`--verbose`；**未知旗標拋 `INVALID_ARGS`**，不靜默忽略
- 測試：`npm test`；單一測試 `node --test --test-name-pattern="<name>" test/<file>.test.js`

## 同步流程（repo 為最終版本）

核心見檔頭「同步核心」。使用者說「同步」「sync」時照下列步驟做——使用者不自己跑指令，一律由 AI 執行。

1. **收**：`git pull --ff-only`；失敗（分岔）即停下回報，不自行 merge／rebase。
2. **找差異**：`node sync.js diff`（exit 0 無差異 → 跳到步驟 8）。
3. **提 repo 變更**：每個差異項以「repo 將如何改」呈現（新增／修改／刪除哪些段落、檔案、settings key）並附建議，以 git 歷史標出來源：
   - 本機整份等於 repo 歷史舊版（`git hash-object --path=<repo 路徑> <本機檔>` 對照 `git log --follow --format=%H -- <repo 路徑>` 各版）→ 本機落後，repo 不改
   - 本機才有、repo 歷史從未出現 → 本機新增，建議加進 repo
   - 本機才有、repo 歷史曾出現 → repo 曾刪除，建議不加回
   - repo 才有 → 分不出是本機刪除或本機落後，不給建議、列給使用者裁定

   `settings.json` 逐 top-level key 呈現，本機可攜形取自 `require('./sync.js').loadStrippedSettings(<本機路徑>).clean`；`DEVICE_SETTINGS_KEYS` 不比。
4. **確認**：使用者可逐項改選，說「照建議」即全數採用。**確認前不得寫入任何檔案**。
5. **改 repo**：照確認結果編輯 repo 內檔案；全數採本機內容時可直接 `node sync.js to-repo`。`settings.json` 維持 repo 既有格式，`DEVICE_SETTINGS_KEYS` 不得寫入。
6. **把關與提交**：`node sync.js safety:check`（exit 2 即停下回報；exit 1 把 warning 給使用者看過）→ 給使用者看 `git diff --stat` → commit（沿用專案格式，如 `chore(sync): …`）。**repo 公開，push `main` 須使用者明確同意。**
7. **套回本機**：`node sync.js to-local --yes`，再跑 `node sync.js diff` 確認 exit 0。
8. **skills**：`node sync.js skills:diff` 只列差異與建議指令，裝／移除由使用者決定。`orca-cli`／`orchestration` 由 Orca 自裝、固定列為本機多裝，忽略即可。
9. **Windows 端**（僅 WSL 內、使用者要求時）：`node sync.js to-win-local --dry-run` 預覽，確認後 `--yes`。

## 同步項目

| repo 路徑 | 本機路徑 | 備註 |
|-----------|----------|------|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | 全文比對 |
| `claude/settings.json` | `~/.claude/settings.json` | top-level 黑名單制：排除 `DEVICE_SETTINGS_KEYS`（裝置偏好、`hooks`），其餘整鍵同步、不合併；細節見 README「settings.json 同步行為」 |
| `claude/statusline.sh` | `~/.claude/statusline.sh` | 全文比對 |
| `claude/rules/` | `~/.claude/rules/` | 目錄鏡射（含刪除） |
| `codex/AGENTS.md` | `~/.codex/AGENTS.md` | 全文比對 |
| `gemini/GEMINI.md` | `~/.gemini/GEMINI.md` | 全文比對 |

### 刻意不同步（勿加入 `SYNC_MANIFEST`）

- **`~/.codex/config.toml`**、**`~/.claude.json`** — 永不被本工具寫入或讀取（測試以內容 + mtime 雙重斷言把關）。不要新增 `codex/config.toml` 或整檔 manifest 列。
- **MCP Server 定義（兩端）** — 不同步，待重新設計，各裝置以官方 CLI 手動維護。重新設計時憑證判準必須 fail closed，OAuth／headers／env 值／token 不得進 repo；不要順手刪除舊版孤兒 state 檔。
- **`advisory`／`mcp`／`xtool-dir` 型別不得復活**（`sync.test.js` 回歸鎖）。

## 架構不變式

- **反向 require 禁令**：`safety-check.js`／`toml-reader.js`／`skills.js` 不得 `require('./sync.js')`，共用工具經 `createSafetyChecker(deps)`／`createSkillsHandler(deps)` 注入（注入清單見各檔檔頭；`boundary.test.js` 有回歸鎖）。
- **`toml-reader.js` 不可刪**：它是 `safety:check` 掃 `.toml` 機密 section 的唯一依賴，擋「人工把 `~/.codex/config.toml` 複製進 repo」，與 MCP 同步無關。header 解析與各種 fail-closed 設計見檔內註解，由 `toml-reader.test.js`／`boundary.test.js` 把關。
- **函式 ≤ 60 行**，超過須拆分；唯一例外是 DI factory 本體（其內各閉包仍須 ≤ 60 行）。
- **指令分派**：新增指令須同步改 `COMMANDS`（名稱／別名／說明）、`runCommand` 的 `switch` 與 README 別名表（drift-guard 把關）。刻意不走 handler 注入表。
- **`SYNC_MANIFEST`**：一列 = 一路徑，本機路徑一律為 area `homeBase` + `label`；任一列不得指向 `~/.claude.json`（回歸鎖）。`SyncItem.type` 只有 `file`／`settings`／`dir`，由 `diffSyncItem`／`applySyncItem` 以 `switch` 分派。
- **寫入一律走 `writeFileSafe`**（同目錄暫存檔 + rename 的 atomic write，不做 fsync）；讀取走 `readFileSafe`。`diff` 全程唯讀。
- **錯誤一律拋 `SyncError`**，經檔尾 `formatError` 統一輸出；禁止裸 `console.error + process.exit`。Exit code：`0` 成功／無差異、`1` 有差異、`2` 錯誤。
- **路徑顯示走 `toRelativePath`**（REPO_ROOT 與 `$HOME` → `~/`），避免洩漏使用者名稱。
- **部分失敗可見度**：apply 中途失敗時已寫入的變更經 `partialChanges`／`warnPartialApply` 列出。**不要在 `handleSignal` 加「寫入中」旗標或中斷警告**：寫入是無 await 的同步碼，訊號排不進去（理由見該函式註解）。
- **測試不得依賴真實 HOME**；`SYNC_RUNTIME_FILES`／`SAFETY_RUNTIME_FILES` 須含四個原始檔。

## 修改守則

- **設計流程用 Superpowers**：spec 放 `docs/superpowers/specs/`、plan 放 `docs/superpowers/plans/`。
- **README 須同步更新**：新增／移除指令、改變同步項目或行為、新增旗標時必跟。別名表、旗標表、`--help`、`DEVICE_SETTINGS_KEYS`／`KEYED_NOTICE_SETTINGS_KEYS`、safety 的排除清單與 section 常數皆有 drift-guard 測試把關，其餘敘述靠人工。
- **settings.json 黑名單制**：增減排除欄位只改 `DEVICE_SETTINGS_KEYS` 常數與 README；敏感命名 key 與 `env` 照常同步，由 `safety:check` 審核。
- **安全審核由 `safety:check` 承擔**（分類與 exit code 見 README「安全檢查」）：commit 前必跑。輸出**不得**顯示 secret 原值、env 值或完整 HOME 路徑；`diff`／`status` 不印設定內容。

## Skills 管理

- 全域 skill 一律放 skills repo，安裝指令固定帶 `--skill`，避免把來源 repo 的其他 skill 一併裝成全域。**無 `sync.js` 同步的 skill 層**（與 `npx skills` 共管同一目錄的守門成本過高）。
- `skills:diff` 讀 `~/.agents/.skill-lock.json` 與 repo `skills-lock.json` 比對，只印建議指令、不執行。刻意不用 `npx skills list -g`：它會把非 lock 登記的住戶（手動放入的 skill、探索 symlink）一併列入而誤報。
- `skills-lock.json` 的 `agents` 欄位（optional，目前無項目使用）：記要裝給哪個工具，白名單見 `skills.js` 的 `VALID_SKILL_AGENTS`；省略即 Claude Code + Codex 皆裝。`skills:add --agent <值>` 寫入。
- **勿恢復 `claude/skills/` 或 `commands` 同步層**：`dir` 型 prune 會刪掉 `npx skills` 在 `~/.claude/skills/` 建的探索 symlink（`sync.test.js` 回歸鎖）；真要恢復須先重新設計。
- **Agents**：目前無同步項目。要恢復時在 `SYNC_MANIFEST` 加 `{ area, label: 'agents', type: 'dir' }` 一列，並更新 `sync.test.js` 的 label 清單 drift-guard 與 README。
- 上游 `npx skills` 功能追蹤不在本 repo，由 obsidian-memory vault 的 `vault-watch` 追 `vercel-labs/skills` #743／#683／#549（跨裝置全域還原）；#743 merge 後可再評估 `skills:diff` 的角色。
