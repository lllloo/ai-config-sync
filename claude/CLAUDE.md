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

**本規則管的是「發佈動作」，不是產出物的存放位置或命名。** 專案自身用途的本地產物資料夾（CI 產物、建置輸出）照常寫入，不在此規則射程內。

**例外只有一種**：我明確說「用 Artifact」「發佈到 claude.ai」或「要能分享給別人」。單純說「要連結」（指產出物的連結）不是例外。

### 落點與寫法

適用於頁面、報告、圖表、分析結果等所有要寫成本地檔的產物。

**落點**：判準是會不會進版控。一次性、看完就丟的一律寫 scratchpad，不落進專案；只有使用者明說要留進 git 的，才寫進當前專案的 `docs/architecture/`（沒有就建），並說明放在哪。不要自己判斷值得保留就寫進專案。`docs/architecture/` 內容進版控、可 commit，不加進 `.gitignore`。**收的是描述專案現況的文件**（架構圖與配套文字）；判準是內容性質而非誰產出的，人寫或 AI 產都放這裡，不另開一份。動工前的設計提案／RFC 不屬於此（那是計畫、不是現況），要留另開 `docs/design/`。`artifacts/` 與 `docs/ai/` 是**舊落點**：新產出一律不寫進去；專案裡既有的這兩個資料夾若存放先前產出的 AI 頁面，一律搬到 `docs/architecture/`（有版控用 `git mv` 保留歷史）並告知使用者，不必再問。CI 產物、建置輸出等專案自身用途的同名資料夾不算，不動也不搬。

**檔名一律純 ASCII**（小寫英數與 `-`）：檔名含中文會讓連結打不開，說明性文字留在回覆裡、不進檔名。

**短內容不必開檔**：表格、程式碼、清單直接輸出終端；單純的一對一來源／目的地對應改用表格。示意圖不在此列，一律產成頁面。

### 開啟與給連結

#### 預設：直接開，不起 server

寫完檔案就用系統預設瀏覽器開：

- WSL：`wslview <絕對路徑>`
- 其他 Linux：`xdg-open`｜macOS：`open`

⛔ **不要為了「給連結」而起 `python3 -m http.server` 之類的靜態伺服器。** 多數說明頁、報告、圖表是單一 HTML、樣式內嵌，`file://` 直接開就正常；起 server 只是在檔案與瀏覽器之間多塞一個中間人。

#### 只有三種情況才需要 server

- 頁面要 `fetch()`／`XMLHttpRequest` 讀同目錄的檔（如 `data.json`）
- 用了 `<script type="module">`
- 需要 origin：cookie、登入態、`localStorage`／`IndexedDB` 隔離

三條都不中就不要起。**先確認頁面實際用了什麼，不要憑「反正 server 比較保險」就起。**

真的要起時：

- **綁 `127.0.0.1`，⛔ 不用 `0.0.0.0`** —— 後者等於把該目錄對同網段全開
- 挑一個沒人用的 port，起之前先確認
- **同一則回覆就附上關閉指令**，並在任務結束時主動提醒還開著

#### 給連結：要可點，也要夠短

給路徑不等於給連結。WSL 的 Linux 路徑 Windows 開不了，要先轉：

```
wslpath -w <路徑>        # → \\wsl.localhost\<Distro>\...
```

再把反斜線換成正斜線、前面加 `file://`，即為可點 URL。

**長度也是需求的一部分。** 終端機會裁斷過長的連結 —— 含 session UUID 的暫存目錄動輒 150+ 字元。這種情況把檔案複製到短路徑（如 `/tmp/<短名>/`），或放 `/mnt/c/...`（Windows C 槽，URL 形如 `file:///C:/tmp/x.html`，最短）。原檔留在原處，複本只是為了連結。

附連結時同時給**純文字版**，方便複製。

#### 驗證

- 確認 server 是否關閉：**看 `ss -ltn | grep <port>`**
- ⛔ **不要用 `pgrep -af "http.server"` 判定** —— pattern 會命中自己那條 shell 指令字串，得到「還有殘留」的假陽性

## Commit 與 Push

- **Commit 不設限制**：你可自主 commit，不需事先徵求同意。
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

## Commands vs Skills

**一律使用 skill**，不再新增 command——skill 遵循 [Agent Skills](https://agentskills.io) 開放標準，可跨工具移植。

## Superpowers 啟動

Superpowers 僅在下列任一情況啟動：

1. 我明確要求使用 Superpowers，或明確呼叫其 skill；
2. 專案根目錄已有 `docs/superpowers/`——代表該專案既有流程即為 Superpowers，但**每次仍須先問我要不要用**，我同意才啟動（問題夠簡單時常不需要）。

不得因 task 類型、skill 安裝狀態或你判斷可能適用而自行啟動。
