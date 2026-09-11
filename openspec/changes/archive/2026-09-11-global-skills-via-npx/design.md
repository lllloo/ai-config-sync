## Context

見 proposal.md「Why」。現況要點：

- `SYNC_MANIFEST` 有一列 `{ area: 'agents', label: 'skills', type: 'xtool-dir' }`；`SYNC_AREAS.agents` 對應 `~/.agents/`。
- `xtool-dir.js` 經 `createXtoolDir(deps)` 注入 `AGENTS_SKILLS_HOME`／`CLAUDE_SKILLS_HOME`／`GEMINI_SKILLS_HOME`／`REPO_AGENTS_SKILLS`／`LOCAL_SKILL_LOCK`／`BRIDGE_CONFLICT_LIST_MAX` 與 `getFiles`／`diffDir`／`mirrorDir`／`lstatSyncSafe`／`ensureSymlink` 等工具，由 `sync.js` 的 lazy singleton `xtoolDir()` 建立，`diffSyncItem`／`applySyncItem` 各一個 `case 'xtool-dir'`。
- `sync.js` 的 symlink 工具層（`symlinkWithFallback`／`createSymlinkAtomic`／`ensureSymlink`）唯一消費者是 xtool；`lstatSyncSafe` 另被 `to-win-local` 的家目錄探測使用，**須保留**。
- `runDiff` 內的 `collectSkillDiffSummary`／`printSkillDiffSummaries` 只認 `agents/skills/<name>/<file>` 標籤，型別撤除後成為 dead code。
- 探索點目前有兩處：`~/.claude/skills/<name>`（Claude Code）與 `~/.gemini/config/skills/<name>`（Antigravity，本機只橋了 map／map-fast）。`npx skills` 1.5.25 的 agents 表對 Antigravity 的全域落點為 `~/.gemini/antigravity/skills`（IDE）與 `~/.gemini/antigravity-cli/skills`（CLI，以 `~/.gemini/antigravity-cli` 存在為偵測條件；本機存在）。**`~/.gemini/config/skills` 是否為 Antigravity 實際讀取路徑，repo 內無設計文件佐證，屬未驗證**。
- `skills.js` 的 `skills:diff` 建議指令格式為 `npx skills add <source> -g -y --skill <name>`，`validateSkillSource` 只擋控制字元，`lllloo/ai-config-sync` 可直接作為 source。
- 本 repo 自身的 `.claude/skills` symlink 指向 `../.agents/skills`（本地 skill），與本 change 無關、不動。

## Goals / Non-Goals

**Goals:**
- `sync.js` 完全退出 `~/.agents/skills/`、`~/.claude/skills/`、`~/.gemini/config/skills/` 三個目錄的寫入。
- 自寫全域 skill 與外部 skill 在 `skills-lock.json`／`skills:diff` 中走同一條路，零特例。
- 刪除量最大化：型別、模組、symlink 工具層、摘要函式、對應測試與文件一次清乾淨，不留「日後可能用到」的殘留。

**Non-Goals:**
- 不改 `skills.js` 的指令族行為（`skills:add`／`skills:remove`／`skills:diff` 輸出格式不變）。
- 不為 `npx skills` 寫任何包裝指令（不新增 `skills:install` 之類）；上游 #743 未解決的「全域還原」繼續靠 `skills:diff` 印指令。
- 不回溯改寫 `openspec/changes/archive/` 歷史文件。
- 不處理本地 skill（`.agents/skills/`）。

## Decisions

### D1：repo 端搬到頂層 `skills/`，不用 `--full-depth` 留在 `agents/skills/`

`npx skills` README 明列預設掃描容器為 `skills/`／`.agents/skills/`／`.claude/skills/`。搬到 `skills/` 後安裝指令不需額外旗標，`skills:diff` 現有建議指令格式直接可用。留在 `agents/skills/` 需每台裝置記得加 `--full-depth`，而且 `agents/` 這個「與 `~/.agents/` 同構」的命名在型別撤除後已無語意。

安裝時以 `--skill <name>` 指名，避免把本 repo `.agents/skills/` 下的 7 支本地 skill（openspec 系列、sync-check-updates）一併裝成全域。

### D2：整個型別刪除，不留「空殼型別」或旗標關閉

替代方案是保留 `xtool-dir` 但 manifest 不列——這會留下 426 行無消費者的模組與一整批只為它存在的測試。專案既有慣例（`mcp`／`advisory`）是刪光並加「不得復活」回歸鎖，本 change 照做。

### D3：symlink 工具層一併刪除，`lstatSyncSafe` 保留

`ensureSymlink`／`createSymlinkAtomic`／`symlinkWithFallback` 唯一消費者是 xtool；`lstatSyncSafe` 另被 `to-win-local` 用於判斷 Windows 家目錄存在與否，保留並更新其註解。`test/fs-symlink.test.js` 中針對這三個函式的測試刪除；若該檔刪完只剩 `lstatSyncSafe` 測試，整檔併入 `sync.test.js` 後刪除。

### D4：`safety:check` 掃描 `skills/`，不加排除前綴

`SAFETY_SCAN_DIRS` 的 `'agents'` 換成 `'skills'`。`skills/` 是安裝來源根，依既有規則（曾誤列 `agents/skills/` 的教訓）不得列為 text-pattern 排除前綴。

### D5：Antigravity 探索點交給 `npx skills`，不再由本工具橋接

`npx skills add -g` 依 agents 表偵測本機存在的工具並建立各自的 symlink；Antigravity CLI 對應 `~/.gemini/antigravity-cli/skills`。本工具不再建立 `~/.gemini/config/skills/<name>`。若實測發現 Antigravity 實際讀的是 `~/.gemini/config/skills`，處理方式是在 README 遷移段落記一條手動 symlink 指令，**不**為此保留任何同步程式碼——這是「一台裝置一次」的事，且 `config/skills` 路徑本身未經驗證。

替代方案「保留 gemini 橋接、只砍 agents 正典」被否決：橋接需要 `ensureSymlink` 與正典路徑，等於保留半個 xtool。

### D6：`skills-lock.json` 的 source 用 `lllloo/ai-config-sync` 短寫

與既有三筆（`microsoft/playwright-cli` 等）同格式；`npx skills` 對 GitHub 短寫走 HTTPS → `gh` → SSH 認證鏈，私有 repo 已實測可 clone。不用 `git@github.com:...` 形式，因為那會讓 lock 的 `sourceType` 變成 `git`，`update` 會以「Git URL」理由跳過版本追蹤。

### D7：`collectSkillDiffSummary`／`printSkillDiffSummaries` 刪除

兩者只服務 `agents/skills/` 標籤；`claude/rules/`（`dir` 型）本來就走 `printDiffItem` 逐檔印。刪除後 `runDiff` 回到單一迴圈。

## Risks / Trade-offs

- [裝完 `skillFolderHash` 為空，`update -g` 永遠跳過] → 遷移步驟明列「裝完檢查 `~/.agents/.skill-lock.json` 四筆 hash 非空」；若為空，代表 tree API 對私有 repo 認證失敗，改用 `gh auth login` 後重裝。
- [Antigravity 探索點路徑不一致（`config/skills` vs `antigravity-cli/skills`）] → 見 D5；遷移後於本機實測 Antigravity 是否看得到 map，結果寫進 README。
- [`.agents/skills/` 本地 skill 被誤裝成全域] → 安裝指令固定帶 `--skill`；`skills:diff` 建議指令本來就逐支帶 `--skill`。
- [`~/.claude/skills/<name>` 舊 symlink 殘留指向被刪的正典] → 遷移步驟先刪舊產物再裝；`npx skills` 遇既有 symlink 的行為未驗證，故不依賴它處理。
- [Windows 裝置需新增 git 認證與 Node 前提] → 現行 `to-win-local` 已要求 WSL 內有 Node；Windows 側只需 `gh auth login` 或 SSH key。寫進 README 部署段。
- [歷史 spec `cross-tool-skill-sync` 撤除後只剩一條 requirement] → 保留 capability（安裝／更新契約仍需有落點），不合併進 `skills-lock-diff`。

## Migration Plan

1. repo：`git mv agents/skills skills`；程式與測試改動；`npm test` 全綠；`npm run safety:check` clean；commit。
2. 本機（WSL）：
   ```
   rm -rf ~/.agents/skills/{bmad-goal,map,map-fast,project-map}
   rm ~/.claude/skills/{bmad-goal,map,map-fast,project-map}
   rm ~/.gemini/config/skills/{map,map-fast}
   npx skills add lllloo/ai-config-sync -g -y --skill bmad-goal,map,map-fast,project-map
   ```
   檢查 `~/.agents/.skill-lock.json` 四筆 `skillFolderHash` 非空；`npm run skills:diff` 全綠。
3. 其他裝置：`git pull` 後照 `skills:diff` 建議指令安裝。
4. 回滾：`git revert` 本 change 的 commit，本機 `npx skills remove` 四支後 `npm run to-local` 即回到 xtool 橋接狀態。

## Open Questions

- Antigravity 實際讀取的全域 skill 路徑（`~/.gemini/config/skills` 或 `~/.gemini/antigravity-cli/skills`）。不影響 spec 與任務拆分：兩種結果都只改 README 的遷移段落。
