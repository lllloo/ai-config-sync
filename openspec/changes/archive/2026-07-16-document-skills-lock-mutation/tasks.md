## 1. 核對 spec 與現況一致（無程式碼變更）

- [x] 1.1 逐條核對 `specs/skills-lock-mutation/spec.md` 的每個 Requirement 對應 `skills.js` 既有行為（`parseSkillSource`／`runSkillsAdd`／`runSkillsRemove`／`loadSkillsFromLock`），確認無 SHALL 描述超出實作保證
- [x] 1.2 確認「不重新排序 key」與 `writeJsonSafe` 實際序列化行為一致
- [x] 1.3 確認注入驗證僅指涉 `skills-lock-diff` 而未於本 spec 重述為獨立需求，避免跨 spec 重複
- [x] 1.4 確認 spec 未夾帶任何程式碼、測試或既有 spec 的變更（純規格回填）

## 2. 對照既有測試作為可執行背書

- [x] 2.1 對照 `test/skills.test.js`，確認 `parseSkillSource` 兩形態、name/source 驗證、lock 結構處理各有對應測試覆蓋
- [x] 2.2 確認 add 無覆寫冪等與 remove no-op／缺檔報錯的行為有測試或可由現有測試推得；缺口記錄於核對結論（不在本 change 補測試）。**核對結論**：helper 層（`parseSkillSource` 兩形態、`validateSkillName`／`validateSkillSource`、`loadSkillsFromLock` 型別異常）有直接單元測試；但 `runSkillsAdd` 無覆寫冪等、`runSkillsRemove` no-op／缺檔 `FILE_NOT_FOUND` 這三個進入點行為**無直接單元測試**。spec 依直讀 `skills.js` 忠實描述，測試背書偏 helper 層——此缺口留待日後補 `runSkillsAdd`／`runSkillsRemove` 端到端測試時收斂，非本回填 change 範疇。
- [x] 2.3 執行 `npm test`，確認全綠（現況驗證，非新增測試）

## 3. 校驗與收斂

- [x] 3.1 執行 `openspec validate document-skills-lock-mutation`，修正任何格式或結構問題
- [x] 3.2 執行 `openspec status --change document-skills-lock-mutation`，確認四個 artifact 皆為 done
- [x] 3.3 apply／archive 時，將 `skills-lock-mutation` spec 的 Purpose 從預設佔位改寫為正式描述（若 archive 產生佔位）
