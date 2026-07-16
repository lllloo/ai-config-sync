# toml-statement-reader Specification

## Purpose
定義 `toml-reader.js`（TOML 邏輯語句讀取器）的解析契約與模組邊界，作為 `safety:check` 對 repo 內任何 `.toml` 做 hard block／warning 判斷的 section 歸屬前提：`readTomlStatements` 將 TOML 拆成 `section`／`kv`／`other` token 並正確歸屬 key；header 解析為引號感知（section 名內引號中的 `]` 不截斷）並辨識 array-of-tables；malformed header 採 fail-closed（`name:null` 而非沿用前一 section）；多行陣列與三引號字串併入續行避免逐行截斷。模組為純函式、零 IO、零外部相依，唯一消費者為 `safety-check.js`（不反向 require `sync.js`），其回歸測試為安全防線不可刪。
## Requirements
### Requirement: TOML 內容拆解為邏輯語句且 key 正確歸屬 section

系統 SHALL 提供 `readTomlStatements(content)`，將 TOML 內容逐行拆成有序的邏輯語句 token：section header（`type:'section'`）、key-value（`type:'kv'`，含 `key`／`value`／`raw`／`line`）、其餘空行／註解／無法辨識行（`type:'other'`）。key-value token SHALL 反映其在來源中所處的 section 邊界順序，使消費端能依「最近一個合法 section」歸屬每個 key。此函式 SHALL 為純函式、零 IO、不修改輸入。

#### Scenario: 一般 table 下的 key 歸屬該 section
- **WHEN** 傳入含 `[mcp_servers.foo]` header 後接 `command = "x"` 的內容
- **THEN** 系統 SHALL 依序產出一個 `name` 為 `mcp_servers.foo` 的 `section` token 與一個 `key` 為 `command` 的 `kv` token，使消費端可將該 key 歸屬到 `mcp_servers.foo`

#### Scenario: 空行與註解回報為 other
- **WHEN** 某行為空字串或以 `#` 起始的註解
- **THEN** 系統 SHALL 產出 `type:'other'` token，MUST NOT 將其誤判為 section 或 kv

### Requirement: section header 解析為引號感知並辨識 array-of-tables

系統 SHALL 以引號感知方式解析 section header：section 名內位於引號（`"` 或 `'`）中的 `]` MUST NOT 被視為 header 結束（如 `[mcp_servers."a]b"]`）。系統 SHALL 顯式區分 array-of-tables（`[[x]]`）與一般 table（`[x]`），並 MUST NOT 將字串值中出現的 `[x]` 樣式誤判為 section header。header 尾端 SHALL 只容許空白與行內註解；不合規者（如 `[[x]` 缺一閉合、名稱為空）SHALL NOT 被當成合法 header。

#### Scenario: 引號內的 `]` 不截斷 section 名
- **WHEN** 傳入 header `[mcp_servers."a]b"]`
- **THEN** 系統 SHALL 解析出完整 section 名 `mcp_servers."a]b"`，MUST NOT 在引號內的 `]` 處提前截斷而導致整行無法辨識為 header

#### Scenario: array-of-tables 與一般 table 均被辨識
- **WHEN** 傳入 `[[servers]]` 或 `[servers]`
- **THEN** 系統 SHALL 皆回報為合法 `section`，並以 `arrayTable` 欄位區分兩者

#### Scenario: 字串值內的 table 樣式不被誤判
- **WHEN** 某 key-value 的值字串中含有 `[x]` 樣式文字
- **THEN** 系統 SHALL NOT 將其辨識為 section header，該 key 的歸屬 SHALL 不受影響

### Requirement: malformed section header 為 fail-closed

系統 SHALL 對「以 `[` 起始卻無法解析為合法 header」的行回傳 `{type:'section', name:null}`，而 MUST NOT 退回 `type:'other'`。此為 fail-closed 設計：標示「此處有 section 邊界，但名字不可信」，使消費端得以據此擋下（清空／hard block），避免其下的 key 沿用前一個 section 名而被錯誤歸屬導致機密判斷漏判。

#### Scenario: 無法解析的 header 標為 name:null 而非 other
- **WHEN** 某行以 `[` 起始但不是合法 TOML header（如未閉合、`[[x]`）
- **THEN** 系統 SHALL 產出 `{type:'section', name:null}` token

#### Scenario: malformed 邊界之後的 key 不沿用前一 section
- **WHEN** 一個合法 section 之後出現 malformed header 行，其下再接 key-value
- **THEN** 因該 malformed 行已標為 section 邊界（`name:null`），消費端 SHALL NOT 將其下的 key 歸屬到前一個合法 section

### Requirement: 多行 value 續行併入以避免逐行截斷

系統 SHALL 提供 `scanTomlValueState(text)` 與 `isIncompleteTomlValue(text)`，偵測未閉合的多行陣列（`[`／`]` 淨深度 > 0）與未閉合的三引號字串（`"""`／`'''`）。`readTomlStatements` 遇到未完結的 value 時 SHALL 併入後續行直到閉合或內容結束，並在 `value`／`raw` 保留完整原文，避免逐行截斷成無效 TOML 而破壞後續 section 歸屬。掃描 `[`／`]` 時 SHALL 略過字串（單／雙／三引號）與行內 `#` 註解內的字元。

#### Scenario: 未閉合的多行陣列併入續行
- **WHEN** 某 key 的值為跨多行、尾行才閉合 `]` 的陣列
- **THEN** 系統 SHALL 將所有續行併入同一個 `kv` token，`value` 包含完整多行原文，且陣列閉合後的下一行 SHALL 重新正常辨識

#### Scenario: 三引號字串內的括號不影響深度
- **WHEN** 三引號字串（`"""` 或 `'''`）內含有 `[` 或 `]` 字元
- **THEN** `scanTomlValueState` SHALL 不將字串內的括號計入陣列深度，字串閉合後 value 才視為完結

### Requirement: toml-reader 為純函式模組且僅供 safety-check 消費

系統 SHALL 將 TOML 邏輯語句讀取器集中於獨立模組 `toml-reader.js`，該模組 SHALL 為純函式、零 IO、零外部相依（只用 Node.js 內建語言特性），並對外匯出 `scanTomlValueState`／`isIncompleteTomlValue`／`matchTomlHeader`／`readTomlStatements`。此模組 SHALL NOT 反向 require `sync.js`；其唯一消費者為 `safety-check.js`（直接 require）。因 section 歸屬正確性直接決定 `safety:check` 的 hard block／warning 判斷，此模組的回歸測試 SHALL 被視為安全防線，MUST NOT 被刪除。

#### Scenario: 模組可獨立於 sync.js 被 require 與測試
- **WHEN** 測試或 `safety-check.js` 直接 `require('./toml-reader.js')`
- **THEN** 模組 SHALL 正常提供上述匯出，且不需先載入 `sync.js`

#### Scenario: section 歸屬變動須通過安全回歸測試
- **WHEN** 修改 header 解析或語句拆解邏輯
- **THEN** 變更 SHALL 保住既有 TOML 讀取器與邊界安全（引號感知 header、fail-closed）的回歸測試通過，否則視為破壞安全防線

