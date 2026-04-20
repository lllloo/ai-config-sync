---
description: 檢查上游 agent 來源是否有新推薦可安裝
---

比對本機已安裝 agent 與上游兩個來源，找出未安裝且對**前端工程師**有價值的 agent。

## 使用者背景

前端工程師（主力），技術棧：Vue 3 / TypeScript / Node.js / 跨平台 CLI。兼職後端 PHP / Laravel / Node。優先推薦：

**前端（主）：**
- 前端框架與語言（Vue、React、TS、JS）
- UI / UX / 視覺設計 / 無障礙（a11y）
- 前端效能、bundle 體積、渲染優化
- E2E / 單元測試、瀏覽器自動化
- CSS、設計系統、元件庫
- 前端工具鏈（Vite、Webpack、ESLint）

**後端（副）：**
- PHP / Laravel
- Node.js（Express、NestJS、Fastify 等）
- API 設計、資料庫、認證、queue

**通用：**
- code review、重構、文件、git 流程
- 安全性、效能、測試、DevOps 基礎

## 步驟

1. **列出已安裝**（repo 與本機 `~/.claude/agents/` 都要查）：

   ```
   # repo 端（同步來源）
   ls claude/agents/everything-claude-code/
   ls claude/agents/awesome-claude-code-subagents/

   # 本機端（實際生效的 agent，可能多於 repo）
   ls ~/.claude/agents/
   ls ~/.claude/agents/everything-claude-code/ 2>/dev/null
   ls ~/.claude/agents/awesome-claude-code-subagents/ 2>/dev/null
   ```

   **去重規則**：只要 repo 或本機其中一方已存在（同名 `<name>.md`），就視為「已安裝」，**不再列入推薦**。推薦清單必須是兩邊皆無的 agent。

2. **抓上游清單**（用 `gh`，不要用 WebFetch）：

   ```
   gh api repos/affaan-m/everything-claude-code/contents/agents --jq '.[].name'
   gh api repos/VoltAgent/awesome-claude-code-subagents/contents/categories --jq '.[].name'
   ```

   `awesome-claude-code-subagents` 第二層要再抓一次：

   ```
   gh api "repos/VoltAgent/awesome-claude-code-subagents/contents/categories/<category>" --jq '.[].name'
   ```

   可併行呼叫多個分類以加速。

3. **分類輸出**：

   - **推薦安裝**：契合前端工程師日常工作（見上方清單）的 agent
   - **略過**：依上方「使用者背景」判斷，與 Vue/TS/JS/Node/PHP/Laravel 技術棧無關者直接跳過（包含其他程式語言、非 PHP/Node 後端框架、特定領域如區塊鏈／遊戲／ML 訓練等）
   - **待定**：功能重疊或用途不明者，簡述後交由使用者判斷

4. **安裝指令提示**（不自動執行，等使用者確認）：詳見專案根目錄 `CLAUDE.md` 的「Agents 管理」章節。

## 輸出格式

精簡條列，每個推薦 agent 一行說明用途。不要長篇解釋，使用者會決定要裝哪些。

**必須按來源分類輸出**，分兩大區塊：

```
## 來源 A：everything-claude-code
- <name> — 一行用途說明
- ...

## 來源 B：awesome-claude-code-subagents
### <category 名稱，如 01-core-development>
- <name> — 一行用途說明
- ...
### <category>
- ...
```

**加分規則**：
- 若 agent 在上游 repo 最近 3 週內新增，加 🔥 標記並提升優先順序
- **基準日期動態計算**：先用獨立 Bash 呼叫取得當前日期，再減 21 天得到 ISO 格式的 `since` 參數（例如 `date -v-21d +%Y-%m-%dT%H:%M:%SZ`，Windows Git Bash 可用 `date -d '21 days ago' --iso-8601=seconds`），**禁止硬編日期**
- 查詢：`gh api "repos/<owner>/<repo>/commits?path=<path>&since=<iso-date>&per_page=30"`
- 每個區塊內先列 🔥 新增的，再列非新增的
