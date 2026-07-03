---
name: bmad-task
description: 為單一 BMAD story 依序跑三階段（bmad-create-story → bmad-dev-story → bmad-code-review），每階段委派給一個全新 context 的 subagent 執行，主線只做協調、階段之間停下等使用者確認。code-review 只列發現、不自動修。僅由使用者輸入 /bmad-task 明確呼叫，不自動觸發。
disable-model-invocation: true
---

# BMAD Story 三階段流水線（協調器版）

為指定的 story 編號依序跑 BMAD 的三個階段（建立 story 檔 → 實作 → 審查）。你（讀到這份 skill 的主線）是**協調器 A**：自己不讀檔、不寫碼、不模擬 BMAD，把每一個階段整包委派給一個**全新 context 的 subagent** 去跑，只把摘要收回來。

## 協調器鐵則

- **A 不親自幹活**：不自己讀 story／原始碼、不自己實作、不自己模擬 BMAD workflow。每個階段都用 Agent tool 派一個 subagent 去跑。這讓 A 的 context 保持精瘦——正因為 A 不累積各階段的重內容，跨階段時「要停下等確認」這條指示才不會被稀釋。
- **一次只派一個階段**：派出該階段的 subagent → 等它回報 → 把摘要轉述給使用者 → **停下等使用者確認** → 使用者同意後才派下一階段。不要連續派兩個階段。
- **subagent 同步執行**：以 `run_in_background: false` 派發，等它回報再繼續，不要在它還沒回來就往下走。

## 前置檢查

1. **確認 BMAD 已安裝**：available skills 清單中必須同時存在 `bmad-create-story`、`bmad-dev-story`、`bmad-code-review`。缺任何一個就中止，告知使用者此專案未安裝 BMAD（或版本不含該 workflow），不要用自己的理解模擬 BMAD 流程替代。
2. **確認 story 編號**：使用者若已在指令中帶了編號（如 `/bmad-task 3-2`）直接採用；沒有就先問「這次要跑的 story 編號是？」，拿到再繼續。編號格式依專案慣例（`3`、`2-1`、`epic2-story3` 等），原樣使用、不改寫。

## 進度帳本

用 TaskCreate 建三個 task，標題帶 story 編號，以依賴關係串成固定順序（後一個依賴前一個）：

1. `create-story: story {編號}`
2. `dev-story: story {編號}`
3. `code-review: story {編號}`

這是**進度指標**，不是「一次清光的待辦」——task 還有未完成項目，不是繼續派下一階段的理由；唯一的推進訊號是使用者的確認。若環境沒有 task 工具，改用內建 todo 清單，行為不變。

## 逐階段委派

每個階段節奏相同：對應 task 標 in_progress → 用 **Agent tool** 派一個 `general-purpose` subagent（需具備 Skill、Read/Write/Edit/Bash 工具）→ subagent 回報後把 task 標 completed → 轉述摘要 → **停下等使用者確認**。

給各階段 subagent 的指示（**必須自包含**，subagent 不會讀到這份 skill）：

| 階段 | 派給 subagent 的指示 | 回收 |
|------|---------------------|------|
| 1 create-story | 「你在一個獨立 context 裡只跑一個 BMAD workflow。用 Skill tool 呼叫 `bmad-create-story`（story 編號 {編號}）跑到完成，不要用自己的理解模擬 BMAD。完成後只回傳：story 檔路徑 + 內容重點摘要。除此之外什麼都別做。若 Skill tool 裡沒有這個 skill、無法呼叫，直接回報『無法呼叫 bmad-create-story』。」 | story 檔路徑、摘要 |
| 2 dev-story | 「你在一個獨立 context 裡只跑一個 BMAD workflow。用 Skill tool 呼叫 `bmad-dev-story`（story 編號 {編號}）跑到完成。過程中**自主做合理的實作決定、不要停下來等使用者輸入**（你無法與使用者對話）。完成後回傳：變更的檔案清單、測試結果、以及任何你替使用者做了、需要對方事後拍板的關鍵決定或待確認問題。若無法呼叫 bmad-dev-story，直接回報。」 | 變更檔案、測試結果、待拍板決定 |
| 3 code-review | 「你在一個獨立 context 裡只跑一個 BMAD workflow。用 Skill tool 呼叫 `bmad-code-review`（story 編號 {編號}）。**只做審查、產出發現清單，不要修改任何程式碼**。完成後回傳發現清單。若無法呼叫 bmad-code-review，直接回報。」 | review 發現清單 |

**dev-story 是自主跑的**：C 不與使用者互動，人審移到階段邊界——A 收到 C 的回報後停下，把「C 替你做的關鍵決定／待確認問題」一起攤給使用者看，由使用者決定要不要回頭調整。

**階段 3 只列發現、不自動修**：修不修、怎麼修由使用者決定；使用者明確要求修復時那是新的指示，屆時再派 subagent 或直接處理。

## Fallback：subagent 無法呼叫 bmad skill

若某階段 subagent 回報「無法呼叫 bmad-<phase>」（子 agent 環境沒帶 Skill tool 或看不到專案 skill），A 改在主線直接用 Skill tool 呼叫該階段的 bmad skill 跑完，其餘協調節奏（標 task、回報、停下等確認）不變。

## 中止與失敗

- 任一階段失敗：對應 task 保持原狀態，回報失敗原因與已完成的部分，不自動重試、不跳過該階段續跑後面的。
- 使用者中途喊停：停在當下，保留 task 清單現狀，讓使用者之後可從中斷的階段接續。
