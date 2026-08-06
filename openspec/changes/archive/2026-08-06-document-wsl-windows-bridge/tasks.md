## 1. 核對 spec 與現況一致（無程式碼變更）

- [x] 1.1 逐條核對 `specs/wsl-windows-bridge/spec.md` 的每個 Requirement 對應 `sync.js` WSL Bridge section 的既有行為（`isWsl`／`winPathToWslPath`／`detectWinHome`／`resolveWinHome`／`runToWinLocal`），確認無 SHALL 描述超出實作保證
- [x] 1.2 核對三道守門的錯誤碼與 spec 一致：非 WSL 為 `INVALID_ARGS`、探測失敗與目標不存在／非目錄為 `FILE_NOT_FOUND`、目標等同目前 `HOME` 為 `INVALID_ARGS`
- [x] 1.3 核對旗標轉交清單與 `runToWinLocal` 實際轉交的四個旗標（`--dry-run`／`--yes`／`--no-color`／`--verbose`）完全一致，無多列或漏列
- [x] 1.4 確認 spec 未夾帶任何程式碼、測試或既有 spec 的變更（本 change 為純規格回填）
- [x] 1.5 確認與 `bidirectional-sync-workflow`、`core-sync-cli` 的分工無重疊或矛盾：套用語意歸前者、指令登錄與旗標白名單歸後者、平台守門與家目錄解析歸本 spec

**1 的核對結果**：八條 Requirement 全部對應既有實作，無超出實作保證的 SHALL。補充兩項查核鏈：

- **exit code 原樣傳遞鏈完整**：`runToWinLocal` 回傳 `r.status` → `runCommand` 的 `case 'to-win-local'` 直接 return → `main()` 回傳 → `sync.js` 檔尾 `main().then(exitCode => process.exit(exitCode))`。
- **反向指令確認不存在**：`COMMANDS` 共 10 個指令，無 `to-win-repo` 或任何等價項。
- **既有 specs 對 `to-win-local`／WSL／Windows 家目錄零提及**（全庫 grep 無命中），故本 spec 與其分工無重疊、無矛盾。

## 2. 對照既有測試作為可執行背書

- [x] 2.1 對照 `test/sync.test.js` 的 WSL 橋接段，確認路徑轉換（正常／無法解析）、`detectWinHome` 優先序、`resolveWinHome` 三道守門各 scenario 均有對應測試覆蓋
- [x] 2.2 對照 `test/apply-integration.test.js` 的兩條端到端測試，確認「`--dry-run` 預覽不寫入」與「`--yes` 實際寫入且不碰目前 `HOME`」對應到 spec 的旗標轉交與寫入範圍 scenario
- [x] 2.3 記錄無測試對照的 scenario 清單，確認與 `proposal.md` 的 Impact 所列缺口一致
- [x] 2.4 執行 `npm test`，確認全綠（作為 spec 描述行為的現況驗證，非新增測試）

**2 的核對結果**：`npm test` 374 tests／373 pass／1 skipped（skipped 為「非 WSL 環境」條件跳過項，本機在 WSL 內故實際執行）。

2.3 執行時發現 `proposal.md` 原列缺口**不完整**，已回頭補正 Impact。無有效測試對照的 scenario 完整清單：

| 無對照的 scenario | 原因 |
|---|---|
| 位置引數優先於一切 | 兩條端到端測試雖同時傳位置引數並設 `AI_CONFIG_SYNC_WIN_HOME`，但兩者值相同（皆 `winHomeOf(home)`），分辨不出實際生效者 |
| 兩者皆無時自動探測 | 需隔離 `cmd.exe` 外部程序 |
| 探測失敗 | 同上 |
| 輸出控制旗標轉交（`--no-color`／`--verbose`） | 僅 `--dry-run`／`--yes` 有轉交測試 |
| 無法啟動套用流程（`r.error`） | 需模擬 spawn 失敗 |
| 套用流程被訊號中止（`r.signal`） | 需模擬訊號終止 |
| 取不到結束碼（`status === null`） | 同上 |

「套用正常結束回傳子行程 exit code」有對照（`apply-integration.test.js` 斷言 exit 0）。

## 3. 校驗與收斂

- [x] 3.1 執行 `openspec validate document-wsl-windows-bridge --strict`，修正任何格式或結構問題
- [x] 3.2 執行 `openspec status --change document-wsl-windows-bridge`，確認四個 artifact 皆為 done
- [x] 3.3 執行 `npm run safety:check`，確認新增文件未引入 hard block（`safety-check.js` 的掃描根註解明載不掃 `test/`／`openspec/`／README，spec 內含的 `C:\Users\Joe` 路徑樣式不受掃描）
- [x] 3.4 archive 時確認 `openspec/specs/wsl-windows-bridge/spec.md` 的 Purpose 已由 delta 帶入、非 `TBD` 佔位

**3 的核對結果**：`validate --strict` 通過、四個 artifact 皆 done、`safety:check` 維持既有 4 條 env key warning（exit 0，無新增項）。

3.4 於歸檔時驗收完成：主 spec 的 Purpose 由 delta verbatim 帶入（`TBD` 命中數 0），8 條 Requirement 與 22 個 Scenario 全數併入，requirement 標題與 delta 逐條 diff 一致，且主 spec 不含任何 delta operation header（`## ADDED`／`## MODIFIED`／`## REMOVED`／`## RENAMED`）。
