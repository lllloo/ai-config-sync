# Obsidian

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

## Windows obsidian CLI 呼叫

CLI = `C:\Program Files\Obsidian\Obsidian.com`（terminal redirector，1.12.7+ 隨桌面 app 內建，需在 Obsidian → 設定 → General 啟用「Command line interface」並重開 terminal），呼叫方式因 shell 而異：

- **PowerShell**：認 `.com` 經 `PATHEXT`，`obsidian <cmd>` 可直接用 → **Windows 預設用此**
- **Git Bash**：不認 `.com`，`obsidian` 會 not found。改用顯式 `Obsidian.com <cmd>` 或 `powershell.exe -Command "obsidian ..."`
- **Claude Code session**：啟動時 snapshot PATH；新裝 CLI 後**這個 session 看不到**，要重開才生效
- CLI 偵測失敗時 `/ob` skill 自動 fallback Write/Edit（提醒用戶在 Obsidian 按 `Ctrl+P → Reload app without saving`）
