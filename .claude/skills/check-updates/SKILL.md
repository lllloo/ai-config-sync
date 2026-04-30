---
name: check-updates
description: 比對本機已安裝的 agents（everything-claude-code、awesome-claude-code-subagents）與 skills（skills-lock.json）和上游來源，找出有更新但尚未同步的項目。觸發時機：使用者詢問「有沒有更新」「agents/skills 有沒有落後」「check-updates」「上游有沒有新版」等語意時使用。
---

比對本機檔案與上游來源，找出**已安裝但有更新**的 agents / skills。與 `agents-new` skill 分工：那個找「沒裝過但值得裝的」，這個找「裝了但落後的」。

## 檢查範圍

| 類別 | 本機位置 | 上游 |
|---|---|---|
| agents（everything） | `claude/agents/everything-claude-code/*.md` | `affaan-m/everything-claude-code` (`agents/`) |
| agents（awesome） | `claude/agents/awesome-claude-code-subagents/*.md` | `VoltAgent/awesome-claude-code-subagents` (`categories/**/`) |
| skills | `skills-lock.json` 各項 `source` | 各自上游 repo |

`claude/skills/pen-design/`、`claude/commands/*.md`、`claude/CLAUDE.md`、`claude/settings.json` 為自維護內容，**不檢查**。

## 步驟

### 1. 抓上游 tree（每 repo 一次 API call，可併行）

```bash
gh api "repos/affaan-m/everything-claude-code/git/trees/main?recursive=1" \
  --jq '.tree[] | select(.type == "blob" and (.path | startswith("agents/") and endswith(".md"))) | "\(.path)\t\(.sha)"'

gh api "repos/VoltAgent/awesome-claude-code-subagents/git/trees/main?recursive=1" \
  --jq '.tree[] | select(.type == "blob" and (.path | startswith("categories/") and endswith(".md"))) | "\(.path)\t\(.sha)"'
```

產出 `<upstream-path>\t<blob-sha>` 兩張表。

### 2. 計算本機 blob SHA

```bash
# everything-claude-code
for f in claude/agents/everything-claude-code/*.md; do
  git hash-object "$f"
done

# awesome-claude-code-subagents（已扁平化）
for f in claude/agents/awesome-claude-code-subagents/*.md; do
  git hash-object "$f"
done
```

`git hash-object` 算出的是 git blob SHA，與 GitHub tree API 回傳的 `sha` 同源可直接比對。

### 3. 比對

**everything-claude-code**：以檔名（basename）對應 upstream `agents/<name>.md`。

**awesome-claude-code-subagents**：本機扁平化，upstream 有分類層級。以 basename 匹配，若 upstream 同名檔跨多分類，全部列出讓使用者判斷。

狀態分類：
- `OK` — SHA 相同
- `UPDATED` — SHA 不同（上游有變動）
- `MISSING_UPSTREAM` — 上游找不到同名檔（可能已被移除或改名）
- `LOCAL_MODIFIED` — 本機 SHA 不符合上游任何版本（使用者手動改過，需人工判斷）

判斷 `UPDATED` vs `LOCAL_MODIFIED` 的方式：查上游該檔的 commit 歷史，看本機 SHA 是否出現在歷史中。
```bash
gh api "repos/<owner>/<repo>/commits?path=<upstream-path>&per_page=20" \
  --jq '.[].sha' # 這是 commit SHA，不是 blob SHA
# 取得 commit 後查各 commit 下的 blob SHA
gh api "repos/<owner>/<repo>/contents/<path>?ref=<commit-sha>" --jq '.sha'
```

若嫌重，v1 可簡化為只分 `OK` / `DIFF`，`DIFF` 再由使用者自行比對。

### 4. skills 檢查（真比對 SKILL.md blob SHA）

**前提**：精確版本比對的是 `SKILL.md` 的 blob SHA。若 skill 的 `references/`、`scripts/`、`assets/` 有更動但 SKILL.md 沒改，此檢查會漏報——實務上影響不大，因為 SKILL.md 是主要入口。

**步驟**：

1. 讀 `skills-lock.json`，產出 `<name>\t<source>` 清單：

   ```bash
   node -e "const d=JSON.parse(require('fs').readFileSync('skills-lock.json','utf8'));for(const[k,v] of Object.entries(d.skills))console.log(k+'\t'+v.source);"
   ```

2. 計算本機 `~/.claude/skills/<name>/SKILL.md` 的 blob SHA（若不存在標記 `NOT_INSTALLED`）：

   ```bash
   for name in <names>; do
     f="$HOME/.claude/skills/$name/SKILL.md"
     if [ -f "$f" ]; then
       git hash-object "$f"
     else
       echo "NOT_INSTALLED"
     fi
   done
   ```

3. 對每個**獨特的** source repo（同一 repo 可能被多個 skill 共用，合併呼叫避免浪費 API quota），抓一次 recursive tree：

   ```bash
   gh api "repos/<source>/git/trees/HEAD?recursive=1" \
     --jq '.tree[] | select(.type=="blob" and (.path | endswith("SKILL.md"))) | "\(.path)\t\(.sha)"'
   ```

   **注意**：用 `HEAD` 而非 `main`，因為有些 repo 的 default branch 是 `master`。若 404，fallback 用 `main`。

4. 對每個 `<name>`，在該 repo 的 SKILL.md 列表中依路徑匹配：
   - **優先**：路徑形如 `<name>/SKILL.md` 或 `*/<name>/SKILL.md`
   - **單 skill repo**（如 `microsoft/playwright-cli`）：路徑為根目錄 `SKILL.md`
   - 若多筆候選：全列出讓使用者判斷
   - 若 0 筆候選：標 `MISSING_UPSTREAM`

5. 比對本機 blob SHA vs 上游 blob SHA：
   - 相同 → `OK`
   - 不同 → `UPDATED`（上游有更新）
   - 本機 `NOT_INSTALLED` → `NOT_INSTALLED`（跳過比對，提示可 `npx skills add -g <source>`）

**輸出表格**：

```
## Skills（真比對）

| Name | Source | 狀態 | 備註 |
|---|---|---|---|
| vue-best-practices | vuejs-ai/skills | OK | — |
| frontend-design | anthropics/skills | UPDATED | 本機 `abc123` → 上游 `def456` |
| foo | bar/baz | NOT_INSTALLED | 執行 `npx skills add -g bar/baz` |
| multi-match | x/y | AMBIGUOUS | 上游有 2 個同名 SKILL.md：`a/<name>/SKILL.md`、`b/<name>/SKILL.md` |
```

### 5. 輸出報告

精簡 Markdown table，三段：

```
## Agents：everything-claude-code

| Name | 狀態 | 備註 |
|---|---|---|
| foo | OK | — |
| bar | UPDATED | 上游 blob `abc123` → 本機 `def456` |

## Agents：awesome-claude-code-subagents

| Name | 狀態 | upstream 分類 | 備註 |
|---|---|---|---|
| ... |

## Skills（真比對 SKILL.md blob SHA）

| Name | Source | 狀態 | 備註 |
|---|---|---|---|
| vue-best-practices | vuejs-ai/skills | OK | — |
| frontend-design | anthropics/skills | UPDATED | 本機 `abc123` → 上游 `def456` |
```

末尾附**更新指令提示**（不自動執行）：

```
## 如何更新

### Agents（單檔覆寫）
gh api repos/affaan-m/everything-claude-code/contents/agents/<name>.md --jq '.content' | base64 -d > claude/agents/everything-claude-code/<name>.md

gh api "repos/VoltAgent/awesome-claude-code-subagents/contents/categories/<category>/<name>.md" --jq '.content' | base64 -d > claude/agents/awesome-claude-code-subagents/<name>.md

### Skills（已安裝有更新 → 首選）
npx skills update -g <name>

### Skills（尚未安裝）
npx skills add -g <source>

### Fallback（update 失敗時才用，remove + add 會觸發互動選單，多 skill repo 需手動選）
npx skills remove -g <name> && npx skills add -g <source>
```

**附註**：agents 更新後需要 `npm run to-local` 才會套用到本機 `~/.claude/agents/`；skills 由 `npx skills` 直接操作 `~/.claude/skills/`，不走本專案的同步流程。

## 規則

- **不自動執行更新**，僅輸出報告與指令
- 一律用 `gh api`，禁用 WebFetch
- 禁用 `$()` 命令替換；需帶入值時分兩步 Bash
- 若 API 失敗（rate limit、網路），明確標註失敗項，不靜默略過
- 回應簡潔，條列為主，不寫多餘解釋
