# 全域 opencode 指示

此檔案定義所有專案通用的全域規則與慣例。

## 語言規範

**一律使用繁體中文**撰寫所有內容、註解、文件、溝通訊息與 commit 訊息。技術術語可保留英文。輸出 Markdown 文件時亦同。

**例外**：專案既有 commit 歷史為英文（如開源專案）時，commit 訊息跟隨專案慣例。

## 回應風格

精簡、直接切入重點——指**表達**精簡，不是**查證**精簡。

- 溝通用字精簡，但不省略「先 Read／Grep／查證再下結論」的步驟
- 事實宣稱（檔案內容、API、版本、數字）必須有依據；無依據時直說「不確定」，不用簡潔換取肯定語氣
- 精簡 ≠ 省略不確定性標註；該標的照標

## Commit 與 Push

- **Commit 不設限制**：agent 可自主 commit，不需事先徵求同意。
- **Push 保護分支**：`main`、`master`、`develop`、`formal`、`release`（含 `release/*`）未經使用者明確要求**不得 push**；其他分支可自由 push。
- **force push 需明確要求**：任何分支皆同，不因是 feature branch 而放行；獲授權時**一律用 `--force-with-lease`**，不用裸 `--force`。
- **推 tag 視同 push 對外動作**：未經明確要求不推 tag。

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
