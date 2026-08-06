## Context

見 `proposal.md` 的 Why。本 change 不改程式碼，設計問題只有兩個：這份行為契約該落在哪個 capability，以及描述到什麼顆粒度。

既有 spec 版圖中有兩個看似可以收納它的位置：`bidirectional-sync-workflow`（已涵蓋 `diff`／`status`／`to-repo`／`to-local` 的工作流語意）與 `core-sync-cli`（已涵蓋指令登錄、旗標白名單、exit code 三段語義）。`to-win-local` 與兩者都有接觸面——它是一個註冊在指令表裡的指令，也確實執行套用——但它的核心內容（平台守門、家目錄探測、委派而非複製）不屬於任一方。

## Goals / Non-Goals

**Goals：**

- 把 `to-win-local` 的守門條件與委派契約固定成可對照的規格，讓「不另實作第二套同步邏輯」這條架構不變式在未來被違反時，會在 review 浮現而非靜默發生。
- 誠實標示規格與測試之間的覆蓋缺口，不讓「有 spec」被誤讀為「有對照測試」。

**Non-Goals：**

- 不改 `sync.js`、不改測試、不改既有 spec 的任何 requirement。
- 不補上已知的測試缺口（理由見 Decisions 第 3 點）。
- 不重新設計 `to-win-local` 的任何行為——若規格撰寫過程發現行為本身有問題，記錄下來另開 change，不在回填中夾帶修改。

## Decisions

### 1. 開新 capability `wsl-windows-bridge`，不併入既有兩份

**選擇**：新增獨立 capability。

**替代方案**：

- *併入 `bidirectional-sync-workflow`*：該 spec 的 6 條 requirement 全在描述「repo 與本機之間的比較與套用語意」，是與平台無關的抽象。塞入 WSL 判定、`/mnt` 路徑轉換、`cmd.exe` 探測會讓一份平台中立的規格突然綁上單一作業系統組合，稀釋其可讀性。
- *併入 `core-sync-cli`*：該 spec 管的是指令表登錄、旗標白名單、exit code 語義等**所有指令共通**的機制。`to-win-local` 作為指令的註冊確實已被它涵蓋，但它的守門邏輯是單一指令專屬，放進共通機制規格是分層錯置。

**理由**：`to-win-local` 是一個有自己守門與委派語意的子系統，與雙向工作流正交——工作流回答「套用什麼、怎麼確認」，本 capability 回答「套用到哪個家目錄、什麼情況下拒絕」。`document-core-sync-engine` 當初也是按子系統切成四個 capability 而非塞進一份，此決策沿用同一切分原則。

### 2. 規格以 CLI 可觀察行為描述，不寫內部函式名

**選擇**：requirement 與 scenario 只提指令、旗標、環境變數、錯誤碼與結束碼；不出現 `isWsl`／`resolveWinHome`／`winPathToWslPath` 等函式名。唯一保留的識別字是環境變數 `AI_CONFIG_SYNC_WIN_HOME`——它在 README 已是公開契約，使用者會直接設定它。

**替代方案**：*比照 `toml-statement-reader` 寫出函式名*。那份 spec 大量出現 `readTomlStatements`／`findTomlHeaderEnd`，看似是既有慣例。

**理由**：兩者的對外面不同。`toml-reader.js` 是被 `safety-check.js` 直接 require 的模組，函式簽章**就是**它的對外契約，寫進 spec 名實相符。`to-win-local` 的對外面是 CLI；內部函式如何切分是實作細節，重構它們不應該讓規格失效。這符合 OpenSpec 的判準：實作可以改而外部可觀察行為不變的東西，不屬於 spec。

### 3. 已知測試覆蓋缺口只標示，不在本 change 補測試

**選擇**：在 `proposal.md` 的 Impact 明列兩處缺口（`--no-color`／`--verbose` 的轉交無對照測試；子行程 `error`／`signal`／`status === null` 三條結果傳遞路徑無測試），本 change 不動 `test/`。

**替代方案**：*順手補上那幾條測試*。工作量確實不大。

**理由**：純規格回填的價值在於 diff 只有 `openspec/` 一個目錄——review 時能直接對照「spec 寫的是不是程式碼現在做的事」，不必分辨哪些行是新行為。混入測試改動就失去這個性質。這也是「每一行改動都要能直接追溯到使用者的要求」的實作：本次要求是補規格。缺口既已白紙黑字寫進 Impact，就不會遺失。

## Risks / Trade-offs

- **spec 寫了但無對照測試的 requirement 可能與實作靜默漂移** → 缺口已在 `proposal.md` 的 Impact 逐條列出，且本 change 歸檔後該清單留在 archive 可查；後續若補測試，直接以那份清單為工作項。
- **把「委派而非複製」寫成規範性 requirement，會擋掉未來改用同行程實作的最佳化** → 這正是寫它的目的。目前 `HOME` 及其衍生常數在模組載入時求值、執行期改不了，同行程實作必須先重構那組常數；規格會讓這個代價在提案階段就被看見，而不是在兩套同步邏輯開始漂移後才發現。要改仍然可以改，只是需要一份明確修改此 requirement 的 change。
- **規格描述的守門依賴 WSL 的偵測方式（核心版本標記），該標記若在未來 WSL 版本改變，規格與實作會一起失效** → requirement 刻意以「核心版本含 microsoft 標記」的抽象描述而非寫死字串比對方式，且明訂發行版環境變數不得作為唯一判準；真的失效時是實作與規格同步更新，不會出現規格對、實作錯的分歧。

## Migration Plan

無程式碼變更，無部署步驟。歸檔時 `specs/wsl-windows-bridge/spec.md` 併入 `openspec/specs/wsl-windows-bridge/spec.md`。回退方式為刪除該檔——因為沒有任何程式碼或測試依賴它，回退零副作用。

## Open Questions

- 兩處測試覆蓋缺口是否補、何時補，可在本 change 歸檔後獨立決定。不影響本 change 的 specs、approach 或 tasks——規格描述的是程式碼**現在**的行為，補不補測試都不改變那些行為敘述是否正確。
