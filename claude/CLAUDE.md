# 全域 Claude Code 指示

此檔案定義所有專案通用的全域規則與慣例。

## 語言規範

**一律使用繁體中文**撰寫所有內容、註解、文件、溝通訊息與 commit 訊息。技術術語可保留英文。輸出 Markdown 文件時亦同。

**例外**：專案既有 commit 歷史為英文（如開源專案）時，commit 訊息跟隨專案慣例。

## 回應風格

精簡、直接切入重點——指**表達**精簡，不是**查證**精簡。

- 溝通用字精簡，但不省略「先 Read／Grep／查證再下結論」的步驟
- 事實宣稱（檔案內容、API、版本、數字）必須有依據；無依據時直說「不確定」，不用簡潔換取肯定語氣
- 精簡 ≠ 省略不確定性標註；該標的照標

## 輸出呈現：預設不用 Artifact

要給我看的頁面、圖表、報告**一律寫成本地檔案**，不生成 Artifact（不發佈到 claude.ai）。

- 落點：一次性產物寫 scratchpad 目錄；要保留的寫進當前專案的 `./artifacts/`（沒有就建），並說明放哪。
- **產生頁面就主動附上可點連結，不必等我開口要。** WSL 檔案給 `file://wsl.localhost/<distro>/<絕對路徑>`（distro 取 `$WSL_DISTRO_NAME`，正斜線）。**終端不對它上色是正常的，照樣點得動，不要因此改用別的做法。** 唯一例外：頁面非 HTTP 來源不能運作（CORS 等）才背景起 `python3 -m http.server <port> --bind 127.0.0.1`，任務結束時關掉。純路徑與 `wslview` 只當備援。
- **寫成可獨立開啟的完整 HTML**：`<!doctype html>`、`<html lang="zh-Hant">`、`<head>` 內含 `<meta charset="utf-8">` 與 viewport，reset 自己帶。Artifact 那種「只寫內容片段、由平台包 head」的寫法直接開會變中文亂碼。
- **設計品質比照 Artifact 標準**：需要校準時載入 `artifact-design` skill，內容幾乎全數適用本地檔。**兩處例外**：字型 inline 成 data URI 的結論不變（理由改為離線可開、單檔可搬）；深色模式只需 `prefers-color-scheme`，`data-theme` 是 Artifact viewer 專有，要手動切換得自己寫按鈕。
- **示意圖比照 Artifact 標準**：要畫架構圖、資料流、狀態機、前後對比時載入 `artifact-diagramming` skill，其 HTML lane **全數適用本地檔、無例外**——手寫 inline SVG、零 runtime，不要因為不是 Artifact 就改用繪圖函式庫、CDN 或外部圖片。
- 短內容（表格、程式碼、清單、三五個框的示意圖）直接輸出在終端，不必為此開檔；圖複雜到 ASCII 排不動、或本來就要產出頁面時，才走上一條的 inline SVG。
- **例外只有一種**：我明確說「用 Artifact」「發佈到 claude.ai」或「要能分享給別人」。單純「要連結」不是例外。

## Commit 與 Push

- **Commit 不設限制**：agent 可自主 commit，不需事先徵求同意。
- **Push 保護分支**：`main`、`master`、`develop`、`formal`、`release`（含 `release/*`）未經使用者明確要求**不得 push**；其他分支可自由 push。
- **force push 需明確要求**：任何分支皆同，不因是 feature branch 而放行；獲授權時**一律用 `--force-with-lease`**，不用裸 `--force`。
- **推 tag 視同 push 對外動作**：未經明確要求不推 tag。

## 檢視低污染慣例（git 與內建搜尋）

**操作慣例、不是守門**：檢視類指令的預設輸出是給人在終端捲動看的，全文灌進 context 多半是雜訊。一律先取「摘要級」，需要細節再按需單檔展開，不一次抓全庫。核心是**兩步走：先定位、再展開**。

git 檢視：

- 改了哪些檔：`git diff --stat` / `--name-only`，**不**裸跑 `git diff`
- 提交歷史：`git log --oneline -20`，**不**裸跑 `git log`
- 目前狀態：`git status --short`；某次提交：`git show --stat <sha>`
- 任何仍可能很長的輸出：尾接 `| head -50`
- 分兩步：先看 stat/name 層鎖定目標檔，再 `git diff -- <單檔>` 展開內容

內建搜尋（Grep／Read／Glob 不走 shell，git 那套壓不到，同原則另走）：

- **Grep** 先 `output_mode: files_with_matches` 或 `count` 定位命中在哪，鎖定後才對單檔取 `content`；長結果加 `head_limit` 截斷，別預設 content 全抓
- **Read** 大檔用 `offset`／`limit` 只讀需要的行段，不整檔吞
- **Glob** 先縮小清單再讀，不對一堆檔盲讀

**全庫級檢視丟 subagent 隔離**：`git diff --stat` 仍過大（如整個 branch review）、或要掃全庫時，把「讀全文、只回摘要／findings」丟給 subagent，raw 內容留在它的 context、不污染主線。

## 構建與打包規則

**預設禁止執行打包命令** — 除非明確要求，否則不執行：

- `npm run build` / `yarn build` / `pnpm build`
- `npm run docs:build` 或類似構建命令

**例外**：只有在明確指示「請打包」、「執行打包」時才可執行。

## Commands vs Skills

**一律使用 skill**，不再新增 command。

Skills 是 commands 的超集，同時遵循 [Agent Skills](https://agentskills.io) 開放標準——可直接移植到 Cursor、Gemini CLI、Codex、GitHub Copilot 等其他 AI 工具。

## README.md 規範

所有軟體專案**必須撰寫 `README.md`**，最低需包含：專案說明、安裝方式、常用指令。

## Superpowers 啟動

Superpowers 僅在下列任一情況啟動：

1. 使用者明確要求使用 Superpowers，或明確呼叫其 skill；
2. 專案根目錄已有 `docs/superpowers/`——代表該專案既有流程即為 Superpowers，後續 task 沿用。

不得因 task 類型、skill 安裝狀態或模型判斷可能適用而自行啟動。
