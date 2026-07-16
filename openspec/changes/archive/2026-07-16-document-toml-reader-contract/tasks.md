## 1. 核對 spec 與現況一致（無程式碼變更）

- [x] 1.1 逐條核對 `specs/toml-statement-reader/spec.md` 的每個 Requirement 對應 `toml-reader.js` 既有行為（`readTomlStatements`／`matchTomlHeader`／`findTomlHeaderEnd`／`scanTomlValueState`／`isIncompleteTomlValue`），確認無 SHALL 描述超出實作保證
- [x] 1.2 確認 spec 未夾帶任何程式碼、測試或既有 spec 的變更（本 change 為純規格回填）
- [x] 1.3 確認 `safety-check` spec 對 `.toml` section 歸屬的依賴與本 spec 的判準／前提分工一致，無重複或矛盾

## 2. 對照既有測試作為可執行背書

- [x] 2.1 對照 `test/toml-reader.test.js`，確認引號感知 header、malformed fail-closed、多行續行、section 歸屬各 scenario 均有對應測試覆蓋
- [x] 2.2 對照 `test/boundary.test.js` 的 F2 回歸，確認引號感知 header 的安全邊界 scenario 有對應測試
- [x] 2.3 執行 `npm test`，確認全綠（作為 spec 描述行為的現況驗證，非新增測試）

## 3. 校驗與收斂

- [x] 3.1 執行 `openspec validate --change document-toml-reader-contract`，修正任何格式或結構問題
- [x] 3.2 執行 `openspec status --change document-toml-reader-contract`，確認四個 artifact 皆為 done
- [x] 3.3 apply／archive 時，將 `toml-statement-reader` spec 的 Purpose 從預設佔位改寫為正式描述（若 archive 產生佔位）
