# core-sync-cli Specification

## Purpose
定義核心 CLI 契約：指令／別名以 `COMMANDS` 單一來源登錄並由明確 `switch` 分派、旗標採白名單制（未知旗標含 typo 一律拋 `INVALID_ARGS` 而非靜默忽略）、`--` 分隔語義、偵測被 npm 攔截旗標的 fail-fast、三段 exit code 語義（`EXIT_OK`／`EXIT_DIFF`／`EXIT_ERROR`）與 help／version 的無副作用路徑。確保「打錯字略過預覽真寫入」等使用錯誤在入口被擋下。
## Requirements
### Requirement: 指令以宣告表登錄並由明確 switch 分派

系統 SHALL 以單一 `COMMANDS` 物件（`{ alias, desc }`）作為指令名稱、別名與說明的單一來源，並由 `COMMAND_ALIASES` 反查別名。`main()` SHALL 先確認 `COMMANDS[command]` 存在，再由 `runCommand` 以明確 `switch` 分派至對應 handler；未知指令 SHALL 拋 `INVALID_ARGS`，MUST NOT 走 handler 注入表。

#### Scenario: 已知指令分派至對應 handler
- **WHEN** 使用者執行 `node sync.js to-repo`
- **THEN** 系統 SHALL 經 `runCommand('to-repo', opts)` 分派至 `runToRepo`

#### Scenario: 別名解析為正式指令名
- **WHEN** 使用者執行 `node sync.js tr`（`to-repo` 的別名）
- **THEN** `parseArgs` SHALL 透過 `COMMAND_ALIASES` 將 command 解析為 `to-repo`

#### Scenario: 未知指令拋錯而非靜默
- **WHEN** 使用者執行一個不在 `COMMANDS` 內的指令名
- **THEN** 系統 SHALL 拋 `SyncError`（code `INVALID_ARGS`）並以 `EXIT_ERROR` 退出

### Requirement: 旗標採白名單制，未知旗標拒絕而非忽略

系統 SHALL 僅接受白名單內的旗標（`--dry-run`、`--yes`／`--force`、`--no-color`、`--verbose`、`--version`／`-v`、`--help`／`-h`）。任何以 `-` 開頭但不在白名單的旗標（含 typo 如 `--dryrun`）SHALL 拋 `SyncError`（code `INVALID_ARGS`），MUST NOT 被靜默忽略——避免打錯 `--dry-run` 時略過預覽直接真寫入。

#### Scenario: typo 旗標拋錯
- **WHEN** 使用者執行 `node sync.js to-repo --dryrun`
- **THEN** 系統 SHALL 拋 `未知旗標：--dryrun`（`INVALID_ARGS`），MUST NOT 執行寫入

#### Scenario: 白名單旗標正常解析
- **WHEN** 使用者執行 `node sync.js to-repo --dry-run`
- **THEN** `parseArgs` SHALL 設定 `result.dryRun = true`

### Requirement: `--` 分隔符後引數視為 extraArgs

系統 SHALL 將 `--` 之後的所有引數收入 `extraArgs`，即使以 `-` 開頭（供 `skills:add` 等接收以 `-` 開頭的 skill 名稱或 URL）。`--` 之前的第一個 positional 引數 SHALL 解析為指令名，其後的 positional 引數亦收入 `extraArgs`。

#### Scenario: 分隔符後的 dash 引數不被當旗標
- **WHEN** 使用者執行 `node sync.js skills:add -- --weird-name source`
- **THEN** `--weird-name` 與 `source` SHALL 進入 `extraArgs`，MUST NOT 觸發未知旗標錯誤

### Requirement: 偵測被 npm 攔截的旗標並 fail fast

系統 SHALL 在 `main()` 開頭呼叫 `assertNoSwallowedNpmFlags`，偵測 `npm_config_dry_run`／`npm_config_yes` 環境變數為 `'true'`（代表旗標未加 `--` 分隔而被 npm 攔截、未傳入 `sync.js`）。命中時 SHALL 拋 `SyncError`（`INVALID_ARGS`）要求以 `--` 分隔重跑，杜絕「以為在預覽、實際真寫入」。

#### Scenario: 未加 -- 導致旗標被 npm 吞掉
- **WHEN** 使用者執行 `npm run to-repo --dry-run`（缺 `--` 分隔）
- **AND** npm 將其轉為 `npm_config_dry_run=true` 環境變數
- **THEN** 系統 SHALL 拋錯中止並提示改用 `npm run to-repo -- --dry-run`，MUST NOT 執行真寫入

### Requirement: exit code 具三段語義

系統 SHALL 以三段 exit code 表達結果：`EXIT_OK=0`（成功，或 `diff`／`status` 無差異）、`EXIT_DIFF=1`（`diff`／`status` 偵測到差異，供 CI 判讀）、`EXIT_ERROR=2`（錯誤或使用錯誤）。所有指令 handler SHALL 回傳 exit code 由單一出口（`main().then(process.exit)`）統一設定，錯誤路徑經 `.catch(formatError)` 以 `EXIT_ERROR` 退出。

#### Scenario: diff 有差異回 EXIT_DIFF
- **WHEN** 使用者執行 `node sync.js diff` 且本機與 repo 有差異
- **THEN** 系統 SHALL 以 `EXIT_DIFF`（1）退出

#### Scenario: 無指令顯示 help 並以錯誤碼退出
- **WHEN** 使用者執行 `node sync.js`（無指令）
- **THEN** 系統 SHALL 顯示 help 並以 `EXIT_ERROR`（2）退出

### Requirement: help 與 version 為獨立無副作用路徑

系統 SHALL 在 `--help` 或 `help` 指令時輸出指令表與旗標說明並以 `EXIT_OK` 退出；在 `--version`／`-v` 時由 `printVersion` 輸出 `package.json` 版本（讀不到時輸出 `unknown`）並以 `EXIT_OK` 退出。這兩條路徑 MUST NOT 觸發任何同步或寫入。

#### Scenario: version 讀不到 package.json 時輸出 unknown
- **WHEN** 使用者執行 `node sync.js --version` 且 `package.json` 不存在
- **THEN** 系統 SHALL 輸出 `unknown` 並以 `EXIT_OK` 退出

