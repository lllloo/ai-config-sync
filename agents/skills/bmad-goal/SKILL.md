---
name: bmad-goal
description: '僅在明確呼叫時啟動——使用者輸入 `/bmad-goal`，或明講「用 bmad-goal」「跑 bmad-goal」才執行。就算使用者說「把這幾個 story 做完」「跑完 16-10」「create/dev/review 一路跑」，只要沒點名本 skill，一律不自動啟動、照一般方式回答。啟動後對使用者列出的 story 代號或整個 epic，依序不停跑完 bmad-create-story → bmad-dev-story → bmad-code-review 到 done。'
---

# BMad Goal

**目標**：使用者給一個或多個 story 代號，逐一跑完三段：`bmad-create-story` → `bmad-dev-story` → `bmad-code-review`，一路跑到 `done`，中途不停下來問人。

**授權宣告**：使用者啟動本 skill，就等於對這一整趟給了「改哪裡、怎麼改都不必逐次確認」的授權。全域記憶裡「所有修改都要先確認」這條，在本 skill 執行期間由這次啟動取代；不要中途又停下來問「可以改嗎」。

**路徑來源**：`{implementation_artifacts}` 等變數從 `{project-root}/_bmad/bmm/config.yaml` 讀，與三個子 skill 同一份設定；sprint-status 在 `{implementation_artifacts}/sprint-status.yaml`。

## 前置檢查（啟動後第一件事）

先確認當前專案是 BMad 專案，兩項都過才往下走：

1. **設定檔**：從 project root 找 `_bmad/bmm/config.yaml`。不存在 → **立刻停止**，回一句「此專案沒有 `_bmad/bmm/config.yaml`，不是 BMad 專案，bmad-goal 不適用」，然後結束。不問問題、不找替代路徑、不改用一般流程幫忙做 story。
2. **子 skill**：確認 `bmad-create-story`、`bmad-dev-story`、`bmad-code-review` 三支都在可用 skill 清單裡（它們通常是專案本地 skill，隨專案走）。缺任何一支 → 立刻停止，列出缺哪幾支。

兩項都通過才進入下面的流程。

## 輸入

- story 代號，可多個：`18-8`、`16.10`、`epic 16 story 11` 都接受。正規化成 sprint-status.yaml 的 key（如 `18-8-change-order-master`）。
- **只給 epic 號**（`16`、`epic 16`、`16 全部`）→ 從 sprint-status.yaml 撈出該 epic 底下所有狀態**不是 `done`** 的 story，依檔內順序排隊；開跑前先列出這份清單與各自目前狀態，再開始。已 `done` 的不回工。
- 沒給任何代號 → 停下來問，不自行從 sprint-status 猜。

## 開跑前唯一的一次提問

排好清單後、動手前，問使用者一次（用 AskUserQuestion，一次問完）：

1. **要不要用 worktree（wt）處理？** 在目前 checkout 直接做，還是開獨立 worktree。
2. 若選 worktree → **要不要獨立的 docker 環境？** (A) 不起 stack，只寫 code、lint／typecheck 用一次性容器；(B) 起獨立 stack 供驗證（本機 `wt-env up` 這類指令，依專案記憶）。這條分岔只有使用者知道，不自行決定。

問完之後整趟不再停。多個 story 共用同一個 worktree，依序做，不為每個 story 各開一個。

開跑前先確認工作樹乾淨（`git status --short` 為空）。有未提交變更就停下來報，不自行 stash 或 commit 別人的東西——髒工作樹會讓 code-review 的 diff 混進無關改動。

## 分支與 commit

- 從 `develop` 開一條**主分支**跑整趟：單一 story 用 `story/<story-key>`；多個 story 用 `goal/<epic 或簡述>`（如 `goal/epic-16`），所有 story 都在這條上依序做。
- 每個 story 收官（狀態轉 `done`）各自 commit，訊息沿用專案慣例（`feat(模組): Story X.Y【標題】…`）。
- **不合回 develop**、不 push 保護分支、不推 tag。收尾時列出主分支名與各 story 的 commit sha，合併由使用者自己做。

## 執行順序

多個 story **依序**跑，不平行（共用同一 repo 與 sprint-status，平行會互相踩）。前一個 story 三段跑完、狀態轉 `done` 才進下一個。

每個 story：

1. **看狀態**：讀 `{implementation_artifacts}/sprint-status.yaml` 該 key 的狀態，以及 story 檔是否存在。
2. **create-story**：狀態 `backlog` 或 story 檔不存在 → 用 Skill tool 呼叫 `bmad-create-story`，帶 story 代號。已 `ready-for-dev` 以後 → 略過並說明。
3. **dev-story**：用 Skill tool 呼叫 `bmad-dev-story`，帶 story 檔路徑。狀態已 `review` 以後 → 略過並說明。
4. **code-review**：用 Skill tool 呼叫 `bmad-code-review`，帶 story key；review 對象＝該 story 分支對 develop 的 diff 或未提交變更。依 triage 結果套 patch、跑 lint／test 到綠，狀態轉 `done`。

三段都要跑到；能省略的只有「已經完成」的段落。

## 檢查點：不停

三個子 skill 都有 HALT 等人確認的步驟。本 skill 啟動時使用者已經授權「全部跑完」，所以：

- 純「繼續？」類的檢查點直接視為 Y，往下走。
- 子 skill 問「要 review 哪個／哪個分支」這類選項時，用已知的 story 脈絡自行選定（story key、story 分支、develop 為 base）。
- 遇到不確定的事（AC 有多種解讀、實作與 spec 打架、要不要動共用元件）：**先查 spec**——story 檔、epics、page spec、project-context、既有 vue／程式碼。spec 講得清楚就照 spec 做，不停。
- 查完 spec 仍不確定 → 不猜、不停：選一個最保守的做法（不擴範圍、不動共用件、不刪欄位）繼續，並把問題寫進 `{implementation_artifacts}/deferred-work.md` 等使用者裁定。條目要寫清楚：story key、卡在哪、看過哪些 spec、目前採取的做法、要使用者裁什麼。

寫進 deferred-work 是「暫定後繼續」，不是「跳過」。code-review 的 defer 類 findings 也走同一個檔。

## 失敗處理

- 測試紅、lint 擋 → 修到綠再進下一段，不跳段。
- 修不掉（環境壞、缺依賴、子 skill 找不到 story）→ 該 story 在 deferred-work 記一條，狀態留在當前段，**繼續跑下一個 story**。收尾時明講。

## 收尾

每個 story 一行：key、跑了哪幾段、略過的段落與原因、最終狀態、commit sha、寫進 deferred-work 的條數。全部跑完再給總表。
