## Purpose

同一台機器上 WSL 與 Windows 各有一套獨立家目錄，本 capability 定義 `to-win-local` 如何從 WSL 側把 repo 內容套用到 Windows 那一份：環境守門、目標家目錄的解析與驗證規則，以及「委派既有套用流程、不另實作第二套同步邏輯」的架構契約。

## ADDED Requirements

### Requirement: to-win-local 僅在 WSL 環境內執行

`to-win-local` SHALL 在執行任何解析或寫入前確認自身執行於 WSL；非 WSL 環境 MUST 以 `INVALID_ARGS` 中止。判定依據為作業系統為 Linux，且具備 WSL 發行版標記或核心版本含 microsoft 標記——發行版環境變數在部分啟動方式（如 systemd unit）下不存在，故不得作為唯一判準。

非 WSL 時 MUST NOT 降級為對目前家目錄的套用：該指令的語意是「寫到另一個家目錄」，靜默改寫目標等於對使用者謊報寫入位置。

#### Scenario: 非 WSL 環境呼叫

- **WHEN** 於非 WSL 的環境執行 `to-win-local`
- **THEN** 以 `INVALID_ARGS` 中止，訊息說明本指令僅能在 WSL 內執行
- **AND** 不解析目標路徑、不寫入任何檔案、不改以目前家目錄為目標

#### Scenario: WSL 環境呼叫

- **WHEN** 於 WSL 內執行 `to-win-local`
- **THEN** 繼續進行 Windows 家目錄解析

### Requirement: Windows 家目錄依固定優先序解析

目標家目錄 SHALL 依「位置引數 → 覆寫環境變數 `AI_CONFIG_SYNC_WIN_HOME` → 向 Windows 命令直譯器探測 `%USERPROFILE%`」的優先序決定，前者命中即不再查詢後者。探測 MUST 以檔案系統根目錄為工作目錄執行，避免 Windows 命令直譯器因無法以 WSL 路徑為工作目錄而發出 UNC 警告。

三者皆無法產生候選路徑時 MUST 以 `FILE_NOT_FOUND` 中止，且訊息 SHALL 同時指出位置引數與環境變數兩種覆寫方式。

#### Scenario: 位置引數優先於一切

- **WHEN** 呼叫時給定位置引數
- **THEN** 以該引數為目標候選，不讀環境變數、不向命令直譯器探測

#### Scenario: 環境變數優先於自動探測

- **WHEN** 未給位置引數且 `AI_CONFIG_SYNC_WIN_HOME` 已設定
- **THEN** 以該環境變數為目標候選，不向命令直譯器探測

#### Scenario: 兩者皆無時自動探測

- **WHEN** 未給位置引數且未設環境變數
- **THEN** 向 Windows 命令直譯器查詢 `%USERPROFILE%` 並轉為 WSL 掛載路徑

#### Scenario: 探測失敗

- **WHEN** 探測指令無法執行、回傳非零狀態，或輸出無法解析
- **THEN** 以 `FILE_NOT_FOUND` 中止，訊息同時說明可用位置引數或 `AI_CONFIG_SYNC_WIN_HOME` 指定

### Requirement: Windows 路徑轉換為零 IO 字串轉換且不臆造結果

Windows 路徑轉 WSL 掛載路徑 SHALL 為純字串轉換，MUST NOT 依賴外部轉換程序——少一個外部程序相依，並使該轉換可被單元測試涵蓋。轉換 MUST 正規化磁碟機代號為小寫、反斜線為正斜線、去除頭尾空白與尾隨斜線。

輸入無法解析為 `<磁碟機代號>:` 開頭的路徑時 MUST 回報「無法解析」，MUST NOT 猜測或拼出一個看似合理的路徑。

#### Scenario: 標準 Windows 路徑

- **WHEN** 輸入 `C:\Users\Joe`
- **THEN** 得到 `/mnt/c/Users/Joe`

#### Scenario: 需正規化的輸入

- **WHEN** 輸入含尾隨斜線、尾隨換行或大寫磁碟機代號（如 `D:/Users/Joe/`）
- **THEN** 得到正規化後的 `/mnt/d/Users/Joe`

#### Scenario: 無法解析的輸入

- **WHEN** 輸入不以 `<磁碟機代號>:` 開頭
- **THEN** 回報無法解析，且不產生任何替代路徑

### Requirement: 目標家目錄須通過存在性與相異性驗證

解析出的目標 SHALL 在套用前通過兩項驗證：必須是存在的目錄；正規化後必須不等於目前家目錄。任一項不通過 MUST 中止且不寫入任何檔案。

目標等同目前家目錄時拒絕執行，是因為放行等同偽裝成一般的本機套用——使用者會以為內容寫到了另一端。此情境多半發生在誤於非 WSL 佈局下呼叫。

#### Scenario: 目標不存在或不是目錄

- **WHEN** 解析出的目標路徑不存在，或存在但不是目錄
- **THEN** 以 `FILE_NOT_FOUND` 中止，錯誤脈絡帶上該路徑

#### Scenario: 目標等同目前家目錄

- **WHEN** 解析出的目標正規化後等於目前家目錄
- **THEN** 以 `INVALID_ARGS` 中止，訊息指引改用一般的本機套用指令

### Requirement: 套用語意由既有 to-local 流程承擔

`to-win-local` MUST NOT 自行實作第二套同步邏輯，SHALL 以覆寫家目錄環境變數的方式重新執行自身的 `to-local` 流程，並直接繼承標準輸入輸出。因此預覽、互動確認閘門、`settings.json` 黑名單過濾、跨工具 skill 的 symlink 橋接等行為與 `to-local` **完全一致**，不存在兩套會各自漂移的同步實作。

套用範圍 MUST 只落在解析出的目標家目錄，MUST NOT 影響目前家目錄下的任何檔案。

#### Scenario: 預覽與確認行為與 to-local 一致

- **WHEN** 在 WSL 內對合法目標執行 `to-win-local`
- **THEN** 先顯示目標家目錄與待套用項目的預覽，再依 `to-local` 既有的確認閘門決定是否寫入

#### Scenario: 寫入範圍限於目標家目錄

- **WHEN** 套用實際寫入檔案
- **THEN** 變更只出現在目標家目錄下
- **AND** 目前家目錄下的對應檔案維持原狀

### Requirement: CLI 旗標原樣轉交套用流程

`--dry-run`、`--yes`、`--no-color`、`--verbose` SHALL 逐一原樣轉交給被委派的套用流程。漏轉交任一旗標都不會使其他行為紅燈——`--dry-run` 漏轉交會造成「以為在預覽、實際真寫入」，故此為獨立且必須被固定的不變式。

#### Scenario: dry-run 轉交

- **WHEN** 以 `--dry-run` 執行
- **THEN** 顯示將套用的項目且不寫入目標家目錄的任何檔案

#### Scenario: 略過確認轉交

- **WHEN** 以 `--yes` 執行
- **THEN** 不等待互動確認即套用，於非互動環境亦不卡住

#### Scenario: 輸出控制旗標轉交

- **WHEN** 以 `--no-color` 或 `--verbose` 執行
- **THEN** 被委派流程的輸出依該旗標調整

### Requirement: 套用結果的結束碼與異常回報

`to-win-local` SHALL 原樣回傳被委派套用流程的結束碼，使其 exit code 語義與 `to-local` 一致。異常情境 MUST 以統一錯誤型別回報，MUST NOT 讓裸例外穿透。

#### Scenario: 套用正常結束

- **WHEN** 被委派的套用流程正常結束
- **THEN** 以該流程的結束碼作為本指令的結束碼

#### Scenario: 無法啟動套用流程

- **WHEN** 委派執行本身失敗
- **THEN** 包成統一錯誤型別拋出，錯誤脈絡帶上目標路徑

#### Scenario: 套用流程被訊號中止

- **WHEN** 被委派的流程遭訊號終止
- **THEN** 以 `IO_ERROR` 拋出並指出中止的訊號名稱

#### Scenario: 取不到結束碼

- **WHEN** 被委派的流程未回報結束碼
- **THEN** 以錯誤結束碼作為本指令的結束碼

### Requirement: 反向同步刻意不提供

本 capability MUST NOT 提供由 Windows 家目錄回寫 repo 的指令。Windows 端只作為套用目的地，「本機 → repo」方向固定於 WSL 側執行：跨掛載點抓回檔案容易帶進換行符差異。

#### Scenario: 不存在反向指令

- **WHEN** 檢視可用指令清單
- **THEN** 不存在 `to-win-repo` 或任何等價的「Windows 家目錄 → repo」指令

#### Scenario: 由 WSL 側回寫

- **WHEN** 需要把本機設定寫回 repo
- **THEN** 於 WSL 側執行既有的 `to-repo`
