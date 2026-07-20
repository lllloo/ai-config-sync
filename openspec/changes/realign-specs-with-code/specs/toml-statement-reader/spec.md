## MODIFIED Requirements

### Requirement: 多行 value 續行併入以避免逐行截斷

系統 SHALL 提供 `isIncompleteTomlValue(text)`，偵測未閉合的多行陣列（`[`／`]` 淨深度 > 0）與未閉合的三引號字串（`"""`／`'''`）。`readTomlStatements` 遇到未完結的 value 時 SHALL 併入後續行直到閉合或內容結束，並在 `value`／`raw` 保留完整原文，避免逐行截斷成無效 TOML 而破壞後續 section 歸屬。掃描 `[`／`]` 時 SHALL 略過字串（單／雙／三引號）與行內 `#` 註解內的字元。

括號深度與字串狀態的逐字掃描 SHALL 為模組內部實作細節，MUST NOT 作為對外契約的一部分——其行為 SHALL 透過 `isIncompleteTomlValue` 的回傳值間接驗證。

#### Scenario: 未閉合的多行陣列併入續行
- **WHEN** 某 key 的值為跨多行、尾行才閉合 `]` 的陣列
- **THEN** 系統 SHALL 將所有續行併入同一個 `kv` token，`value` 包含完整多行原文，且陣列閉合後的下一行 SHALL 重新正常辨識

#### Scenario: 三引號字串內的括號不影響深度
- **WHEN** 三引號字串（`"""` 或 `'''`）內含有 `[` 或 `]` 字元
- **THEN** `isIncompleteTomlValue` SHALL 不將字串內的括號計入陣列深度，字串閉合後該 value 才視為完結

### Requirement: toml-reader 為純函式模組且僅供 safety-check 消費

系統 SHALL 將 TOML 邏輯語句讀取器集中於獨立模組 `toml-reader.js`，該模組 SHALL 為純函式、零 IO、零外部相依（只用 Node.js 內建語言特性），並對外匯出 `isIncompleteTomlValue`／`matchTomlHeader`／`splitTomlKey`／`readTomlStatements`。對外匯出面 SHALL 只包含有實際消費者的函式；無外部消費者的內部輔助函式 SHALL NOT 出現在 `module.exports`。

`splitTomlKey` SHALL 被視為安全關鍵匯出：`safety-check.js` 以其對 section 名做去引號正規化，缺此正規化時引號包裝的機密 section 會靜默通過 hard block 判斷。

此模組 SHALL NOT 反向 require `sync.js`；其唯一消費者為 `safety-check.js`（直接 require）。因 section 歸屬正確性直接決定 `safety:check` 的 hard block／warning 判斷，此模組的回歸測試 SHALL 被視為安全防線，MUST NOT 被刪除。

#### Scenario: 模組可獨立於 sync.js 被 require 與測試
- **WHEN** 測試或 `safety-check.js` 直接 `require('./toml-reader.js')`
- **THEN** 模組 SHALL 正常提供上述匯出，且不需先載入 `sync.js`

#### Scenario: 匯出面不含無消費者函式
- **WHEN** 檢查 `toml-reader.js` 的 `module.exports`
- **THEN** 其鍵集合 SHALL 為 `isIncompleteTomlValue`／`matchTomlHeader`／`splitTomlKey`／`readTomlStatements`
- **AND** SHALL NOT 包含 `scanTomlValueState`（已收斂為內部細節）

#### Scenario: section 歸屬變動須通過安全回歸測試
- **WHEN** 修改 header 解析或語句拆解邏輯
- **THEN** 變更 SHALL 保住既有 TOML 讀取器與邊界安全（引號感知 header、fail-closed、`splitTomlKey` 去引號正規化）的回歸測試通過，否則視為破壞安全防線
