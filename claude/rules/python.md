---
paths: "**/*.py,**/pyproject.toml,**/requirements*.txt"
---

# Python 編碼規則

執行環境 locale 編碼不可控（Windows 預設 cp950）。優先用機器級 `PYTHONUTF8` 一次罩住；只有在無法保證目標環境有設時，才退到腳本級顯式設定。

## 首選：機器級 `PYTHONUTF8=1`

一次轉 UTF-8（stdout/stderr、`open()`、路徑），不必每支腳本重寫。**能掌控執行環境就設這個**。

```powershell
[System.Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'User')
```

注意：須 Python 啟動前設好，當前 session 吃不到要重開 terminal。

## Fallback：無法設機器級時才寫進腳本

下列情況機器級罩不住，改用腳本級（可攜底線）：

- 腳本會跑到 **CI／別人機器／容器**，無法保證對方有設 `PYTHONUTF8`
- **沒有設定權限**的環境

> 機器級已設時，腳本級只是無害 no-op；移植到沒設的環境時才是唯一保證。要可攜就照下面全做，不要因「我自己機器有設」而省略。

**1. 開頭 reconfigure stdout＋stderr**（import 之後、其他代碼之前）：

```python
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
```

只修被點名的串流，故兩條都要；管不到 `open()` 與 subprocess。

**2. `open()` 一律顯式 `encoding="utf-8"`**（含 `Path.read_text/write_text`）。`json.dump` 加 `ensure_ascii=False` 才保留中文。

**3. `subprocess` 文字模式必加 `encoding`／`errors`**（`text=True` 在 Windows 用 cp950 解碼，遇 UTF-8 會崩或 stdout 變 None）：

```python
subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
```

**4. 路徑交給 `pathlib.Path`**，不手動轉碼。
