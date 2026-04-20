# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

此 repo 是 Claude Code 跨裝置設定同步工具，透過私有 Git repo 讓多台裝置的 Claude Code 設定保持一致。

## 目錄命名（重要）

- **`claude/`**（無點）— 要同步到 `~/.claude/` 的全域設定內容（CLAUDE.md、settings.json、agents、commands、skills），由 `sync.js` 管理。
- **`.claude/`**（有點）— 本 repo 自己在用的 GSD 工作流設定（專案本地 commands / agents / hooks），**不參與同步、不映射到 `~/.claude/`**。

兩者不互通；新增同步項目一律放 `claude/`，勿誤放到 `.claude/`。

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
- `npm test` — 執行三個測試檔（`test/sync.test.js`、`test/settings.test.js`、`test/boundary.test.js`，`node --test`，零相依）
- 單一測試：`node --test --test-name-pattern="<name>" test/<file>.test.js`

**全域旗標**（`node sync.js` 直接呼叫時可用）：`--dry-run`、`--verbose`、`--version`、`--help`。指令別名：`d`/`s`/`tr`/`tl`/`sd`/`sa`。

## 同步項目與對應

| repo 路徑 | 本機路徑 | 備註 |
|-----------|----------|------|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | 全文比對 |
| `claude/settings.json` | `~/.claude/settings.json` | **比對時 strip `model`、`effortLevel`（裝置特定欄位）** |
| `claude/statusline.sh` | `~/.claude/statusline.sh` | 全文比對 |
| `claude/agents/` | `~/.claude/agents/` | 以 package 子目錄組織（如 `awesome-claude-code-subagents/`） |
| `claude/commands/` | `~/.claude/commands/` | 目錄鏡射 |
| `claude/skills/` | `~/.claude/skills/` | 目錄鏡射 |

## 架構重點

**單檔 CLI 設計**：所有邏輯在 `sync.js`（~1900 行，零外部相依，只用 Node.js 內建模組）。檔案結構採 section banner 分段，關鍵不變式：

- **所有函式 ≤ 60 行**（經 iter4/iter5 稽核強制）— 新增函式若超過需拆分
- **Data-driven dispatch**：`COMMANDS` 物件含 `handler`，`main()` 透過 `await COMMANDS[cmd].handler(opts)` 派發，**新增指令只需改 `COMMANDS`**
- **SyncItem 抽象**：`buildSyncItems()` 產出宣告式 `SyncItem[]`，後續 `diffSyncItems` / `applySyncItems` 走統一流程
- **Atomic write**：`writeJsonSafe` 先寫暫存檔再 rename（含 EXDEV fallback），避免斷電損壞
- **統一錯誤處理**：`SyncError` class（`code` + `context`）+ 檔尾 `.catch(formatError)`，所有路徑經 `formatError`，**禁止**裸 `console.error + process.exit`
- **Exit code 語義**：`EXIT_OK=0`（成功或 diff 無差異）、`EXIT_DIFF=1`（diff 有差異，可用於 CI）、`EXIT_ERROR=2`
- **Relative path 遮罩**：`toRelativePath` 處理 REPO_ROOT 與 `$HOME` → `~/`，`printFileDiff` 的 diff header 亦走此函式避免洩漏使用者名稱
- **Skills lock 為純資料 manifest**：`skills-lock.json` 不參與同步流程；`runSkillsDiff` 透過 `npx skills list` 抓本機狀態做集合比對，**只輸出建議指令、不執行安裝/移除**。本機多裝的 skills 會同時列出（A）`npm run skills:add` 加入 repo 與（B）`npx skills remove` 從本機移除兩種選項

**測試策略**：`test/sync.test.js` 只測純函式（`computeLineDiff`、`matchExclude`、`statusToStatsKey`、`parseSkillSource`、`parseArgs`、`toRelativePath`、`COMMANDS` 完整性）。有 IO 的路徑靠 smoke test 人工驗證。若改純函式，**必須**同步更新 unit test，維持全數通過（視同 100% 覆蓋）。

## 修改守則

- **README.md 須同步更新**：新增/移除指令、改變同步項目、調整行為、新增旗標時必跟。
- **新增/調整 npm script 時須同步更新 README 的指令別名表與 `COMMANDS` 物件**，避免別名與 handler 漂移。
- **函式行數守則**：新增或重構後若某函式 > 60 行，需拆分（`buildSyncItems` 54 行為宣告式陣列，例外）。
- **禁止新增外部相依**：所有功能必須使用 Node.js 內建模組，不得 `npm install` 任何套件。
- **settings.json 裝置特定欄位**（`model`、`effortLevel`）若要增減，需同步改 `DEVICE_FIELDS` 常數與 README 注意事項。
- **Bash 規則**（來自全域 CLAUDE.md）：禁用 `$()` 命令替換；禁擅自執行 `npm run build`。
- **嚴禁洩漏敏感資訊**：輸出、log、diff 內容中不得出現 API Key、token 或完整使用者路徑。

## Agents 管理

`claude/agents/` 以 package 子目錄組織，來源優先順序：

1. **`everything-claude-code/`**（主要）— 來自 `affaan-m/everything-claude-code`
2. **`awesome-claude-code-subagents/`**（補充）— 來自 `VoltAgent/awesome-claude-code-subagents`，上游依分類子目錄組織（`categories/01-core-development/` 等），**本機落地時扁平化**（不保留分類層級，所有 `.md` 直接放在 `awesome-claude-code-subagents/` 下），僅安裝 `everything-claude-code` 未涵蓋的功能

**新增 agent 的方式**（用 `gh` 抓原始內容）：
```bash
# 從 everything-claude-code
gh api repos/affaan-m/everything-claude-code/contents/agents/<name>.md --jq '.content' | base64 -d > claude/agents/everything-claude-code/<name>.md

# 從 awesome-claude-code-subagents（需指定分類路徑）
gh api "repos/VoltAgent/awesome-claude-code-subagents/contents/categories/<category>/<name>.md" --jq '.content' | base64 -d > claude/agents/awesome-claude-code-subagents/<name>.md
```

## 注意事項

- `.agents/`（skill 實體）、`.sync-history.log`、`.DS_Store` 皆在 `.gitignore`
- Skills 不在自動同步範圍，`skills-lock.json` 為各裝置參考清單（source of truth）
