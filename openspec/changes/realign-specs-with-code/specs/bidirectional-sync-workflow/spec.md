## MODIFIED Requirements

### Requirement: to-local 採預覽後確認的閘門

系統 SHALL 在 `to-local` 實際套用前先計算並顯示預覽（將新增／更新／刪除／撞名跳過／本機保留），再經 `askConfirm` 詢問使用者確認。使用者未回答 `y`／`yes` 時 SHALL 取消且不套用。無差異時 SHALL 直接回報「完全一致，無需套用」並以 `EXIT_OK` 退出。

所有同步型別（`file`／`dir`／`settings`／`xtool-skills`）SHALL 一律經過此閘門，其差異 SHALL 計入待寫入變更數；SHALL NOT 存在任何豁免確認流程、或差異不計入變更數的型別。

> 原規範中 `advisory` 型項目豁免確認閘門的段落（含「只有 advisory 差異時不進確認流程」與「混合差異時 advisory 不計入寫入數」兩個 scenario）於此刪除：`advisory` 型別已隨 `2026-07-20-remove-mcp-sync` 整批移除，`sync.js` 對 `advisory` 零命中，且該規範與 `declarative-sync-manifest` 的「`advisory` 型別 SHALL 不存在」直接矛盾——照其實作會踢爆 `test/sync.test.js` 的「MCP 型別（mcp／advisory）皆不得復活」回歸鎖。重新設計 MCP 同步時若需要「無副作用輸出不進閘門」的語義，SHALL 作為新提案重新論證，MUST NOT 直接復用原規範。

#### Scenario: 使用者拒絕則不套用
- **WHEN** 使用者執行 `node sync.js to-local` 且在確認提示回答非 y
- **THEN** 系統 SHALL 輸出「已取消」並以 `EXIT_OK` 退出，MUST NOT 寫入本機

#### Scenario: 無差異直接結束
- **WHEN** 本機與 repo 完全一致
- **THEN** 系統 SHALL 輸出「無需套用」並以 `EXIT_OK` 退出，不進入確認流程

#### Scenario: 所有型別差異皆計入待寫入變更數
- **WHEN** 本次 `to-local` 存在任一型別（`file`／`dir`／`settings`／`xtool-skills`）的差異
- **THEN** 確認提示顯示的變更筆數 SHALL 涵蓋所有型別的差異，SHALL NOT 排除任何型別
- **AND** 使用者回答非 y 時，MUST NOT 有任何項目被寫入
