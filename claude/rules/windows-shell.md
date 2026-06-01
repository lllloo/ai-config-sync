# Windows Shell

本機預設 shell 是 PowerShell（win32，Claude Code 2.1.139+ 原生 PowerShell 工具）；
Git Bash 與 WSL bash 也可經 Bash 工具叫起。模型易反射吐 bash 語法 → 在 PowerShell 失敗。

**優先 harness-native 工具**：`Read`/`Write`/`Glob`/`Grep`/`Edit` 不經 shell、不分 PowerShell/bash。
存在檢查用 Read、建檔用 Write、搜尋用 Grep/Glob——這些動作不要落 shell。

**真需 shell 時**（CLI、聚合 pipeline、fixed-string 比對）：一條指令只用一種 shell，
絕不混 bash 與 PowerShell 語法。認清工具——`Bash` 工具用 bash 語法、`PowerShell` 工具用
PowerShell 語法（here-string `@'...'@` 是 PowerShell 專屬，勿放進 Bash 工具）。不確定就用
PowerShell（本機預設），或改走 harness-native 工具避開。
