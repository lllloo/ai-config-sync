## Context

本次是校正性變更，不引入新能力。難處不在實作，而在**每一條落差都要先判定「哪一邊是對的」**：spec 過時該改 spec，還是實作偏離該改程式碼？誤判方向會把一個文件問題變成行為迴歸。

現況盤點（13 份 spec、約 1,041 行 vs 約 3,200 行程式碼）發現的落差可歸為四類：

```
A. 描述已刪除的功能        spec 該刪   ← MCP 移除的尾巴
B. 實作有、spec 沒有        spec 該補   ← 多為安全防線，風險最高
C. spec 描述從未建造的機制  需判定      ← 建造 vs 刪條文
D. Purpose 段腐爛          spec 該改   ← 無測試覆蓋，沉積最久
```

關鍵約束：spec 之間已出現**互相矛盾**（`bidirectional-sync-workflow:43` 要求 advisory 行為存在，`declarative-sync-manifest:69-74` 要求它不存在）。矛盾狀態下無法靠「讀 spec 判斷正確行為」，只能以程式碼與測試為裁決依據。

## Goals / Non-Goals

**Goals:**

- 消除 spec 集合內部的自我矛盾，使任一條文可被單獨信任
- 把兩條無 spec 依據的安全防線寫進規範，取得防止未來重構誤刪的依據
- 讓每一條 scenario 的 WHEN 條件在現行系統中**可判定**（目前有兩條不可判定）
- 修正 `skills:diff` 一處分支不對稱

**Non-Goals:**

- 不重新設計 MCP 同步（獨立議題，`openspec/changes/archive/` 三份 change 已載明重啟時的閘門）
- 不建造 settings.json 的 key 層級 diff（見 D3）
- 不改動任何同步行為；除 `skills.js` 一處外不動 runtime 程式碼
- 不引入 Purpose 段的自動化 drift-guard（見 Open Questions）

## Decisions

### D1: 以「程式碼 + 測試」為裁決基準，spec 追上

**選擇**：除 D4 一項外，全部改 spec 使其反映程式碼實況。

**理由**：本專案的行為不變式主要由測試承載（300 項，含多條明確標示的 drift-guard 與回歸鎖），而非由 spec 承載。程式碼側的每一條爭議行為都有對應測試（如 `boundary.test.js:1128` 斷言 malformed header exit 2、`sync.test.js:590` 禁止 advisory 復活），代表這些行為是**經審議後刻意寫成**的，不是漂移。反之 spec 側的過時條文沒有任何機制阻止它腐爛。

**替代方案**：以 spec 為準、改程式碼。否決——會刪掉兩條運作中的安全防線（malformed header hard block、引號 section 正規化），且需要建造一個專案已明確拒絕的機制（見 D3）。

### D2: 安全防線的補記優先於其他項目

**選擇**：任務排序把 `safety-check` 與 `toml-statement-reader` 的補記排在最前。

**理由**：這兩條防線（`safety-check.js:190` 的 malformed header hard block、`safety-check.js:213` 經 `splitTomlKey` 的引號正規化）都是**fail-closed 設計的關鍵環節**，且都是「看起來多餘、實際不可少」的類型——引號正規化若被移除，`["mcp_servers"]` 這種寫法會靜默 exit 0 而非 hard block。無 spec 依據時，未來任何「簡化 safety-check」的重構都可能合理地把它們刪掉。其餘落差最壞後果只是文件誤導。

### D3: 「settings env key 層級 diff + 值遮罩」刪條文，不建造

**選擇**：重寫 `claude-settings-sync` 的「明細 diff 不顯示 env 值」Requirement，改為據實規範「diff／status 只輸出狀態行，不輸出任何設定內容」。

**理由**：現行條文的 SHALL NOT 部分（不顯示 env 值）成立，但**成立的原因是「根本不印明細」而非「有遮罩機制」**——`diffSettingsItem` 只回傳整檔一筆 status。正面規定的部分（key 層級呈現 + 顯示層遮罩）從未建造。而「不印設定內容」是專案刻意的設計選擇，`CLAUDE.md` 明載「`diff`／`status` 只輸出狀態行、不印設定內容」，屬安全取捨而非疏漏。

**替代方案**：建造 key 層級 diff。否決——它會讓 `diff` 開始輸出 env key 名稱，擴大輸出面；遮罩機制本身也是新的可出錯環節（遮罩漏網即機密外洩）。目前的「什麼都不印」在安全性上嚴格更強，代價只是診斷便利性下降。若日後真需要，應作為獨立提案並重新評估，而非藉校正變更夾帶。

### D4: `skills:diff` 改程式碼、不改 spec（唯一例外）

**選擇**：修 `skills.js` 使 `onlyInRepo` 分支在 lock 項目缺 `source` 時仍輸出建議（比照 `onlyInLocal` 的 `<source>` placeholder 做法），而非把 spec 的無條件 SHALL 改成有條件。

**理由**：此處實作與 spec 的落差不是「刻意設計未被記錄」，而是分支不對稱造成的**可見度缺口**：缺 `source` 的 skill 會出現在 `down` 狀態行卻沒有任何後續指令，使用者看得到問題卻沒有下一步。`onlyInLocal` 分支已經證明「資訊不全時仍給 placeholder 建議」是本專案接受的作法。這是唯一一處 spec 描述的行為比實作更合理的地方。

### D5: `homeRootFile` scenario 改用中性範例

**選擇**：把 scenario 的 `.claude.json` 改為 `.root-level.json`（測試已採用的名稱）。

**理由**：現行 scenario 的 WHEN 是「一列 manifest 指定 `homeRootFile: '.claude.json'`」，但同一份 spec `:56-57` 明文要求「SHALL NOT 存在使用 `homeRootFile: '.claude.json'` 的列」。WHEN 條件依規範永不成立，該 scenario 不可驗證。`homeRootFile` 欄位本身仍有實作（`sync.js:1154`）且有合成 entry 測試覆蓋，能力該保留、範例該換。

### D6: Purpose 段以直接編輯主 spec 處理，不走 delta

**選擇**：5 份 `TBD` Purpose 與 `claude-settings-sync` 的 Purpose 重寫列為 tasks，於實作階段直接編輯 `openspec/specs/<name>/spec.md` 的 Purpose 段。

**理由**：delta spec 的操作單位是 Requirement（ADDED／MODIFIED／REMOVED／RENAMED），Purpose 是 spec 層級的敘述段，不在 delta 的表達範圍內。強行以 MODIFIED 夾帶會讓 archive 時的合併語義不明。

## Risks / Trade-offs

- **[改 spec 時誤刪仍有效的條文]** → 每一條 MODIFIED 都以完整原文為基礎編輯（openspec 對 MODIFIED 的要求），且改動限於本 change 明列的落差項；不順手做「順便優化措辭」。
- **[`skills.js` 修正引入迴歸]** → 改動限於 `onlyInRepo` 分支的建議輸出，不觸及 `computeSkillsDiff` 的集合計算與 exit code；新增針對缺 `source` 的測試，既有 `skills.test.js` 須全綠。
- **[本次校正本身日後再腐爛]** → 本 change 無法根治成因。緩解：把「純 refactor 若改動模組對外契約，須走 openspec」寫進 tasks 的收尾檢查，並在 Open Questions 留下自動化選項。
- **[判定方向錯誤]** → D3、D4 兩處是唯一有實質判斷的地方，兩者的理由與替代方案已顯式記錄，日後若判定被推翻可直接定位。

## Migration Plan

無執行期遷移——本 change 不改變任何同步行為、不動資料格式。

順序：安全補記（safety-check、toml-statement-reader）→ 移除已刪功能規範（bidirectional、sync-write-safety）→ 其餘 spec 校正 → `skills.js` 修正 + 測試 → Purpose 回填 → `CLAUDE.md` 修正 → `npm test` + `npm run safety:check` 全綠。

回滾：spec 側改動為純文件，`git revert` 即可；`skills.js` 一處修正可獨立 revert 而不影響 spec。

## Open Questions

- **Purpose 段是否該有 drift-guard？** 本次 5 份 `TBD` 與 `claude-settings-sync` 沉積三個月的錯誤描述，共同點是 Purpose 段不被任何測試覆蓋，而 Requirement／Scenario 至少還有測試會踩。最低成本的守門是一條測試斷言「`openspec/specs/*/spec.md` 的 Purpose 不得包含 `TBD - created by`」——擋得住佔位符，擋不住內容腐爛。是否值得、以及是否該由本 change 承擔，留待決定。
- **是否需要一條「spec 集合內部一致性」檢查？** 本次最嚴重的問題（兩份 spec 對 advisory 的要求相反）不是任何單一 spec 的錯誤，而是集合層級的矛盾。`openspec validate` 是否已涵蓋此類檢查未經確認。
