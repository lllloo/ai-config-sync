# 全域 Claude Code 指示

此檔案定義所有專案通用的全域規則與慣例。

## Commands vs Skills

**一律使用 skill**，不再新增 command。

Skills 是 commands 的超集，同時遵循 [Agent Skills](https://agentskills.io) 開放標準——可直接移植到 Cursor、Gemini CLI、Codex、GitHub Copilot 等其他 AI 工具。

## Skill 寫作原則

skill 的 subagent 子流程**一律 `Agent` tool + `subagent_type: "general-purpose"`，prompt 為對應 `references/*.md` 全文 + 本次需求**。

**為什麼**：命名 agent（`.claude/agents/<name>.md`）是 Claude Code 專屬，跨工具不可移植；frontmatter 的 `tools:` 欄位無法約束「無 subagent 環境主 agent 直接讀 references 跑」的 fallback 路徑；同一份內容存兩處（命名 agent + references）必漂移。

**應這樣**：

- 工具限制（唯讀契約等）寫在 references 正文，明列允許／禁止命令
- references 自包含；不引用未存在的命名 agent、不依賴 host 工具預設行為
- 補 fallback 條款：「無 Agent 工具的環境由主 agent 直接 Read references 跑同一流程」
- subagent prompt 直接貼 references 全文，不要寫「請 Read xxx.md」要求 subagent 自己抓檔

**應避免**：

- 在 `.claude/agents/` 新增命名 agent
- 在 SKILL.md 與 references 兩處重複定義同一輸出格式 / schema
- 把規則只寫在 frontmatter（fallback 路徑會看不到）

## 回應風格

Be concise. No filler. Straight to the point. Use less words.

## 語言規範

**一律使用繁體中文**撰寫所有內容、註解、文件、溝通訊息與 commit 訊息。技術術語可保留英文。輸出 Markdown 文件時亦同。

## Bash 指令規範

**禁止在 Bash 工具呼叫中使用 `$()` 命令替換** — 會觸發 Claude Code 安全確認提示。

改以兩步執行：

1. 先用獨立 Bash 呼叫取得值（例如 `date +%y%m%d%H%M`）
2. 再將取得的字面值帶入下一個指令

## 構建與打包規則

**預設禁止執行打包命令** — 除非明確要求，否則不執行：

- `npm run build` / `yarn build` / `pnpm build`
- `npm run docs:build` 或類似構建命令

**例外**：只有在明確指示「請打包」、「執行打包」時才可執行。

## README.md 規範

所有軟體專案**必須撰寫 `README.md`**，最低需包含：專案說明、安裝方式、常用指令。

## 沙箱模式注意事項

依賴 macOS XPC/IPC 的 CLI 工具在沙箱模式下無法執行，需用 `/sandbox` 關閉，或由使用者自行在終端機執行（`! <command>`）。

## Obsidian

用戶說「ob」即指 Obsidian。Obsidian CLI 依賴 macOS XPC/IPC，沙箱模式下需 `/sandbox` 關閉才能執行。

依情境選工具：

**1. 筆記操作**（觸發詞：「ob」、「筆記」、「日記」、「daily」、「記一下」、「找筆記」、「搜尋筆記」）
→ 觸發 `ob` skill（等同使用者打 `/ob <需求>`），由 skill 內部依語意分派：
  - 建檔／日記／記一下／寫一篇 → `references/write.md` 經 `subagent_type: "general-purpose"`（寫入與 CLI 操作）
  - 找／搜尋／有沒有／查 → `references/query.md` 經 `subagent_type: "general-purpose"`（唯讀三層搜尋，含工具契約）
→ 不做 WebSearch

**2. 技術/知識性提問**（Claude Code、Obsidian、RAG、Agent、前端切版、已記過主題）
→ 單一訊息內並行：`ob` skill 的 `references/query.md` 經 `subagent_type: "general-purpose"` + WebSearch
→ 純語法、即時系統狀態、閒聊不觸發

綜合雙來源：兩邊命中以 vault 打底、web 補最新；僅 vault 以 vault 為主；僅 web 為主且末尾提示「vault 暫無，可 /ob 建立」；矛盾時並列差異。

引用格式（命中必加，`<path>` 已含 `content/` 前綴）：

```
來源：
- Vault：[[<title>]] — <path>
- Web：[<頁面>](<URL>)
```

禁止不請自來寫 vault；建檔一律由用戶用 `/ob` 觸發。
