# 本地頁面產出：怎麼開、怎麼給連結

管的是「產出物做好之後，怎麼讓我看到」。落點與寫法歸 `local-page-authoring.md`，本檔不重述。

## 預設：直接開，不起 server

寫完檔案就用系統預設瀏覽器開：

- WSL：`wslview <絕對路徑>`
- 其他 Linux：`xdg-open`｜macOS：`open`

⛔ **不要為了「給連結」而起 `python3 -m http.server` 之類的靜態伺服器。** 多數說明頁、報告、圖表是單一 HTML、樣式內嵌，`file://` 直接開就正常；起 server 只是在檔案與瀏覽器之間多塞一個中間人。

## 只有三種情況才需要 server

- 頁面要 `fetch()`／`XMLHttpRequest` 讀同目錄的檔（如 `data.json`）
- 用了 `<script type="module">`
- 需要 origin：cookie、登入態、`localStorage`／`IndexedDB` 隔離

三條都不中就不要起。**先確認頁面實際用了什麼，不要憑「反正 server 比較保險」就起。**

真的要起時：

- **綁 `127.0.0.1`，⛔ 不用 `0.0.0.0`** —— 後者等於把該目錄對同網段全開
- 挑一個沒人用的 port，起之前先確認
- **同一則回覆就附上關閉指令**，並在任務結束時主動提醒還開著

## 給連結：要可點，也要夠短

給路徑不等於給連結。WSL 的 Linux 路徑 Windows 開不了，要先轉：

```
wslpath -w <路徑>        # → \\wsl.localhost\<Distro>\...
```

再把反斜線換成正斜線、前面加 `file://`，即為可點 URL。

**長度也是需求的一部分。** 終端機會裁斷過長的連結 —— 含 session UUID 的暫存目錄動輒 150+ 字元。這種情況把檔案複製到短路徑（如 `/tmp/<短名>/`），或放 `/mnt/c/...`（Windows C 槽，URL 形如 `file:///C:/tmp/x.html`，最短）。原檔留在原處，複本只是為了連結。

附連結時同時給**純文字版**，方便複製。

## 驗證

- 確認 server 是否關閉：**看 `ss -ltn | grep <port>`**
- ⛔ **不要用 `pgrep -af "http.server"` 判定** —— pattern 會命中自己那條 shell 指令字串，得到「還有殘留」的假陽性
