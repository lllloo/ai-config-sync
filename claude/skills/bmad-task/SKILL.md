---
name: bmad-task
description: 為單一 BMAD story 建立三個依序任務並逐階段執行：bmad-create-story → bmad-dev-story → bmad-code-review。每階段完成後暫停等使用者確認，code-review 只列出發現、不自動修。僅由使用者輸入 /bmad-task 明確呼叫，不自動觸發。
disable-model-invocation: true
---

# BMAD Story 三階段流水線

為指定的 story 編號依序執行 BMAD 的三個階段（建立 story 檔 → 實作 → 審查），並以 task 清單追蹤進度。整個流程的核心精神：**一次只推進一個階段，階段之間交還控制權給使用者**——story 檔可能要人工調整、實作結果可能要先驗收，流水線不該替使用者做這些判斷。

## 前置檢查

1. **確認 BMAD 已安裝**：available skills 清單中必須同時存在 `bmad-create-story`、`bmad-dev-story`、`bmad-code-review`。缺任何一個就中止，告知使用者此專案未安裝 BMAD（或安裝版本不含該 workflow），不要用自己的理解模擬 BMAD 流程替代。
2. **確認 story 編號**：使用者若已在指令中帶了編號（如 `/bmad-task 3-2`）直接採用；沒有就先問「這次要跑的 story 編號是？」，拿到編號再繼續。編號格式依專案慣例（`3`、`2-1`、`epic2-story3` 等），原樣使用、不要改寫。

## 建立任務

用 TaskCreate 建立三個 task，標題都帶上 story 編號，並以依賴關係串成固定順序（後一個依賴前一個）：

1. `create-story: story {編號}`
2. `dev-story: story {編號}`
3. `code-review: story {編號}`

若目前環境沒有 task 工具，改用內建 todo 清單追蹤，行為不變。

## 逐階段執行（每階段結束都要停）

每個階段的節奏相同：把對應 task 標為 in_progress → 用 Skill tool 呼叫該階段的 bmad skill → 完成後標為 completed → 回報產物 → **停下來等使用者確認**，使用者同意後才進下一階段。不要一口氣跑完三個階段。

| 階段 | 呼叫 | 完成後回報 |
|------|------|-----------|
| 1 | `bmad-create-story`（帶 story 編號） | story 檔路徑與內容摘要 |
| 2 | `bmad-dev-story`（帶 story 編號） | 變更的檔案清單與測試結果 |
| 3 | `bmad-code-review`（帶 story 編號） | review 發現清單 |

階段 3 完成後**只列出發現，不自動修復**。修不修、怎麼修由使用者決定；使用者明確要求修復時，那是新的指示，屆時再動手。

## 中止與失敗

- 任一階段失敗：對應 task 保持原狀態，回報失敗原因與已完成的部分，不自動重試、不跳過該階段續跑後面的。
- 使用者中途喊停：停在當下，保留 task 清單現狀，讓使用者之後可以從中斷的階段接續。
