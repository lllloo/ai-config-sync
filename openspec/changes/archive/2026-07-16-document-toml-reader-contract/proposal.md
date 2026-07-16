## Why

`toml-reader.js` 是 `safety:check` 對 repo 內任何 `.toml` 做 hard block／warning 判斷的**前提**：它把 TOML 拆成邏輯語句、正確歸屬每個 key 所屬的 section。這組解析器有三項安全關鍵不變式（引號感知 header、malformed header fail-closed、多行 value 續行），一旦錯誤會讓機密 section 的 hard block **靜默降級成漏判**。CLAUDE.md 稱其測試為「安全防線的回歸網、不可刪」，`safety-check` spec 也**依賴**這些不變式——但目前它們**只在程式碼註解與 CLAUDE.md 裡**，OpenSpec 完全沒有捕捉。同儕模組 `safety-check`、`skills` 都各有行為 spec 與 module-boundary spec，唯獨這個安全關鍵模組零 spec 覆蓋。此 change 延續上一輪 `document-core-sync-engine` 的 backfill，把既有行為補進規格，不改任何程式碼。

## What Changes

- 新增一份 capability spec，把 `toml-reader.js` 既有且已測試的行為契約規格化：
  - **邏輯語句拆解**：`readTomlStatements` 將 TOML 拆成 `section`／`kv`／`other` token，key 正確歸屬其所在 section。
  - **引號感知 header 解析**（`findTomlHeaderEnd`／`matchTomlHeader`）：section 名可含帶 `]` 的引號 key（`[mcp_servers."a]b"]`），引號內的 `]` 不得視為 header 結束；並顯式辨識 array-of-tables（`[[x]]`）與一般 table（`[x]`），杜絕字串內 `[x]` 樣式被誤判為 header。
  - **malformed header fail-closed**：`[` 開頭卻無法解析為合法 header 的行回傳 `{type:'section', name:null}`（而非 `other`），標示「有 section 邊界但名字不可信」，讓消費端擋下而非沿用前一 section 名漏判。
  - **多行 value 續行**（`scanTomlValueState`／`isIncompleteTomlValue`）：未閉合的多行陣列與三引號字串併入續行，避免逐行截斷成無效 TOML。
  - **模組邊界**：純函式、零 IO、零外部相依；唯一消費者為 `safety-check.js`（直接 require，非經 `sync.js`）；其回歸測試為安全防線，不可刪除。
- **不改任何程式碼、測試或既有 spec**——純規格回填。

## Capabilities

### New Capabilities
- `toml-statement-reader`: TOML 邏輯語句讀取器的解析契約與模組邊界——section／key-value 拆解與正確歸屬、引號感知 header 解析、malformed header 的 fail-closed 語義、多行 value 續行，以及「純函式零 IO、僅供 safety-check 消費、回歸測試為安全防線」的模組不變式。

### Modified Capabilities
<!-- 無。此為既有行為回填，不改任何現有 spec 的需求。 -->

## Impact

- **規格**：新增 `openspec/specs/toml-statement-reader/spec.md`（歸檔後）。
- **程式碼**：無變更。`toml-reader.js` 為 single source of truth，spec 描述其既有行為。
- **測試**：無變更。`test/toml-reader.test.js` 與 `test/boundary.test.js`（F2 回歸）已涵蓋本 spec 所述行為，作為規格的可執行對照。
- **文件**：`safety-check` spec 對 `.toml` section 歸屬的依賴，自此有明確的被依賴規格可指涉。
