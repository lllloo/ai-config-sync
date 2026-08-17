## 1. 規格歸位

- [x] 1.1 歸檔 change，將兩份 delta 併入 `openspec/specs/`（`xtool-dir-module-boundary` 縮減一條 requirement、`cross-tool-skill-sync` 新增一條 requirement）
- [x] 1.2 確認 `xtool-dir-module-boundary` 不再含「相對順序」與「部分變更併入」兩條行為不變式
- [x] 1.3 確認 `cross-tool-skill-sync` 的新 requirement 與既有「真實目錄至 symlink 的遷移」不重複陳述同一件事

## 2. 驗證

- [x] 2.1 `openspec validate --strict --specs` 全數通過
- [x] 2.2 `npm test` 全綠（本次不動程式碼與測試）
- [x] 2.3 確認 `test/fs-symlink.test.js` 既有的 `mergeXtoolPartialChanges` 測試確實覆蓋新 requirement 的兩條 scenario
