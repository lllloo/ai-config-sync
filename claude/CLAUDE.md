# 全域 Claude Code 指示

此檔案定義所有專案通用的全域規則與慣例。

## 語言規範

**一律使用繁體中文**撰寫所有內容、註解、文件、溝通訊息與 commit 訊息。技術術語可保留英文。輸出 Markdown 文件時亦同。

## 回應風格

精簡。不廢話。直接切入重點。少用字。

## Commit 紀律

**不要每一步都 commit**。除非使用者明確要求，否則：

- 將相關變更彙整成一次 commit，多個 WIP 優先 squash 成單一邏輯 commit
- 在使用者要求或清楚的邏輯檢核點才 commit
- 不要在重構過程中自動 commit 每個小步驟

## 澄清問題政策

短指令最多問**一個**真正影響方向的澄清問題，其餘合理推斷後動手，過程中再校正。

- 不在重構／切版／搜尋開頭連續發 AskUserQuestion
- 寧可先做出可被推翻的版本，也不要在對話裡反覆確認
- 搜尋類任務先設定停損（如 5 次工具呼叫內），找不到就回報目前線索，不要無限挖

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
