## MODIFIED Requirements

### Requirement: to-local 採預覽後確認的閘門

系統 SHALL 在 `to-local` 實際套用前先計算並顯示預覽（將新增／更新／刪除／撞名跳過／本機保留），再經 `askConfirm` 詢問使用者確認。使用者未回答 `y`／`yes` 時 SHALL 取消且不套用。無差異時 SHALL 直接回報「完全一致，無需套用」並以 `EXIT_OK` 退出。

`advisory` 型項目 SHALL 不參與此閘門：其差異 MUST NOT 計入待寫入變更數，且無論使用者確認與否皆 SHALL 於摘要後輸出建議指令——因該輸出無任何副作用。若本次 `to-local` 只有 advisory 型差異，系統 SHALL NOT 進入確認流程，而是直接輸出建議指令並以 `EXIT_OK` 退出。

#### Scenario: 使用者拒絕則不套用
- **WHEN** 使用者執行 `node sync.js to-local` 且在確認提示回答非 y
- **THEN** 系統 SHALL 輸出「已取消」並以 `EXIT_OK` 退出，MUST NOT 寫入本機

#### Scenario: 無差異直接結束
- **WHEN** 本機與 repo 完全一致
- **THEN** 系統 SHALL 輸出「無需套用」並以 `EXIT_OK` 退出，不進入確認流程

#### Scenario: 只有 advisory 差異時不進確認流程
- **WHEN** 本次 `to-local` 的差異全部來自 advisory 型項目
- **THEN** 系統 SHALL 直接輸出建議指令並以 `EXIT_OK` 退出
- **AND** MUST NOT 顯示確認提示，MUST NOT 回報待寫入變更筆數

#### Scenario: 混合差異時 advisory 不計入寫入數
- **WHEN** 本次 `to-local` 同時有檔案型與 advisory 型差異
- **THEN** 確認提示顯示的變更筆數 SHALL 只計檔案型差異
- **AND** 使用者回答非 y 時，檔案 MUST NOT 被寫入，但建議指令 SHALL 仍被輸出
