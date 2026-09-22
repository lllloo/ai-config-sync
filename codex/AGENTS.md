# 全域 Codex 指示

此檔案定義所有專案通用的全域規則與慣例。

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
- 長篇檢視輸出先限量，必要時再分段讀取；測試與驗證須保留退出碼及結果摘要，不得因截斷輸出而宣稱成功。

## Commands vs Skills

新增可重用的代理工作流程時，**一律建立 skill，不新增 slash command**；一般 shell 指令與專案 CLI 不受此限。Skill 遵循 [Agent Skills](https://agentskills.io) 開放標準，可跨工具移植。

## Superpowers 啟動

Superpowers 僅在下列任一情況啟動：

1. 我明確要求使用 Superpowers，或明確呼叫其 skill；
2. 專案根目錄已有 `docs/superpowers/`——代表該專案既有流程即為 Superpowers，但**每次仍須先問我要不要用**，我同意才啟動（問題夠簡單時常不需要）。

不得因 task 類型、skill 安裝狀態或你判斷可能適用而自行啟動。

符合啟動條件後，僅對適用的開發任務使用對應流程；一般問答與唯讀檢視不因此進入設計、規劃或實作流程。
