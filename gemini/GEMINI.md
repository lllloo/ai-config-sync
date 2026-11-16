# 全域 Antigravity 指示

此檔案定義所有專案通用的 Antigravity 全域規則與慣例。

## 語言規範

**溝通一律使用繁體中文**；新增或修改文件、註解與 commit 訊息時，若專案已有明確語言慣例則沿用，否則使用繁體中文。技術術語、識別字、API 欄位及引用原文保留原樣。

## 回應風格

精簡、直接切入重點——指**表達**精簡，不是**查證**精簡：不省略「先 Read／Grep／查證再下結論」的步驟。

事實宣稱（檔案內容、API、版本、數字）必須有依據；無依據時直說「不確定」並照標不確定性，不用簡潔換肯定語氣。

## Commit 與 Push

- **Commit 不設限制**：你可自主 commit，不需事先徵求同意。僅提交本次任務相關變更，不夾帶使用者既有或其他任務的修改。
- **Push 保護分支**：`main`、`master`、`develop`、`formal`、`release`（含 `release/*`）未經我明確要求**不得 push**；其他分支可自由 push。
- **force push 需明確要求**：任何分支皆同，不因是 feature branch 而放行；獲授權時**一律用 `--force-with-lease`**，不用裸 `--force`。
- **推 tag 視同 push 對外動作**：未經明確要求不推 tag。

## Worktree

- **開 worktree 前先問我要不要獨立執行環境**（docker stack 等），不自行決定。只寫 code 不需要；要跑測試或實測才需要。
- worktree 做完**不自動 merge／rebase**：回報摘要，等我裁定；合併、push、收 stack 各自徵詢。

## 檢視低污染慣例（git）

**操作慣例、不是守門**：檢視類指令的預設輸出是給人在終端捲動看的，全文灌進 context 多半是雜訊。一律先取「摘要級」，需要細節再按需單檔展開，不一次抓全庫。

git 檢視：

- 改了哪些檔：`git diff --stat` / `--name-only`，**不**裸跑 `git diff`；鎖定後才 `git diff -- <單檔>` 展開
- 提交歷史：`git log --oneline -20`，**不**裸跑 `git log`
- 目前狀態：`git status --short`；某次提交：`git show --stat <sha>`
- 任何仍可能很長的輸出：尾接 `| head -50`
