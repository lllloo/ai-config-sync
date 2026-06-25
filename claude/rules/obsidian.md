# Obsidian

用戶說「ob」即指 Obsidian。vault = obsidian-memory repo：

- **Windows**：`C:\code\obsidian-memory`
- **WSL**：同一份 vault 經 interop 在 `/mnt/c/code/obsidian-memory`

兩個 skill：

- **`ob-write`（global，任何專案可呼叫）**：寫進 vault。skill 內部判 cwd——在 repo（cwd = vault root）走本地、不限工具；在其他專案走跨專案、嚴格 CLI（自動用 obsidian CLI 定位 vault 並建檔，CLI 不可用即中止、不降級寫檔）。
- **`ob-read`（global，任何專案可呼叫）**：vault 查詢。skill 內部判 cwd——在 repo 走本地直接搜；在其他專案走跨專案、嚴格 CLI 定位 vault 後唯讀三層搜尋（CLI 不可用或身分不符即回未命中、不降級亂搜）。

本檔是**跨專案全域協議**：人在其他專案如何與 vault 互動。在 repo 內工作時，操作規格交給該 repo 的 `CLAUDE.md`，本檔不重述。

禁止不請自來寫 vault；一律由使用者明確要求才動。

兩個 skill 都設 `disable-model-invocation: true`（Claude Code 專屬欄位，其他工具不認）：**Claude 不依 description 自動觸發、也不主動代呼**，只有使用者親自輸入 `/ob-write`、`/ob-read` 才會跑。下文「用 `/ob-write`／`/ob-read`」一律解讀為「提示使用者輸入該 slash command」，而非 Claude 自行呼叫。判斷到該寫／該查時，Claude 提議並請使用者輸入指令。

## 跨專案寫入 → `/ob-write`

使用者在其他專案說「記到 ob」「存進 vault」「記一下這段」「筆記關於…」時，用 `/ob-write`。它會偵測 cwd 不在 vault，自動走跨專案模式（嚴格 CLI 定位 vault 並建檔；vault 身分不符或 CLI 不可用即中止）。

**跨專案輕量原則**（寫入時遵守）：只收束這次真正值得留下的重點 + 必要回查線索（原專案、檔案、指令、關鍵字）；不要把整段對話、完整 log、一次性過程或未整理的外部資料搬進來。整理成 Card / 升 Topic，回 vault session 再做。

> 對應 vault Topic：`Topics/Obsidian/跨專案內容整理到-Inbox.md`

## 跨專案查詢與技術提問

查 vault 一律用 `/ob-read`（global，任何專案可呼叫）。它偵測 cwd 不在 vault 即走跨專案模式：嚴格 obsidian CLI 定位 vault 並硬 gate 身分，通過後對 vault 絕對路徑跑唯讀三層搜尋；CLI 不可用或身分不符即回未命中並提示啟用 CLI，不降級亂搜。CLI 暫時不可用時才退而用檔案工具（Grep / Read）直接搜 vault 下的 `.md`（Windows `C:\code\obsidian-memory\`；WSL `/mnt/c/code/obsidian-memory/`）。

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

## obsidian CLI 呼叫（依平台）

CLI = `C:\Program Files\Obsidian\Obsidian.com`（terminal redirector，1.12.7+ 隨桌面 app 內建，需在 Obsidian → 設定 → General 啟用「Command line interface」並重開 terminal），呼叫方式因平台／shell 而異：

- **PowerShell**：認 `.com` 經 `PATHEXT`，`obsidian <cmd>` 可直接用 → **Windows 預設用此**
- **Git Bash**：不認 `.com`，`obsidian` 會 not found。改用顯式 `Obsidian.com <cmd>` 或 `powershell.exe -Command "obsidian ..."`
- **WSL**：**已實測可用** — `/mnt/c/Program Files/Obsidian/Obsidian.com vault list` 經 interop 能連上 Windows 上執行中的 Obsidian app 並正確列出 vault（跨 WSL/Windows 邊界的 redirector→app IPC 會橋接）。兩個前提／坑：① **須用完整路徑**（WSL PATH 不含 `.com`，`obsidian` 會 not found）；② Obsidian app **沒開時**回「unable to find Obsidian」且仍是 **exit 0**，故 CLI 可用性偵測**不能只看 exit code**，須解析 stdout 判斷是否真的連上。
- **Claude Code session**：啟動時 snapshot PATH；新裝 CLI 後**這個 session 看不到**，要重開才生效
- CLI 偵測失敗時：`/ob-write` 跨專案模式會**中止、不降級寫檔**（嚴格 CLI），需先啟用 CLI 並重開 terminal；在 repo 內（本地模式）才會降級用檔案工具寫並提醒 `Ctrl+P → Reload app without saving`。
