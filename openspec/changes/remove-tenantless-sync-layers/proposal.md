## Why

`SYNC_MANIFEST` 有兩列同步項已無住戶，且依現行政策不會再有：`claude/commands`（全域 CLAUDE.md 已定調「一律使用 skill，不再新增 command」）與 `claude/skills`（住戶已於 `ab4a58d` 全數遷至 `agents/skills/` 跨工具層）。兩列在 `npm run status` 都印 `[✓] 一致`——但「一致」只是因為兩端皆空，讀者無從分辨「已同步」與「沒有東西可同步」。

代價不只是兩列雜訊：`claude/skills` 是 `agents/skills` 那條「`xtool-skills` 列 SHALL 排在 `claude` 區 `skills` dir 列之前」順序不變式存在的唯一理由，也是 `apply-integration.test.js` 三個共存測試（xtool 探索點 symlink 不被 claude mirror 誤刪／不被 `to-repo` 吸回）的唯一保護對象。這些防線保護的風險**只因兩層共存而存在**；移除該層，風險與守衛一併消失，屬淨簡化而非以安全換行數。

此外，「repo 端 `claude/skills/` 不得殘留空目錄」目前是一條**沒有寫在任何 live code 裡、只活在 archive**（`2026-07-15-cross-tool-global-skills/tasks.md` 4.1）的維護不變式——靠「一個目錄不存在」來保證安全，是應當收掉的狀態。

理由對稱於 `0f88d4c` 移除 agents 同步項時定下的「不做預防性保留」。

## What Changes

- **移除 `SYNC_MANIFEST` 的 `{ area: 'claude', label: 'commands', type: 'dir' }` 列**——政策已封死，repo 端無此目錄、本機 `~/.claude/commands/` 為空目錄。
- **移除 `SYNC_MANIFEST` 的 `{ area: 'claude', label: 'skills', type: 'dir' }` 列**，連帶移除 `agents` 區 `xtool-skills` 列上方的順序約束註解。
- **移除 `xtool-skills` 列的順序不變式**（spec 層的 SHALL 與 code 註解）。**dir→symlink 轉換需求本身保留**：該轉換內生於 `applyXtoolItem`，是為了服務「本機仍留有舊真實目錄」的裝置，與 claude mirror 是否存在無關；消失的只有「排在 claude skills dir 列之前」這個相對順序約束。
- **移除 `SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 的 `'claude/skills/'`**——排除前綴隨其目錄一併撤除（對稱於 `0f88d4c` 撤除 `claude/agents/`）。此為擴大掃描射程，方向上偏安全。
- **移除三個共存測試**（`apply-integration.test.js` 的「xtool + claude mirror 共存」「空 `claude/skills` 情境」「`to-repo` 不吸回探索點」）——其保護對象已不存在。
- **`dir` 型 fixture 改指 `claude/rules`**：`diff-integration.test.js` 與 `apply-integration.test.js` 目前拿 `claude/commands` 當泛用 `dir` 型 fixture（測的是 dir 型行為本身，非 commands）。移除後 `claude/rules` 是唯一存活的 `dir` 型項目，`dir` 型 diff／apply／部分失敗路徑的覆蓋率須維持不變。
- **順帶修正既有 spec drift**：`safety-check/spec.md` 仍列 `claude/agents/` 為排除前綴，但該前綴已於 `0f88d4c` 隨目錄移除。本次改寫同一句話，一併校正為與程式碼一致。
- 非破壞性：兩層本就無內容，使用者不會遺失任何同步中的檔案。**BREAKING** 不適用。

## Capabilities

### New Capabilities

（無——本次為移除型變更，不引入新能力）

### Modified Capabilities

- `cross-tool-skill-sync`：移除「`xtool-skills` 列 SHALL 排在 `claude` 區 `skills` dir 列之前」順序不變式與其空目錄情境 scenario；調整「跨工具 vs Claude-only」的區分需求（`claude/skills/` 層不再存在，全域 skill 一律經 `agents/skills/`）；`agents/skills/` 的 text-pattern 排除前綴需求改為不再參照 `claude/skills/`。
- `safety-check`：text 掃描排除前綴清單移除 `claude/skills/`，並校正既有 drift（`claude/agents/` 早已移除）。

## Impact

**程式碼**
- `sync.js`：`SYNC_MANIFEST` 移除兩列；移除 `xtool-skills` 列上方的順序約束註解。
- `safety-check.js`：`SAFETY_TEXT_SCAN_EXCLUDE_PREFIXES` 移除 `'claude/skills/'`。

**測試**（依修改守則，純函式異動須同步更新 unit test）
- `test/sync.test.js`：claude label 硬編碼 drift-guard 清單（移除 `'commands'`、`'skills'`）；`materializeSyncItem` 合成 entry 的 label 改用存活項目；README drift-guard 會因排除前綴變更自動要求 README 跟進。
- `test/diff-integration.test.js`：dir 型 fixture 改指 `claude/rules`。
- `test/apply-integration.test.js`：dir 型部分失敗 fixture 改指 `claude/rules`；移除三個共存測試。

**文件**（依修改守則，README 須同步更新）
- `README.md`：同步項目表移除 commands 列；排除前綴清單更新（有 drift-guard 把關）。
- `CLAUDE.md`：目錄命名段（`claude/` 說明不再列 commands、不再宣稱 Claude-only skill 放 `claude/skills/`）；同步項目表移除兩列；Skills 管理三層表收斂為兩層（全域·跨工具、本地）；`SYNC_MANIFEST` 順序不變式敘述移除。

**不受影響**
- `declarative-sync-manifest`：只規範 manifest 機制、不列舉內容，移除列不改其需求。
- `xtool-skills` 型的 diff／apply 邏輯、非 prune 共管語意、撞名判準：全數不動。
- `dir` 型別本身保留（`claude/rules` 仍是住戶）。
