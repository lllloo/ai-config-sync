# Obsidian

用戶說「ob」即指 Obsidian。vault = obsidian-memory repo（本機 clone 固定路徑 `~/code/obsidian-memory`；Windows 即 `%USERPROFILE%\code\obsidian-memory`）。

兩個 skill：

- **`ob-write`（global，任何專案可呼叫）**：寫進 vault。skill 內部判 cwd——在 repo（cwd = vault root）走本地、不限工具；在其他專案走跨專案，經**定位鏈**找本機 clone（`Read` 固定路徑 `~/code/obsidian-memory/vault-map.md`、內容含錨點 `title: Vault Map` 即驗明身分，harness-native、不依賴 obsidian CLI）後用檔案工具直寫（不 commit、不 push），找不到即中止提示對齊路徑、不降級寫別處。
- **`ob-read`（global，任何專案可呼叫）**：vault 查詢。skill 內部判 cwd——在 repo 走本地直接搜；在其他專案走跨專案，經同一定位鏈驗明身分後唯讀三層搜尋（定位不到或身分不符即回未命中、不降級亂搜）。

本檔是**跨專案全域協議**：人在其他專案如何與 vault 互動。在 repo 內工作時，操作規格交給該 repo 的 `CLAUDE.md`，本檔不重述。

禁止不請自來寫 vault；一律由使用者明確要求才動。

兩個 skill 都設 `disable-model-invocation: true`（Claude Code 專屬欄位，其他工具不認）：**Claude 不依 description 自動觸發、也不主動代呼**，只有使用者親自輸入 `/ob-write`、`/ob-read` 才會跑。下文「用 `/ob-write`／`/ob-read`」一律解讀為「提示使用者輸入該 slash command」，而非 Claude 自行呼叫。判斷到該寫／該查時，Claude 提議並請使用者輸入指令。

## 跨專案寫入 → `/ob-write`

使用者在其他專案說「記到 ob」「存進 vault」「記一下這段」「筆記關於…」時，用 `/ob-write`（跨專案模式機制見上方總則：定位鏈驗身後直寫本機 clone，定位不到或身分不符即中止）。

**跨專案輕量原則**（寫入時遵守）：只收束這次真正值得留下的重點 + 必要回查線索（原專案、檔案、指令、關鍵字）；不要把整段對話、完整 log、一次性過程或未整理的外部資料搬進來。整理成 Card / 升 Topic，回 vault session 再做。

> 對應 vault Topic：`Topics/Obsidian/跨專案內容整理到-Inbox.md`

## 跨專案查詢與技術提問

查 vault 一律用 `/ob-read`（跨專案模式機制見上方總則）：定位鏈定位 vault 並硬 gate 身分後跑唯讀三層搜尋；定位不到或身分不符即回未命中並提示對齊路徑，**不降級亂搜**。未經定位鏈驗身就用檔案工具（Grep / Read）直接搜 vault 目錄僅限**在 repo 內的本地模式**；跨專案模式必須先定位鏈驗身，驗身後同樣走 harness-native 搜尋。

技術／知識性提問（已記過主題、Claude Code、RAG、Agent、前端切版等）：可並行查 vault + WebSearch。純語法、即時系統狀態、閒聊不觸發。

綜合雙來源：

- 兩邊命中：vault 打底，web 補最新
- 僅 vault：以 vault 為主
- 僅 web：以 web 為主，末尾提示「vault 暫無，可用 /ob-write 建立」
- 矛盾時：並列差異

引用格式（命中必加，`<path>` 為 vault root 相對路徑，如 `Cards/X.md`）：

```
來源：
- Vault：[[<title>]] — <path>
- Web：[<頁面>](<URL>)
```

## obsidian CLI（選用，僅本地開檔用）

跨專案定位與建檔已改走定位鏈（Read 固定路徑 + 錨點驗身、harness-native），**不再依賴 obsidian CLI**；CLI 偵測失敗不影響任何跨專案流程。obsidian CLI 目前唯一用途是 `ob-write` 本地模式（cwd = vault root）寫完後**選用** `obsidian open file="<path>"` 把檔案在 Obsidian app 立即開起來——不可用只是不自動開檔，file watcher 通常自動抓到新檔，否則提示 `Ctrl+P → Reload app without saving`。

CLI = `C:\Program Files\Obsidian\Obsidian.com`（terminal redirector，1.12.7+ 隨桌面 app 內建，需在 Obsidian → 設定 → General 啟用「Command line interface」並重開 terminal），呼叫方式因 shell 而異：

- **PowerShell**：認 `.com` 經 `PATHEXT`，`obsidian <cmd>` 可直接用 → **Windows 預設用此**
- **Git Bash**：不認 `.com`，`obsidian` 會 not found。改用顯式 `Obsidian.com <cmd>` 或 `powershell.exe -Command "obsidian ..."`
- **Claude Code session**：啟動時 snapshot PATH；新裝 CLI 後**這個 session 看不到**，要重開才生效
