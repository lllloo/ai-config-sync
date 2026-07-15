# Tasks：跨工具全域 skill

依相依順序排。標 ⚠ 者為破壞性或高風險,需先有測試護網再動。

## 1. 前置：新 symlink 能力（sync.js 至今無）

- [x] 1.1 新增 `ensureSymlink(target, linkPath, dryRun)` 工具函式：幂等（已是正確 symlink→跳過、指錯→修、懸空 symlink→unlink 重建、被真實目錄佔用→走 D5 轉換）；**型別判斷一律 `lstatSync`**（`statSync`／`existsSync` 跟隨 link 會誤判、破壞幂等；懸空 symlink 對 `existsSync` 回 false，直接 `symlinkSync` 會 EEXIST）；走 atomic 慣例；回傳 `{action}` 供 changeLog
- [x] 1.2 Windows 分支：dir symlink 失敗時嘗試 junction（`fs.symlinkSync(target, path, 'junction')`）；junction 也失敗則拋帶 context 的 `SyncError`（不 silently 略過）
- [x] 1.3 為 `ensureSymlink` 補純函式／沙箱單元測試（幂等、修錯指向、**懸空 symlink 修復**、Windows fallback 以 mock 覆蓋）

## 2. 新增 `agents/` 同步區與 `xtool-skills` 型別

- [x] 2.1 `SYNC_AREAS` 加 `agents: { homeBase: AGENTS_HOME, repoDir: 'agents', prefix: 'agents/' }`
- [x] 2.2 `SYNC_MANIFEST` 加 `{ area: 'agents', label: 'skills', type: 'xtool-skills' }`，**插在 `claude` 區 `skills` dir 列之前**（順序即安全：agents 端寫入與 dir→symlink 轉換先於 claude mirror，見 design D5 空目錄陷阱）
- [x] 2.3 實作 `xtool-skills` 的**非 prune upsert**：只迭代 repo `agents/skills/` 的 skill 名寫入 `~/.agents/skills/<name>/`，**絕不列舉 dest 全體刪差集**（區別於 `mirrorDir`）；單一 skill 目錄內部可 prune 自身殘檔，但不觸碰 sibling
- [x] 2.4 `applySyncItem` 的 `switch` 接 `xtool-skills`：先 2.3 upsert → 再 `ensureSymlink(~/.agents/skills/<name>, ~/.claude/skills/<name>)`
- [x] 2.5 `diffSyncItem` 的 `switch` 接 `xtool-skills`：只比對受管名字，輸出狀態行；不列 npx 住戶；碰撞以新 status 值 `conflict` 呈現、計入 `EXIT_DIFF=1`（design D6 呈現方式）
- [x] 2.6 `buildFullDiffList`：`xtool-skills` 摘要行呈現（類比 `dir` 特判）
- [x] 2.7 `to-repo` 方向：只從 `~/.agents/skills/<受管名字>/` 讀回 repo，不掃描吸入非受管名字
- [x] 2.8 `safety-check.js` 納入新來源：`SAFETY_SCAN_DIRS` 加 `'agents'`（新同步來源不得逃出 safety 掃描）；`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 加 `'agents/skills/'`（對稱 `claude/skills/`，避開遷移後 skill 內文的 text-pattern 假陽性，結構化掃描仍跑）

## 3. D6 同名碰撞守門

- [x] 3.1 upsert 前偵測碰撞：**唯一判準為 `<name>` 登記於 `~/.agents/.skill-lock.json`**；「claude 側 symlink 存在」不得作為訊號（與本機制自身產物無法區分，會讓第二次 apply 起誤判、破壞幂等——design D6）
- [x] 3.2 碰撞時**拒絕覆寫、印 warning**，不 silently 蓋 npx skill；diff 階段即以 `conflict` status 先標示
- [x] 3.3 沙箱測試：dest 預置一個「npx 登記」的同名 skill，apply 後該 skill **未被覆寫**且有 warning
- [x] 3.4 沙箱測試（幂等回歸鎖）：受管 skill 先 apply 一次成功後**再次 apply 不判碰撞**、正常 upsert

## 4. ⚠ D5 遷移（一次性、破壞性）

- [x] 4.1 repo 端 `git mv claude/skills/{bmad-run-story,mini-research,pen-design} agents/skills/`，並**確認 `claude/skills/` 不殘留空目錄**（存在但為空的 src 會讓 `mirrorDir` prune dest 全體——design D5 防線之一）
- [x] 4.2 `xtool-skills` apply 支援「本機端真實目錄→symlink」轉換：確認 `~/.agents` 端已寫成功 → 刪 `~/.claude/skills/<name>` 真實目錄 → 建 symlink；**任一步失敗附掛 `partialChanges` 並警告,不在刪目錄後、建 symlink 前留空窗**
- [x] 4.3 轉換幂等：已是正確 symlink 直接跳過
- [x] 4.4 沙箱測試：預置真實目錄狀態,跑 `to-local`,驗證轉成正確 symlink 且內容從 `~/.agents` 可達；模擬中途失敗驗證 `partialChanges` 可見

## 5. 測試護網（共管安全是重點）

- [x] 5.1 `apply-integration.test.js` 加 `xtool-skills` 雙向 apply 端到端
- [x] 5.2 **共管不誤刪**：dest（沙箱 `~/.agents/skills`）預置非受管 skill,apply 後仍在（回歸鎖 D3 語意）
- [x] 5.3 `boundary.test.js`：symlink 建立失敗 fallback、`to-repo` 不吸入非受管名字、`getFiles` 對新 xtool symlink 的跳過行為（claude 區 mirror 不誤刪,回歸 P4 假警報）、**repo 殘留空 `claude/skills/` 目錄情境**（xtool 列在前時 agents 端先完成寫入與轉換，claude mirror 不刪任何 skill 內容）
- [x] 5.4 drift-guard：`SYNC_AREAS`／`SYNC_MANIFEST` 新增 `agents` 區 ↔ README 同步項目表一致
- [x] 5.5 drift-guard：`SAFETY_SCAN_DIRS`／`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 新增項 ↔ README safety 掃描來源敘述一致（CLAUDE.md 既有「增減排除目錄與 section 常數須改常數與 README」把關線的延伸）

## 6. 文件

- [x] 6.1 README 同步項目表加 `agents/skills/ ↔ ~/.agents/skills/`（含 symlink 進 `~/.claude/skills/` 說明）；「刻意不同步」與命名節補述共管語意（含 D6 碰撞判準與已知取捨：未登記 lock 的手動同名目錄會被視為受管而覆寫）；safety:check 掃描來源敘述加入 `agents/`（對應 2.8 常數異動，5.5 drift-guard 把關）
- [x] 6.2 CLAUDE.md 目錄命名節加 `agents/`（無點 ↔ `~/.agents/`）；Skills 管理節補「全域跨工具」層,與 `claude/skills/`（Claude-only）、`.agents/skills/`（本地）三分
- [x] 6.3 UPSTREAM.md：#743 merge 時複驗 prune 語意的追蹤註記（T2 收斂但保留）

## 7. 收尾驗證

- [x] 7.1 `npm test` 全綠
- [x] 7.2 `npm run safety:check` clean（驗證 2.8 生效：`agents/skills/` 已在掃描射程內、遷移的三個 skill 無假陽性）
- [x] 7.3 手動：`npm run diff`／`status` 正確顯示 xtool skill,不洩漏內容、不列 npx 住戶
- [ ] 7.4 實機驗證：遷移後 Claude Code 與 Codex 皆能看到 `bmad-run-story` 等三個 skill

## 未納入（另案 / Non-Goal）

- Windows junction 是否被 Claude/Codex 認可需實測（4.x 若在非 Windows 開發,標為釋出前 Windows 驗證項）
- opencode skill 探索（Non-Goal）
- B2（repo 變 npx 可裝來源）為替代路線,不在本 change
