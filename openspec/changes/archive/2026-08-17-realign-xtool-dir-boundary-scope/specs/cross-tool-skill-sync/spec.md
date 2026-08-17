## ADDED Requirements

### Requirement: apply 部分變更的併入

當 `xtool-dir` 型的 apply 中途拋例外時，系統 SHALL 併入兩邊的已完成變更：本次失敗前**已完成的 skill** 之變更，與 `mirrorDir` 附掛於當前 skill 的**內部**變更。任一邊 SHALL NOT 因指派而覆寫另一邊。當前 skill 的內部相對路徑 SHALL 補上 `<name>/` 前綴，使其與其他項目的顯示格式一致。

已落磁碟的檔案 MUST NOT 零可見度——這是 `sync-write-safety` 之「apply 部分失敗須可見」在本型的具體化，因本型逐 skill 迴圈套用而多出「跨 skill 與 skill 內」兩層來源。

#### Scenario: 兩邊都有內容時併入
- **WHEN** apply 已完成若干 skill 後，於下一個 skill 的目錄鏡射中途失敗，且該 skill 內部已有寫入
- **THEN** 附掛的部分變更清單 SHALL 同時包含先前已完成 skill 的變更與當前 skill 的內部變更
- **AND** 當前 skill 的內部變更 SHALL 帶 `<name>/` 前綴

#### Scenario: 單邊為空時不得覆寫另一邊
- **WHEN** 兩層來源其中一層為空
- **THEN** 另一層的已完成變更 SHALL 完整保留於部分變更清單中
