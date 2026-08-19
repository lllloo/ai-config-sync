# 全域 Claude Code 指示

此檔案定義所有專案通用的全域規則與慣例。

## 語言規範

**一律使用繁體中文**撰寫所有內容、註解、文件、溝通訊息與 commit 訊息。技術術語可保留英文。輸出 Markdown 文件時亦同。

**例外**：專案既有 commit 歷史為英文（如開源專案）時，commit 訊息跟隨專案慣例。

## 回應風格

精簡、直接切入重點——指**表達**精簡，不是**查證**精簡：不省略「先 Read／Grep／查證再下結論」的步驟。

事實宣稱（檔案內容、API、版本、數字）必須有依據；無依據時直說「不確定」並照標不確定性，不用簡潔換肯定語氣。

## 輸出呈現：一律寫成本地檔案

要給我看的頁面、圖表、報告**一律寫成本地檔案**——不呼叫 `Artifact` 工具、不發佈到 claude.ai。

要產出頁面、報告、圖表這類本地檔時，落點、可點連結、完整 HTML 寫法與設計品質見 `map` skill 的「產出成頁面」一節，屆時載入。

**本規則管的是「發佈動作」，不是產出物的存放位置或命名。** 專案自身用途的本地產物資料夾（CI 產物、建置輸出）照常寫入，不在此規則射程內。

**例外只有一種**：我明確說「用 Artifact」「發佈到 claude.ai」或「要能分享給別人」。單純說「要連結」（指產出物的連結）不是例外。

## Commit 與 Push

- **Commit 不設限制**：你可自主 commit，不需事先徵求同意。
- **Push 保護分支**：`main`、`master`、`develop`、`formal`、`release`（含 `release/*`）未經我明確要求**不得 push**；其他分支可自由 push。
- **force push 需明確要求**：任何分支皆同，不因是 feature branch 而放行；獲授權時**一律用 `--force-with-lease`**，不用裸 `--force`。
- **推 tag 視同 push 對外動作**：未經明確要求不推 tag。

## 檢視低污染慣例（git）

**操作慣例、不是守門**：檢視類指令的預設輸出是給人在終端捲動看的，全文灌進 context 多半是雜訊。一律先取「摘要級」，需要細節再按需單檔展開，不一次抓全庫。

git 檢視：

- 改了哪些檔：`git diff --stat` / `--name-only`，**不**裸跑 `git diff`；鎖定後才 `git diff -- <單檔>` 展開
- 提交歷史：`git log --oneline -20`，**不**裸跑 `git log`
- 目前狀態：`git status --short`；某次提交：`git show --stat <sha>`
- 任何仍可能很長的輸出：尾接 `| head -50`

## 打包規則

**需要打包時先問過我，獲准才跑**：

- `npm run build` / `yarn build` / `pnpm build`
- `npm run docs:build` 或類似構建命令

我明確指示「請打包」、「執行打包」時視同已同意，直接執行、不必再問。

## Commands vs Skills

**一律使用 skill**，不再新增 command——skill 遵循 [Agent Skills](https://agentskills.io) 開放標準，可跨工具移植。

## Superpowers 啟動

Superpowers 僅在下列任一情況啟動：

1. 我明確要求使用 Superpowers，或明確呼叫其 skill；
2. 專案根目錄已有 `docs/superpowers/`——代表該專案既有流程即為 Superpowers，後續 task 沿用。

不得因 task 類型、skill 安裝狀態或你判斷可能適用而自行啟動。
