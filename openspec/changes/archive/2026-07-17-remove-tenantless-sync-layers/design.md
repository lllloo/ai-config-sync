## Context

`SYNC_MANIFEST` 的 `claude/commands`（dir）與 `claude/skills`（dir）兩列目前 repo 端皆無對應目錄。本機端 `~/.claude/commands/` 為空目錄，`~/.claude/skills/` 只含 13 個指向 `~/.agents/skills/`（與一個指向外部 repo）的 symlink，無任何實體內容。

兩列今日**實質為 no-op**：`mirrorDir` 起頭 `if (!fs.existsSync(src)) return changed`，repo 端源目錄不存在時直接返回、不刪本機檔；`to-repo` 方向雖會 `ensureDir(dest)` 建出空的 repo 目錄，但 git 不追蹤空目錄，故從未進版控。`~/.claude/skills/` 那批 symlink 之所以不被 `to-repo` 吸回 repo，是因為 `getFiles` 對逃逸出根目錄的 symlink 直接跳過（`isPathInside` 檢查）。

`claude/skills` 這列的存在支撐著三樣東西：

1. `SYNC_MANIFEST` 中 `xtool-skills` 列必須排在其之前的**順序不變式**（code 註解 + `cross-tool-skill-sync` spec 的 SHALL）。
2. `apply-integration.test.js` 的三個共存測試（665／687／706）。
3. `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 的 `'claude/skills/'` 前綴。

而「repo 端 `claude/skills/` 不得殘留空目錄」這條不變式只記載於 archive（`2026-07-15-cross-tool-global-skills/tasks.md` 4.1），未出現在任何 live code 或 spec。

約束：Node.js >= 18、零外部相依、所有函式 ≤ 60 行、README 與 CLAUDE.md 須同步更新（部分由 drift-guard 測試強制）。

## Goals / Non-Goals

**Goals:**

- 移除兩列無住戶的同步項，使 `status` 輸出的每一列都對應真實的同步關係。
- 溶解「順序即安全」不變式——讓它因保護對象消失而不再需要，而非靠註解維持。
- 保持 `dir` 型別的測試覆蓋率不因 fixture 遷移而下降。
- 維持 `xtool-skills` 的所有既有行為（非 prune 共管、撞名拒寫、dir→symlink 轉換、幂等）逐項不變。

**Non-Goals:**

- 不改動 `xtool-skills` 型的任何邏輯。
- 不移除 `dir` 型別本身（`claude/rules` 仍是住戶）。
- 不清理本機殘留的空目錄（`~/.claude/commands/`、可能由歷次 `to-repo` 建出的 repo 端空目錄）——不在同步射程內，且刪除他人家目錄的目錄超出本變更的授權範圍。
- 不預先設計「日後恢復 Claude-only 層」的機制。

## Decisions

### D1：移除 `claude/skills` 而非保留作為概念落點

**選擇**：移除。

**理由**：保留的唯一價值是「Claude-only skill」的語義表達；代價是一條活著的順序不變式、三個測試、一段 code 註解，外加一條只活在 archive 的隱形不變式。這與 `0f88d4c` 移除 agents 同步項時定下的「不做預防性保留」是同一條線。恢復成本低——`SYNC_MANIFEST` 一列 + drift-guard 清單一改，正是宣告式 manifest 買來的東西；D5 陷阱的完整推理留存於 archive 的 design／tasks，知識不會遺失。

**替代方案**：
- *保留但補文件*：把幽靈寫進文件等於承認它存在還要養它，認知成本不降反升。
- *只移 commands*：順序不變式與三個測試照留，主要成本未消除。

**已知代價**：日後若出現真正 Claude-only 的 skill（如依賴 Claude 專屬 frontmatter），只能放 `agents/skills/`，Codex 也會掃到。實際傷害低（Codex 掃到不會誤觸發），但「只給 Claude」的語義在 repo 佈局上表達不出來。

### D2：移除順序不變式，但保留 dir→symlink 轉換需求

**選擇**：`cross-tool-skill-sync` spec 中「`SYNC_MANIFEST` 中 `xtool-skills` 列 SHALL 排在 `claude` 區 `skills` dir 列之前」整句移除；dir→symlink 轉換的 SHALL 與其 scenario **保留**。

**理由**：兩者常被混為一談，但相依方向不同。dir→symlink 轉換內生於 `applyXtoolItem`／`ensureSymlink`，服務的是「本機仍留有舊機制真實目錄」的裝置，與 claude mirror 是否存在無關——即使 manifest 只剩 `agents` 一列，該裝置的 `~/.claude/skills/<name>` 真實目錄仍需被安全轉換。順序約束保護的則是「claude mirror 可能在 agents 端寫入前先動 dest」這個**僅存在於兩層共存時**的競爭；claude mirror 消失，約束失去指涉對象。

同理，spec 中「repo `claude/skills/` 殘留為空目錄」的 scenario 隨之移除——該情境的前提（存在 `claude/skills` dir 型同步項）已不成立。

### D3：`dir` 型 fixture 改指 `claude/rules`，不新增合成 fixture

**選擇**：`diff-integration.test.js`（repo 端 dir 逐檔 diff）與 `apply-integration.test.js`（dir 同步中途失敗、`partialChanges` 可見度）兩處 fixture 由 `claude/commands` 改為 `claude/rules`。

**理由**：兩個測試測的是 `dir` 型行為本身，`commands` 只是恰好被選中的載體。`claude/rules` 是移除後唯一存活的 `dir` 型項目，用真實項目當 fixture 與現行寫法一致。

**替代方案**：在 manifest 注入測試專用的合成 dir 列——會讓 `SYNC_MANIFEST` 出現只為測試存在的項目，正是本變更要消除的那類幽靈。

### D4：`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 移除 `'claude/skills/'`

**選擇**：排除前綴隨目錄一併撤除，清單收斂為 `['agents/skills/']`。

**理由**：對稱於 `0f88d4c`——移除 `claude/agents/` 目錄時，其豁免也一併撤除。排除前綴是為「原樣鏡射的外部套件文件天生整類 false positive」而設；目錄不存在，豁免即無指涉對象。方向上偏安全：移除豁免是**擴大**掃描射程，不可能讓原本會被擋下的東西漏掉。

**順帶校正**：`safety-check/spec.md` 第 23／42 行仍列 `claude/agents/` 為排除前綴，但該前綴已於 `0f88d4c` 從程式碼移除——spec 與 code 已 drift。本次改寫同一句話，一併校正，避免留下第二個幽靈。

### D5：移除三個共存測試，不改寫

**選擇**：`apply-integration.test.js` 的「xtool + claude mirror 共存（P4 回歸）」「空 `claude/skills` 情境」「`to-repo` 不吸回探索點」三測試整組刪除。

**理由**：三者的斷言全都以「repo 有 `claude/skills` 內容」或「claude mirror 會跑」為前提，前提消失後無法改寫成有意義的斷言。它們保護的失效模式**只因兩層共存而存在**。

**底層保證不受影響**：`getFiles` 跳過逃逸 symlink 是「`to-repo` 不吸回探索點」的真正機制，該行為已由 `boundary.test.js:611`（`getFiles：逃逸到目錄外的 symlink 不被列入`）與 `isPathInside` 的五個純函式測試（`boundary.test.js:387-414`）獨立覆蓋，不依賴被刪的三個整合測試。刪除後無覆蓋缺口。

## Risks / Trade-offs

- **[其他裝置的 `~/.claude/commands/` 可能有內容]** → **實作時查證後判定風險方向相反，已解除**。git 歷史顯示 `claude/commands` 曾有住戶，於 `1d06f4e`（2026-04-30）刻意清空。repo 端清空後，各裝置 `to-local` 時 `mirrorDir` 因 src 不存在而提早返回、不刪任何東西——故其他裝置若殘留舊 command，它們至今仍在原地**且早已不被同步追蹤**（未進版控 = 未被同步）。移除該列不會讓任何裝置失去正在同步的內容。反向而言，殘留內容在今日跑 `to-repo` 時會被吸回 repo，等於**復活已被刻意移除的 command**——移除該列正是堵掉這條路。結論：移除為淨改善，無須逐裝置查核。

- **[尚未執行過 D5 遷移的裝置]**（`~/.claude/skills/<name>` 仍為真實目錄）→ 由 D2 分析可知風險已解除：dir→symlink 轉換內生於 xtool apply，不依賴相對順序。緩解：`apply-integration.test.js` 既有的「真實目錄轉 symlink」測試（非被刪的三個）須維持通過，作為此結論的回歸網。

- **[失去 Claude-only 語義落點]** → 見 D1 已知代價。緩解：恢復成本為 manifest 一列 + drift-guard 一改；archive 保有完整 D5 推理。

- **[`dir` 型僅剩單一住戶]** → `claude/rules` 成為 `dir` 型唯一項目，也是其唯一 fixture。若日後 `rules` 亦消失，`dir` 型會變成新的幽靈。不預先處理——屆時同一套判準（無住戶即移除）自然適用。

- **[`declarative-sync-manifest` 的「與重構前逐項等價」需求]** → 該 spec 有「項目順序 SHALL 不變」「產出等價」等 requirement。字面上本變更移除兩列即改變產出。判定：該需求的範疇是**當時那次 manifest 重構的等價契約**（「與重構前」），並非凍結 manifest 內容的永久約束——否則任何新增同步項（如後來的 opencode、agents 列）都會違反它，而那些變更皆已通過。故不列為 Modified Capability，不修改該 spec。此判讀記錄於此供日後查考。

## Migration Plan

無資料遷移。兩層本就無內容，使用者不會遺失任何同步中的檔案。

**Rollback**：本變更為純移除，回滾即 `git revert`——恢復兩列 manifest、三個測試、排除前綴與文件。因無狀態變更、無資料轉換，回滾無殘留。

**部署順序**：無跨裝置協調需求。各裝置下次 `git pull` 後執行 `npm run status`，應觀察到兩列消失、其餘列狀態不變。

## Open Questions

（無未決項）

**已解決**：

- `getFiles` 跳過逃逸 symlink 的純函式覆蓋確認存在（`boundary.test.js:611` 與 `isPathInside` 的五個測試），刪除三個整合測試無覆蓋缺口——見 D5。
- 其他裝置 `~/.claude/commands/` 的內容不影響本變更，且風險方向與原判讀相反——見 Risks 第一項。
