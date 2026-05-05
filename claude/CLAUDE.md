# 全域 Claude Code 指示

此檔案定義所有專案通用的全域規則與慣例。

## 語言規範

**一律使用繁體中文**撰寫所有內容、註解、文件、溝通訊息與 commit 訊息。技術術語可保留英文。輸出 Markdown 文件時亦同。

## 回應風格

精簡。不廢話。直接切入重點。少用字。

## 構建與打包規則

**預設禁止執行打包命令** — 除非明確要求，否則不執行：

- `npm run build` / `yarn build` / `pnpm build`
- `npm run docs:build` 或類似構建命令

**例外**：只有在明確指示「請打包」、「執行打包」時才可執行。

## Commands vs Skills

**一律使用 skill**，不再新增 command。

Skills 是 commands 的超集，同時遵循 [Agent Skills](https://agentskills.io) 開放標準——可直接移植到 Cursor、Gemini CLI、Codex、GitHub Copilot 等其他 AI 工具。

## Skill 寫作原則

**核心**：skill 自包含跨工具可用，不綁 Claude Code 專屬機制，規則不在多處重複。

**做法**：

- subagent 一律 `Agent` + `subagent_type: "general-purpose"`，prompt = `references/*.md` 全文 + 本次需求（不要叫 subagent 自己 Read）
- 工具限制等規則寫在 references 正文，自包含、不引用命名 agent
- 補 fallback 條款：「無 Agent 工具時主 agent 直接 Read references 跑同一流程」

**避免**：

- `.claude/agents/` 新增命名 agent（Claude Code 專屬，跨工具不可移植）
- SKILL.md 與 references 重複定義（必漂移）
- 規則只寫 frontmatter（fallback 路徑看不到）

## README.md 規範

所有軟體專案**必須撰寫 `README.md`**，最低需包含：專案說明、安裝方式、常用指令。

## Obsidian

用戶說「ob」即指 Obsidian。

依情境選工具：

**1. 筆記操作**（觸發詞：「ob」、「筆記」、「日記」、「daily」、「記一下」、「找筆記」、「搜尋筆記」）
→ 觸發 `ob` skill（等同使用者打 `/ob <需求>`），由 skill 內部依語意分派：
  - 建檔／日記／記一下／寫一篇 → `references/write.md` 經 `subagent_type: "general-purpose"`（寫入與 CLI 操作）
  - 找／搜尋／有沒有／查 → `references/query.md` 經 `subagent_type: "general-purpose"`（唯讀三層搜尋，含工具契約）
→ 不做 WebSearch

**2. 技術/知識性提問**（Claude Code、Obsidian、RAG、Agent、前端切版、已記過主題）
→ 單一訊息內並行：`ob` skill 的 `references/query.md` 經 `subagent_type: "general-purpose"` + WebSearch
→ 純語法、即時系統狀態、閒聊不觸發

綜合雙來源：

- 兩邊命中：vault 打底，web 補最新
- 僅 vault：以 vault 為主
- 僅 web：以 web 為主，末尾提示「vault 暫無，可 /ob 建立」
- 矛盾時：並列差異

引用格式（命中必加，`<path>` 已含 `content/` 前綴）：

```
來源：
- Vault：[[<title>]] — <path>
- Web：[<頁面>](<URL>)
```

禁止不請自來寫 vault；建檔一律由用戶用 `/ob` 觸發。
