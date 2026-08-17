## 1. 規格同步

- [x] 1.1 執行 `openspec` 的 spec 同步，將三份 delta 併入 `openspec/specs/`（新增 `xtool-dir-module-boundary/spec.md`，更新 `safety-check-module-boundary`／`skills-module-boundary` 各一條沙箱 requirement）
- [x] 1.2 確認新增的 `openspec/specs/xtool-dir-module-boundary/spec.md` 的 `## Purpose` 已帶入 delta 內容，未留下 `TBD` 佔位

## 2. Purpose 段落手動修正（delta 不涵蓋）

- [x] 2.1 直接編輯 `openspec/specs/safety-check-module-boundary/spec.md` 的 `## Purpose`，將 runtime 檔清單由四檔改為五檔（補 `xtool-dir.js`）
- [x] 2.2 直接編輯 `openspec/specs/skills-module-boundary/spec.md` 的 `## Purpose`，同上

## 3. 驗證

- [x] 3.1 `openspec validate --strict` 通過（三份 spec 無格式或 Purpose 過短問題）
- [x] 3.2 `npm test` 全綠（本次不改程式碼與測試，僅確認未誤動）
- [x] 3.3 人工核對：新 spec 描述的邊界與 `xtool-dir.js` 檔頭註解、`CLAUDE.md` 架構重點段一致，無互相矛盾的敘述
