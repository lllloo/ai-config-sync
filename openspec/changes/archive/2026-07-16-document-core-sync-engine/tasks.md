> 本 change 為規格回填（無程式碼變更）。任務即「逐條 requirement 對照現況驗證，確認 spec 敘述與程式碼、既有測試三方一致」。任一項對不上時，修正 spec 敘述（而非改程式碼），除非發現既有行為確有 bug——那應另開 change。

## 1. core-sync-cli 對照驗證

- [x] 1.1 對照 `COMMANDS`／`COMMAND_ALIASES`／`runCommand` switch 與「指令登錄與分派」requirement，確認名稱／別名／說明三者一致
- [x] 1.2 對照 `parseArgs` 旗標白名單與 typo 拒絕（`--dryrun` 拋 `INVALID_ARGS`），確認「旗標白名單」requirement 一致
- [x] 1.3 對照 `--` 分隔語義（extraArgs 收 dash 引數）與 requirement 一致
- [x] 1.4 對照 `assertNoSwallowedNpmFlags`（`npm_config_dry_run`／`npm_config_yes` fail-fast）與 requirement 一致
- [x] 1.5 對照 `EXIT_OK`／`EXIT_DIFF`／`EXIT_ERROR` 三段語義與統一出口（`main().then(process.exit)`／`.catch(formatError)`）
- [x] 1.6 對照 `runHelp`／`printVersion`（無指令→help+EXIT_ERROR、version 讀不到→`unknown`）與 requirement 一致

## 2. bidirectional-sync-workflow 對照驗證

- [x] 2.1 對照 `runDiff` 唯讀、無差異 EXIT_OK／有差異 EXIT_DIFF 與 requirement 一致
- [x] 2.2 對照 `runStatus`（diff + skills:diff 合流、任一差異 EXIT_DIFF）與 requirement 一致
- [x] 2.3 對照 `runToRepo` git 前置檢查（`GIT_ERROR`）與完成後 `showGitStatus`／safety 提示
- [x] 2.4 對照 `runToLocal`／`printToLocalPreview`／`confirmAndApply` 的 preview→confirm 閘門與「拒絕不套用」「無差異直接結束」
- [x] 2.5 對照 `askConfirm` 非 TTY 拒絕（`INVALID_ARGS`）與 `--yes`／`--force` 略過提問
- [x] 2.6 對照 dry-run 絕不寫入與 `copyFile` 內容相同不重寫（冪等）

## 3. sync-write-safety 對照驗證

- [x] 3.1 對照 `writeFileSafe`（`O_EXCL`／`wx`、`mode 0600`、同目錄暫存→rename）與 atomic write requirement
- [x] 3.2 對照 `tempFiles` 登記與 `cleanupTempFiles`／`finally` 清理，含訊號路徑
- [x] 3.3 對照 `handleSignal`（寫入期間警告、re-raise signal／Windows exit 130）
- [x] 3.4 對照 `partialChanges`→`applySyncItems`→`warnPartialApply` 部分失敗可見度
- [x] 3.5 對照 `SyncError`／`formatError`／`toSyncFsError`（PERMISSION vs IO_ERROR）統一錯誤處理
- [x] 3.6 對照 `toRelativePath`／`maskHome` path 遮罩不洩漏使用者目錄

## 4. skills-lock-diff 對照驗證

- [x] 4.1 對照 `computeSkillsDiff`／`runSkillsDiff` 三向集合差與唯讀不改 lock
- [x] 4.2 對照「只輸出建議指令」（`onlyInRepo` 建議 add、`onlyInLocal` 提供加入／移除兩選項）
- [x] 4.3 對照「直讀 `~/.agents/.skill-lock.json`、不用 `npx skills list -g`」的誤報規避理由
- [x] 4.4 對照 EXIT_DIFF／EXIT_OK 判定（單邊差異 → EXIT_DIFF）
- [x] 4.5 對照 `sanitizeForTerminal`／`validateSkillName`／`validateSkillSource` 注入防護

## 5. 收尾

- [x] 5.1 `openspec validate document-core-sync-engine --strict` 通過
- [x] 5.2 `npm test` 綠燈，確認回填過程未意外改動程式碼
- [x] 5.3 確認四份 spec 與既有 7 份 spec、`CLAUDE.md` 敘述無矛盾或重複界定
