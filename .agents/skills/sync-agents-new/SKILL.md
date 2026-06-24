---
name: sync-agents-new
description: 檢查上游 agent 來源（everything-claude-code）是否有尚未安裝的新 agent。觸發時機：使用者詢問「有沒有新 agent」「推薦什麼 agent」「上游有哪些 agent 沒裝」「agents-new」等語意時使用。
---

比對本機已安裝 agent 與上游來源，找出未安裝且對**使用者技術棧**有價值的 agent。

> 唯一上游為 `affaan-m/everything-claude-code`；原補充來源 `VoltAgent/awesome-claude-code-subagents` 已下架，本 skill 不再掃描。

## 使用者背景

讀同目錄 `profile.md` 取得使用者技術棧與優先序，作為後續過濾與排序依據。

- `profile.md` 為個人資料、已 gitignore（不進版控）。
- **缺檔時不降級、不硬編**：請使用者先建立 `profile.md`（可參考下方欄位）後再執行，不要自行假設技術棧。
- profile 結構：主力領域與優先技術、次要領域、通用技能；過濾「相關／略過」與排序皆以此為準。

## 步驟

1. **列出已安裝**（repo 與本機 `~/.claude/agents/` 都要查）：

   ```
   # repo 端（同步來源）
   ls claude/agents/everything-claude-code/

   # 本機端（實際生效的 agent，可能多於 repo）
   ls ~/.claude/agents/
   ls ~/.claude/agents/everything-claude-code/ 2>/dev/null
   ```

   **避免重複推薦規則**：只要任一位置存在同名 `<name>.md` 即視為「已安裝」，不再列入推薦。判定範圍涵蓋：

   - repo：`claude/agents/everything-claude-code/`
   - 本機：`~/.claude/agents/` 根目錄散檔（如 `vault-query.md`）以及其下所有 package 子目錄

2. **抓上游清單**（用 `gh`，不要用 WebFetch）：

   ```
   gh api repos/affaan-m/everything-claude-code/contents/agents --jq '.[].name'
   ```

   **過濾雜訊**：上游目錄下會混入非 agent 檔案，一律跳過：
   - `.claude-plugin`（目錄標記）
   - `README.md`
   - 任何非 `.md` 結尾的項目

   可改用 jq 一次過濾：`--jq '.[] | select(.name | endswith(".md")) | select(.name != "README.md") | .name'`

3. **分類輸出**：

   - **推薦安裝**：契合 `profile.md` 所列技術棧與日常工作的 agent
     - **主推薦最多 3 個**，附一行用途說明
     - 其餘未跳過的 agent 壓到尾端的「其他相關：`name1`、`name2`、...」單行 digest（僅列名稱，無說明），由使用者自行深究
     - 🔥 新增項目不受 3 個上限限制（永遠列為主推薦）
   - **略過**（以下兩類直接跳過，**不進入待定**）：
     - 與 `profile.md` 技術棧無關者（profile 未涵蓋的程式語言／框架、區塊鏈／遊戲／ML 訓練等）
     - 與已安裝 agent 名稱或用途明顯重疊者，例如：
       - `refactoring-specialist` vs 已安裝的 `refactor-cleaner`
       - `security-auditor` vs `security-reviewer`
       - `performance-engineer` vs `performance-optimizer`
       - `documentation-engineer` vs `doc-updater`
   - **待定**：僅列「用途可能相關但不確定」者（例如名字無法判斷功能、描述需再確認），簡述後交由使用者判斷。待定清單應維持精簡，避免佔版面

4. **安裝指令提示**（不自動執行，等使用者確認）：詳見專案根目錄 `CLAUDE.md` 的「Agents 管理」章節。

## 輸出格式

精簡條列，每個推薦 agent 一行說明用途。不要長篇解釋，使用者會決定要裝哪些。

```
## 來源：everything-claude-code
- <name> — 一行用途說明
- ...

其他相關：<name1>、<name2>、...
```

**加分規則**：
- 若 agent 檔案在上游 repo 最近 3 週內**首次新增**（非修改），加 🔥 標記並提升優先順序
- **基準日期動態計算**：先用獨立 Bash 呼叫取得當前日期，再減 21 天得到 ISO 格式的 `since` 參數（例如 `date -v-21d +%Y-%m-%dT%H:%M:%SZ`，Windows Git Bash 可用 `date -d '21 days ago' --iso-8601=seconds`），**禁止硬編日期**
- **🔥 檔案級精確判定**（不靠 commit message 猜）：
  1. 取得 `since` 日期後 path 內的所有 commit SHA：
     ```
     gh api "repos/<owner>/<repo>/commits?path=<path>&since=<iso-date>&per_page=100" --jq '.[].sha'
     ```
  2. 對每個 SHA 展開檔案變動，收集 `status=added` 的 `.md`（可併行呼叫以加速）：
     ```
     gh api "repos/<owner>/<repo>/commits/<sha>" --jq '.files[] | select(.status=="added") | select(.filename | endswith(".md")) | .filename'
     ```
  3. 取「新增檔名集合」∩「未安裝候選集合」→ 🔥 最終名單
  - **Windows Git Bash 注意**：`gh api` endpoint **不可有前導 `/`**，否則會被 shell 重寫成 `C:/Program Files/Git/...` 檔案路徑而 invalid。上例已用 `repos/...` 無前導斜線格式
- 先列 🔥 新增的，再列非新增的
