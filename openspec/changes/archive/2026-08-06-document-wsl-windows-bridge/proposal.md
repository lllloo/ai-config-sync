## Why

同一台機器上 WSL 與 Windows 是兩套獨立家目錄，各有一份 `.claude/`、`.codex/`、`.agents/`——`to-win-local` 是讓兩邊都收到 repo 內容的唯一途徑，且它會**寫入另一個家目錄**，是本工具寫入面最廣的指令。它有三道守門（WSL 環境判定、目標家目錄探測與驗證、目標等同目前 `HOME` 時拒絕）與一條架構不變式（不另實作同步邏輯，以覆寫 `HOME` 的子行程重跑 `to-local`），全部只存在於程式碼註解、README 與 `CLAUDE.md`，OpenSpec 零覆蓋：`bidirectional-sync-workflow` 只涵蓋 `diff`／`status`／`to-repo`／`to-local`，`core-sync-cli` 只涵蓋通用登錄與分派。此 change 延續 `document-core-sync-engine`／`document-toml-reader-contract` 的 backfill 路線，把既有且已測試的行為補進規格，不改任何程式碼。

## What Changes

- 新增一份 capability spec，把 `to-win-local` 既有行為契約規格化：
  - **執行環境守門**：`isWsl()` 以 `process.platform === 'linux'` 加上 `WSL_DISTRO_NAME` 或 `/proc/version` 的 microsoft 標記判定；非 WSL 一律拋 `INVALID_ARGS`，不嘗試降級為 `to-local`。
  - **目標家目錄解析優先序**：位置引數 > `AI_CONFIG_SYNC_WIN_HOME` 環境變數 > `cmd.exe /c echo %USERPROFILE%` 探測。探測以 `cwd: '/'` 執行以避開 UNC 警告。
  - **路徑轉換為純函式**：`winPathToWslPath` 是零 IO 的字串轉換（刻意不呼叫 `wslpath`，少一個外部程序相依且可單元測試），無法解析為 `<drive>:` 開頭時回 `null` 而非臆造路徑。
  - **目標驗證 fail closed**：探測不到拋 `FILE_NOT_FOUND`；路徑不存在或不是目錄拋 `FILE_NOT_FOUND`；目標 `path.resolve` 後等同目前 `HOME` 時拋 `INVALID_ARGS` 拒絕執行——放行等同偽裝成 `to-local`，會讓使用者以為寫到了另一端。
  - **委派而非複製**：以 `spawnSync(process.execPath, [__filename, 'to-local', ...flags], { stdio: 'inherit', env: { ...process.env, HOME: winHome } })` 重跑自身的 `to-local`，故預覽、互動確認、`settings.json` 黑名單、xtool-skills symlink 橋等語意與 `to-local` **完全一致**，不存在會各自漂移的第二套同步實作。
  - **旗標原樣轉交**：`--dry-run`／`--yes`／`--no-color`／`--verbose` 逐一轉交子行程。漏轉交任一旗標都不會讓其他測試紅燈，故此為需被規格固定的獨立不變式。
  - **子行程結果傳遞**：`r.error` 經 `toSyncFsError` 包成 `SyncError`；`r.signal` 拋 `IO_ERROR`；`r.status === null` 回 `EXIT_ERROR`，否則原樣回傳子行程 exit code。
  - **反向刻意不支援**：無 `to-win-repo`。Windows 端只當套用目的地，`to-repo` 固定在 WSL 側執行（跨 `/mnt` 抓回易帶進換行符差異）。
- **不改任何程式碼、測試或既有 spec**——純規格回填。

## Capabilities

### New Capabilities
- `wsl-windows-bridge`: `to-win-local` 的行為契約——WSL 環境守門、Windows 家目錄的解析優先序與驗證規則、純字串路徑轉換、以覆寫 `HOME` 的子行程委派 `to-local`（含旗標轉交與 exit code 傳遞），以及「不另實作同步邏輯、反向不支援」的架構不變式。

### Modified Capabilities
<!-- 無。`to-win-local` 委派給 `to-local` 而不改變其行為，`core-sync-cli` 的指令登錄／分派需求亦已涵蓋其註冊，既有 spec 的需求皆不變動。 -->

## Impact

- **規格**：新增 `openspec/specs/wsl-windows-bridge/spec.md`（歸檔後）。`bidirectional-sync-workflow` 自此有明確的被委派方規格可指涉。
- **程式碼**：無變更。`sync.js` 的 WSL Bridge section（`isWsl`／`winPathToWslPath`／`detectWinHome`／`resolveWinHome`／`runToWinLocal`）為 single source of truth，spec 描述其既有行為。
- **測試**：無變更。`test/sync.test.js` 6 條（路徑轉換 2、`detectWinHome` 優先序 1、`resolveWinHome` 三道守門 3）與 `test/apply-integration.test.js` 2 條端到端（`--dry-run` 預覽不寫入、`--yes` 實際寫入且不碰目前 `HOME`）已涵蓋大部分本 spec 所述行為，作為規格的可執行對照。
- **已知覆蓋缺口**（本 change 只標示、不修補，避免混入非規格改動）：
  - 旗標轉交只測到 `--dry-run` 與 `--yes`，`--no-color`／`--verbose` 無對照測試。
  - 子行程結果傳遞只測到「正常結束回傳 exit 0」，`r.error`／`r.signal`／`status === null` 三條異常路徑無測試。
  - **解析優先序只有部分有效覆蓋**：`detectWinHome` 的「環境變數優先於 `cmd.exe` 探測」有專屬單元測試，但「位置引數優先於環境變數」無有效對照——`test/apply-integration.test.js` 兩條端到端測試雖同時傳位置引數並設 `AI_CONFIG_SYNC_WIN_HOME`，兩者值相同（皆為 `winHomeOf(home)`），值相同時分辨不出實際生效的是哪一個。「兩者皆無時向 `cmd.exe` 探測」與「探測失敗拋 `FILE_NOT_FOUND`」亦無測試（需隔離外部程序）。
  - 是否補測試由後續 change 決定。
- **文件**：README 的「WSL → Windows 套用（`to-win-local`）」一節為使用者向說明，內容與本 spec 一致，不需修改。
