# Obsidian

用戶說「ob」即指 Obsidian。vault = obsidian-memory repo（`C:\code\obsidian-memory`）。

兩個 skill：

- **`ob-write`（global，任何專案可呼叫）**：寫進 vault。skill 內部判 cwd——在 repo（cwd = vault root）本地直寫、不限工具；在其他專案走跨專案定位鏈：找到本機 clone 就檔案工具直寫（不 commit、不 push），無 clone 一律中止提示先 clone，不降級寫到別處。
- **`ob-read`（global，任何專案可呼叫）**：vault 查詢。skill 內部判 cwd——在 repo 本地直接搜；在其他專案走定位鏈找 clone 跑唯讀三層搜尋，無 clone 改讀 GitHub main 快照（結果標註快照範圍），皆不可行才回未命中，不降級亂搜。

本檔是**跨專案全域協議**：人在其他專案如何與 vault 互動。在 repo 內工作時，操作規格交給該 repo 的 `CLAUDE.md`，本檔不重述。

禁止不請自來寫 vault；一律由使用者明確要求才動。

兩個 skill 都設 `disable-model-invocation: true`（Claude Code 專屬欄位，其他工具不認）：**Claude 不依 description 自動觸發、也不主動代呼**，只有使用者親自輸入 `/ob-write`、`/ob-read` 才會跑。下文「用 `/ob-write`／`/ob-read`」一律解讀為「提示使用者輸入該 slash command」，而非 Claude 自行呼叫。判斷到該寫／該查時，Claude 提議並請使用者輸入指令。

## 定位鏈（跨專案共用協議）

兩個 skill 的跨專案模式共用同一條定位鏈：依序 `Read` 下列候選路徑的 `vault-map.md`，讀到且含錨點 `title: Vault Map` 即驗明身分。候選清單是**封閉白名單**，不在候選之外猜路徑；此清單與 ob-read `references/query.md`、ob-write `references/write.md` 同步維護，改一處要三處同改：

- `C:\code\obsidian-memory\vault-map.md`（Windows）
- `/mnt/c/code/obsidian-memory/vault-map.md`（WSL）
- `~/code/obsidian-memory/vault-map.md`（mac / Linux；`~` 先展開為 home 絕對路徑）

全部落空時：`ob-write` **中止**並提示 clone 到候選路徑（Windows `git clone https://github.com/lllloo/obsidian-memory C:\code\obsidian-memory`；mac/Linux clone 到 `~/code/obsidian-memory`），跨專案寫入沒有任何遠端寫入路徑；`ob-read` 改讀 GitHub main 快照，連快照也讀不到才回未命中。

## 跨專案寫入 → `/ob-write`

使用者在其他專案說「記到 ob」「存進 vault」「記一下這段」「筆記關於…」時，用 `/ob-write`（跨專案機制見上方定位鏈：找 clone 直寫，無 clone 中止）。

**跨專案輕量原則**（寫入時遵守）：只收束這次真正值得留下的重點 + 必要回查線索（原專案、檔案、指令、關鍵字）；不要把整段對話、完整 log、一次性過程或未整理的外部資料搬進來。整理成 Card / 升 Topic，回 vault session 再做。

> 對應 vault Topic：`Topics/Obsidian/跨專案內容整理到-Inbox.md`

## 跨專案查詢與技術提問

查 vault 一律用 `/ob-read`（跨專案機制見上方定位鏈）：找到 clone 跑唯讀三層搜尋；無 clone 讀 GitHub main 快照並標註「未 push 內容不在範圍內」；皆不可行回未命中，**不降級亂搜**。跳過 skill 直接用檔案工具（Grep / Read）搜 vault 目錄僅限**在 repo 內的本地模式**，跨專案不適用。

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

## obsidian CLI（已非相依，僅選用輔助）

兩個 skill 的定位鏈全程用 harness-native 工具（Read / Grep），**不相依 obsidian CLI**。CLI（`C:\Program Files\Obsidian\Obsidian.com`，1.12.7+ 隨桌面 app 內建，需在設定 → General 啟用）唯一剩餘用途：`ob-write` 本地模式寫完後，可選用 `obsidian open file="Cards/<標題>.md"` 叫 app 立刻開該檔——PowerShell 直接 `obsidian`；Git Bash 不認 `.com`，用顯式 `Obsidian.com`。CLI 不可用不影響任何流程。

寫完檔 Obsidian file watcher 通常自動抓到；沒更新就提醒 `Ctrl+P → Reload app without saving`。
