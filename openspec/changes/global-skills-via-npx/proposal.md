## Why

repo 自寫的 4 支全域 skill（`bmad-goal`／`map`／`map-fast`／`project-map`）目前由自製的 `xtool-dir` 同步型別裝進 `~/.agents/skills/` 並橋接 `~/.claude/skills/`——這正是 `npx skills add -g` 已經做好的事。為了與 `npx skills` 在同一目錄共管，本 repo 多養了 `xtool-dir.js`（426 行）、`sync.js` 的 symlink 工具層、D5／D6 兩道守門、部分變更併入與對應的大量回歸測試，且共管邊界仍持續出修正（最近一次：lock 狀態未知時拒絕覆寫）。`2026-07-15-cross-tool-global-skills` 當初將「push GitHub → `npx skills` 安裝」列為 B2 方案另案評估；本 change 即為該評估的結論：改走 B2，砍掉整個 `xtool-dir` 型別。

已實測（`npx skills` 1.5.25）：`npx skills add lllloo/ai-config-sync --list` 對本私有 repo 可直接發現 skill；README 明列掃描容器目錄為 `skills/`／`.agents/skills/`／`.claude/skills/`，私有 repo 沿用 git／`gh`／SSH 既有認證；安裝時以 GitHub tree API 的資料夾 hash 記入 `skillFolderHash`，`update -g` 據此比對。

## What Changes

- **搬移**：`agents/skills/<name>/` → `skills/<name>/`（repo 頂層，`npx skills` 慣例路徑，預設掃描即可發現、不需 `--full-depth`）。`agents/` 同步區隨之消失。
- **安裝方式改為 `npx skills`**：4 支 skill 以 `npx skills add lllloo/ai-config-sync -g -y --skill <name>` 安裝，並以既有 `skills:add` 記入 `skills-lock.json`（source 為 `lllloo/ai-config-sync`）。之後 skill 內容更新流程為：改 `skills/<name>/`、commit、push、各裝置 `npx skills update -g`。
- **BREAKING：移除 `xtool-dir` 同步型別**：刪 `xtool-dir.js`、`SYNC_MANIFEST` 的 `agents/skills` 列、`SYNC_AREAS.agents`、`sync.js` 中僅供其使用的 symlink 工具層（`ensureSymlink`／`createSymlinkAtomic`／`symlinkWithFallback`／`lstatSyncSafe`）與 xtool lazy singleton。型別集合縮為 `file`／`dir`／`settings`；`xtool-dir` 加入「不得復活」回歸鎖（與 `mcp`／`advisory` 同列）。
- **safety:check**：`SAFETY_SCAN_DIRS` 以 `skills` 取代 `agents`——`skills/` 雖不再由 `sync.js` 寫入家目錄，但仍是會被 `npx skills` 裝進家目錄的 repo 內容，須留在掃描射程。
- **測試**：刪 `test/fs-symlink.test.js` 中 xtool 專屬部分、`apply-integration.test.js`／`diff-integration.test.js`／`sync.test.js`／`boundary.test.js` 的 xtool 情境；runtime 檔清單移除 `xtool-dir.js`；反向 require 掃描清單移除 `xtool-dir.js`。
- **文件**：CLAUDE.md、README、`.agents/skills/sync-check-updates/SKILL.md` 中所有 `agents/skills/`／`xtool-dir` 敘述改寫；`openspec/changes/archive/` 歷史文件不回溯改寫。
- **本機一次性遷移**（不由工具執行，寫進 README）：手動移除 `~/.agents/skills/<name>` 與 `~/.claude/skills/<name>` 舊產物後以 `npx skills add` 重裝；裝完檢查 `~/.agents/.skill-lock.json` 四筆 `skillFolderHash` 非空（空值會讓 `update -g` 以 Private or deleted repo 跳過）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `cross-tool-skill-sync`：整份 requirement 撤除——全域 skill 不再由 `sync.js` 同步；改為「全域 skill 唯一落點為 repo `skills/`，安裝與更新一律經 `npx skills`，`sync.js` 不得寫入 `~/.agents/skills/` 或 `~/.claude/skills/`」。
- `xtool-dir-module-boundary`：整份 requirement 撤除（模組不存在），runtime 檔清單改為 `sync.js`／`safety-check.js`／`toml-reader.js`／`skills.js` 四檔。
- `skills-module-boundary`：runtime 檔清單同上移除 `xtool-dir.js`。
- `declarative-sync-manifest`：型別集合縮為 `file`／`dir`／`settings`；`xtool-dir` 列入不得復活型別。
- `safety-check`：掃描來源 `agents/` 改為 `skills/`。
- `skills-lock-diff`：「不用 `npx skills list -g`」的理由改寫——共管誤報來源不再是 `xtool-dir` 產物，改為 repo 自身的 `.claude/skills` symlink 與本地 skill 探索路徑；直讀 lock 的行為不變。

## Impact

- 程式：`sync.js`（manifest、areas、type switch、symlink 工具層、singleton、re-export）、`xtool-dir.js`（刪除）、`safety-check.js`（`SAFETY_SCAN_DIRS`）、`skills-lock.json`（+4 筆）。
- 測試：`test/fs-symlink.test.js`、`test/sync.test.js`、`test/boundary.test.js`、`test/apply-integration.test.js`、`test/diff-integration.test.js`、`test/xtool-dir.test.js`（若存在）。
- 文件：`CLAUDE.md`、`README.md`、`.agents/skills/sync-check-updates/SKILL.md`。
- 裝置：每台裝置需能 clone 本私有 repo（git／`gh`／SSH 任一認證）且可執行 `npx`；Windows 端亦同（`to-win-local` 不再攜帶任何 skill）。
- 上游依賴：`vercel-labs/skills` #743（global restore from lock）仍 OPEN，新裝置還原繼續靠本 repo `skills:diff` 印出的安裝指令，行為與既有 3 支外部 skill 一致。
