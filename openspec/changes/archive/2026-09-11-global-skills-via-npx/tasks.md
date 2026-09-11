## 1. 搬移與 lock 登記

- [x] 1.1 `git mv agents/skills skills`；確認 `agents/` 目錄為空並移除
- [x] 1.2 以 `npx skills add lllloo/ai-config-sync --list` 實測（不加 `--full-depth`）能列出 bmad-goal／map／map-fast／project-map 四支
- [x] 1.3 以 `npm run skills:add -- <name> lllloo/ai-config-sync` 將四支寫入 `skills-lock.json`
- [x] 1.4 `test/map-skill.test.js` 的 `MAP_ROOT` 改指 `skills/map`

## 2. 移除 xtool-dir 型別（先寫回歸鎖，再刪）

- [x] 2.1 `test/sync.test.js`：新增「`SYNC_MANIFEST` 不含 `type: 'xtool-dir'`、`SYNC_AREAS` 無 `agents`、`sync.js` 不 require `xtool-dir.js`、`diffSyncItem`／`applySyncItem` 無 `case 'xtool-dir'`」回歸鎖（比照 `mcp`／`advisory`），先確認失敗
- [x] 2.2 `sync.js`：刪 `SYNC_MANIFEST` 的 agents 列、`SYNC_AREAS.agents`、`AGENTS_HOME`／`AGENTS_SKILLS_HOME`／`CLAUDE_SKILLS_HOME`／`GEMINI_SKILLS_HOME`／`REPO_AGENTS_SKILLS`／`BRIDGE_CONFLICT_LIST_MAX` 常數、`xtoolDirModule` require、`_xtoolDir` singleton、兩個 `case 'xtool-dir'`、module.exports 中的 xtool re-export；`LOCAL_SKILL_LOCK` 保留（skills.js 仍用）
- [x] 2.3 `sync.js`：刪 `symlinkWithFallback`／`createSymlinkAtomic`／`ensureSymlink`；保留 `lstatSyncSafe` 並更新其註解（消費者為 `to-win-local`）
- [x] 2.4 `sync.js`：刪 `collectSkillDiffSummary`／`printSkillDiffSummaries`，`runDiff` 改回單一 `printDiffItem` 迴圈；`printDiffItem` 的 `statusMap` 移除 `conflict`
- [x] 2.5 刪除 `xtool-dir.js`
- [x] 2.6 `safety-check.js`：`SAFETY_SCAN_DIRS` 以 `'skills'` 取代 `'agents'`；檔頭註解中提到 `agents/skills/` 的段落改寫
- [x] 2.7 2.1 的回歸鎖轉綠

## 3. 測試清理

- [x] 3.1 `test/sync.test.js`：刪 xtool manifest 測試（約 607–630 行）、`collectSkillDiffSummary` 測試（約 805–845 行）、README 載明 `agents/skills/` 的斷言；drift-guard 改為斷言 README 載明 `skills/`
- [x] 3.2 `test/fs-symlink.test.js`：刪 `ensureSymlink`／`createSymlinkAtomic`／`symlinkWithFallback` 測試；剩餘 `lstatSyncSafe` 測試併入 `sync.test.js` 後刪除整檔（若無剩餘則直接刪檔）
- [x] 3.3 `test/apply-integration.test.js`：刪 xtool 情境（17 處引用）；`SYNC_RUNTIME_FILES` 移除 `xtool-dir.js`；新增「`to-local` 不觸碰 `~/.agents/skills/`、`~/.claude/skills/`、`~/.gemini/config/skills/`（內容 + mtime）」斷言
- [x] 3.4 `test/diff-integration.test.js`：`SYNC_RUNTIME_FILES` 移除 `xtool-dir.js`；刪 xtool 情境
- [x] 3.5 `test/boundary.test.js`：`SAFETY_RUNTIME_FILES` 移除 `xtool-dir.js`；反向 require 掃描清單移除 `xtool-dir.js`；`SAFETY_SCAN_DIRS` drift-guard 改為 `claude`／`codex`／`skills`／`gemini`；刪 xtool 相關（6 處引用）
- [x] 3.6 `npm test` 全綠、`npm run safety:check` clean、`npm run status` 不再列 `agents/skills/`

## 4. 文件

- [x] 4.1 `README.md`：同步項目表刪 `agents/skills/` 列；「目錄命名」與「Skills 與 Agents」改寫為 `skills/` + `npx skills`；「新裝置部署」加 `skills:diff` 步驟；新增「自寫全域 skill 的遷移」段落（design Migration Plan 步驟 2 的指令與 hash 檢查）；「專案檔案」表更新；`safety:check` 段掃描來源改 `skills/`
- [x] 4.2 `CLAUDE.md`：目錄命名表刪 `agents/` 列、加 `skills/` 列；架構重點刪 `xtool-dir.js` 段與 symlink 工具層說明；「Skills 管理」兩層表改寫（全域＝`skills/` + `npx skills`）、刪 D5 守門段；同步項目表刪 `agents/skills/` 列；「注意事項」刪 xtool 觀測條；反向 require 禁令清單移除 `xtool-dir.js`
- [x] 4.3 `.agents/skills/sync-check-updates/SKILL.md`：`agents/skills/map/` 改為 `skills/map/`
- [x] 4.4 `openspec/specs/cross-tool-skill-sync/spec.md` 的 Purpose 段改寫為 npx 安裝契約（delta 不覆蓋 Purpose，需直接編輯主 spec）

## 5. 本機遷移與驗證

- [x] 5.1 依 design Migration Plan 步驟 2 移除舊產物並以 `npx skills add -g` 重裝四支
- [x] 5.2 檢查 `~/.agents/.skill-lock.json` 四筆 `skillFolderHash` 非空；`npm run skills:diff` 全綠
- [x] 5.3 Claude Code 端確認 `/map`、`/bmad-goal` 仍可被探索；Antigravity 端確認 map 可見，將實際讀取路徑寫入 README 遷移段落（若需手動 symlink，記指令）
- [x] 5.4 `npm run status` 全綠後 commit
